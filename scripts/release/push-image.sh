#!/usr/bin/env bash

set -Eeuo pipefail

if (($# != 3)); then
  printf 'Usage: push-image.sh IMAGE_REF COMPONENT DIGEST_OUTPUT\n' >&2
  exit 2
fi

image_ref=$1
component=$2
digest_output=$3
timeout_seconds=${EXAMFORGE_PUSH_TIMEOUT_SECONDS:-1800}
retry_delay_seconds=${EXAMFORGE_PUSH_RETRY_DELAY_SECONDS:-5}
status_file=${EXAMFORGE_PUSH_STATUS_FILE:-}
log_directory=${EXAMFORGE_PUSH_LOG_DIR:-$(dirname "$digest_output")}
max_attempts=2

case "$component" in
  api | scheduler | web | worker) ;;
  *)
    printf 'Unsupported component: %s\n' "$component" >&2
    exit 2
    ;;
esac

[[ "$image_ref" =~ ^[A-Za-z0-9._:/-]+:[a-f0-9]{40}$ ]] \
  || { printf 'Image reference must use a full commit SHA tag.\n' >&2; exit 2; }
if ! [[ "$timeout_seconds" =~ ^[0-9]+$ ]] || ((timeout_seconds < 1 || timeout_seconds > 1800)); then
  printf 'Push timeout must be between 1 and 1800 seconds.\n' >&2
  exit 2
fi
if ! [[ "$retry_delay_seconds" =~ ^[0-9]+$ ]] || ((retry_delay_seconds > 60)); then
  printf 'Push retry delay must be between 0 and 60 seconds.\n' >&2
  exit 2
fi

mkdir -p "$log_directory" "$(dirname "$digest_output")"
if [[ -n "$status_file" ]]; then
  mkdir -p "$(dirname "$status_file")"
fi
rm -f "$digest_output"

record_status() {
  local attempt=$1
  local status=$2
  local reason=$3
  local line
  line="timestamp=$(date --utc +'%Y-%m-%dT%H:%M:%SZ') image=$component attempt=$attempt status=$status reason=$reason"
  printf '%s\n' "$line"
  if [[ -n "$status_file" ]]; then
    printf '%s\n' "$line" >> "$status_file"
  fi
}

for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
  attempt_log="$log_directory/$component-attempt-$attempt.log"
  record_status "$attempt" started none

  set +e
  timeout --foreground --signal=TERM --kill-after=30s "${timeout_seconds}s" \
    docker push "$image_ref" 2>&1 | tee "$attempt_log"
  pipeline_status=("${PIPESTATUS[@]}")
  set -e
  push_exit=${pipeline_status[0]}
  tee_exit=${pipeline_status[1]}

  failure_reason=push_failed
  if ((push_exit == 124)); then
    failure_reason=timeout
  elif ((tee_exit != 0)); then
    failure_reason=log_write_failed
  elif ((push_exit == 0)); then
    set +e
    manifest_json=$(docker buildx imagetools inspect "$image_ref" --format '{{json .Manifest}}' 2>> "$attempt_log")
    inspect_exit=$?
    set -e

    remote_digest=
    parse_exit=1
    if ((inspect_exit == 0)); then
      set +e
      remote_digest=$(printf '%s' "$manifest_json" | node --input-type=module -e '
        import { readFileSync } from "node:fs";
        const manifest = JSON.parse(readFileSync(0, "utf8"));
        if (!/^sha256:[a-f0-9]{64}$/.test(manifest.digest ?? "")) process.exit(1);
        process.stdout.write(manifest.digest);
      ' 2>> "$attempt_log")
      parse_exit=$?
      set -e
    fi

    if ((inspect_exit == 0 && parse_exit == 0)); then
      printf '%s\n' "$remote_digest" > "$digest_output"
      record_status "$attempt" succeeded remote_digest_verified
      exit 0
    fi
    failure_reason=remote_digest_verification_failed
  fi

  record_status "$attempt" failed "$failure_reason"
  if ((attempt < max_attempts)); then
    record_status "$attempt" retrying "$failure_reason"
    sleep "$retry_delay_seconds"
  fi
done

printf '%s image push failed after %d attempts.\n' "$component" "$max_attempts" >&2
exit 1
