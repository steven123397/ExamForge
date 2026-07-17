#!/usr/bin/env bash

set -Eeuo pipefail

if (($# != 3)); then
  printf 'Usage: build-image.sh IMAGE_REF COMPONENT DOCKERFILE\n' >&2
  exit 2
fi

image_ref=$1
component=$2
dockerfile=$3
timeout_seconds=${EXAMFORGE_BUILD_TIMEOUT_SECONDS:-1800}
retry_delay_seconds=${EXAMFORGE_BUILD_RETRY_DELAY_SECONDS:-5}
status_file=${EXAMFORGE_BUILD_STATUS_FILE:-}
log_directory=${EXAMFORGE_BUILD_LOG_DIR:-${RUNNER_TEMP:-/tmp}/examforge-build-logs}
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
[[ -f "$dockerfile" ]] \
  || { printf 'Dockerfile does not exist: %s\n' "$dockerfile" >&2; exit 2; }
for name in SOURCE_REVISION SOURCE_URL SOURCE_CREATED_AT PUBLIC_ORIGIN; do
  [[ -n "${!name:-}" ]] || { printf '%s must be defined.\n' "$name" >&2; exit 2; }
done
[[ "$image_ref" == *":$SOURCE_REVISION" ]] \
  || { printf 'Image tag must match SOURCE_REVISION.\n' >&2; exit 2; }
if ! [[ "$timeout_seconds" =~ ^[0-9]+$ ]] || ((timeout_seconds < 1 || timeout_seconds > 1800)); then
  printf 'Build timeout must be between 1 and 1800 seconds.\n' >&2
  exit 2
fi
if ! [[ "$retry_delay_seconds" =~ ^[0-9]+$ ]] || ((retry_delay_seconds > 60)); then
  printf 'Build retry delay must be between 0 and 60 seconds.\n' >&2
  exit 2
fi

mkdir -p "$log_directory"
if [[ -n "$status_file" ]]; then
  mkdir -p "$(dirname "$status_file")"
fi

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

build_args=(
  --file "$dockerfile"
  --platform linux/amd64
  --load
  --tag "$image_ref"
  --build-arg "SOURCE_REVISION=$SOURCE_REVISION"
  --build-arg "SOURCE_URL=$SOURCE_URL"
  --build-arg "SOURCE_CREATED_AT=$SOURCE_CREATED_AT"
)
if [[ "$component" == "web" ]]; then
  build_args+=(--build-arg "NEXT_PUBLIC_API_BASE_URL=$PUBLIC_ORIGIN")
fi
for proxy_name in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy; do
  if [[ -n "${!proxy_name:-}" ]]; then
    build_args+=(--build-arg "$proxy_name")
  fi
done

for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
  attempt_log="$log_directory/$component-attempt-$attempt.log"
  record_status "$attempt" started none

  set +e
  timeout --foreground --signal=TERM --kill-after=30s "${timeout_seconds}s" \
    docker buildx build "${build_args[@]}" . 2>&1 | tee "$attempt_log"
  pipeline_status=("${PIPESTATUS[@]}")
  set -e
  build_exit=${pipeline_status[0]}
  tee_exit=${pipeline_status[1]}

  failure_reason=build_failed
  if ((build_exit == 124)); then
    failure_reason=timeout
  elif ((tee_exit != 0)); then
    failure_reason=log_write_failed
  elif ((build_exit == 0)); then
    record_status "$attempt" succeeded image_loaded
    exit 0
  fi

  record_status "$attempt" failed "$failure_reason"
  if ((attempt < max_attempts)); then
    record_status "$attempt" retrying "$failure_reason"
    sleep "$retry_delay_seconds"
  fi
done

printf '%s image build failed after %d attempts.\n' "$component" "$max_attempts" >&2
exit 1
