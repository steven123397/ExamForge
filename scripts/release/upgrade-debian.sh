#!/bin/sh

set -eu

timeout_seconds=${EXAMFORGE_APT_TIMEOUT_SECONDS:-120}
retry_delay_seconds=${EXAMFORGE_APT_RETRY_DELAY_SECONDS:-5}
max_attempts=3
debian_mirror=http://mirrors.tuna.tsinghua.edu.cn

case "$timeout_seconds" in
  '' | *[!0-9]*)
    printf 'APT timeout must be an integer.\n' >&2
    exit 2
    ;;
esac
if [ "$timeout_seconds" -lt 1 ] || [ "$timeout_seconds" -gt 300 ]; then
  printf 'APT timeout must be between 1 and 300 seconds.\n' >&2
  exit 2
fi
case "$retry_delay_seconds" in
  '' | *[!0-9]*)
    printf 'APT retry delay must be an integer.\n' >&2
    exit 2
    ;;
esac
if [ "$retry_delay_seconds" -gt 30 ]; then
  printf 'APT retry delay must be between 0 and 30 seconds.\n' >&2
  exit 2
fi

export DEBIAN_FRONTEND=noninteractive

for source_file in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do
  if [ -f "$source_file" ]; then
    sed -i \
      -e "s|http://deb.debian.org|$debian_mirror|g" \
      -e "s|http://security.debian.org/debian-security|$debian_mirror/debian-security|g" \
      "$source_file"
  fi
done
printf 'timestamp=%s operation=apt_mirror attempt=1 status=succeeded reason=tsinghua\n' \
  "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

record_status() {
  operation=$1
  attempt=$2
  status=$3
  reason=$4
  printf 'timestamp=%s operation=apt_%s attempt=%s status=%s reason=%s\n' \
    "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$operation" "$attempt" "$status" "$reason"
}

run_apt() {
  operation=$1
  shift
  attempt=1

  while [ "$attempt" -le "$max_attempts" ]; do
    record_status "$operation" "$attempt" started none
    set +e
    timeout --foreground --signal=TERM --kill-after=5s "${timeout_seconds}s" \
      apt-get \
        -o Acquire::http::Timeout=30 \
        -o Acquire::https::Timeout=30 \
        "$operation" "$@"
    exit_code=$?
    set -e

    if [ "$exit_code" -eq 0 ]; then
      record_status "$operation" "$attempt" succeeded complete
      return 0
    fi

    reason=apt_failed
    if [ "$exit_code" -eq 124 ]; then
      reason=timeout
    fi
    record_status "$operation" "$attempt" failed "$reason"
    if [ "$attempt" -eq "$max_attempts" ]; then
      return "$exit_code"
    fi

    record_status "$operation" "$attempt" retrying "$reason"
    sleep "$retry_delay_seconds"
    attempt=$((attempt + 1))
  done
}

run_apt update
run_apt upgrade --yes
