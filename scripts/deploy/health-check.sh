#!/usr/bin/env bash

set -Eeuo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck disable=SC1091
source "$repository_root/scripts/deploy/operations-lib.sh"

env_file="$repository_root/.env.production"
compose_file="$repository_root/compose.production.yml"
only_check="all"
now_epoch=""
min_free_kib=""
max_backup_age_seconds=""
certificate_warning_days=""
failure_count=0

usage() {
  cat <<'EOF'
Usage: scripts/deploy/health-check.sh [options]

Options:
  --env-file PATH                  Production environment file
  --compose-file PATH              Production Compose file
  --only NAME                      Run only certificate, disk, runtime or backup
  --now-epoch SECONDS              Override current time for deterministic checks
  --min-free-kib KIB               Override the data disk free-space threshold
  --max-backup-age-seconds SECONDS Override the latest backup age threshold
  --certificate-warning-days DAYS  Override the certificate warning window
  --help                           Show this help
EOF
}

record_error() {
  local category=$1
  local component=$2
  printf 'health-check error category=%s component=%s\n' "$category" "$component" >&2
  failure_count=$((failure_count + 1))
}

record_ok() {
  local component=$1
  printf 'health-check ok component=%s\n' "$component"
}

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || operations_fail "argument_missing" "health_check" "env_file_path_required"
      env_file=$2
      shift 2
      ;;
    --compose-file)
      (($# >= 2)) || operations_fail "argument_missing" "health_check" "compose_file_path_required"
      compose_file=$2
      shift 2
      ;;
    --only)
      (($# >= 2)) || operations_fail "argument_missing" "health_check" "check_name_required"
      only_check=$2
      shift 2
      ;;
    --now-epoch)
      (($# >= 2)) || operations_fail "argument_missing" "health_check" "epoch_required"
      now_epoch=$2
      shift 2
      ;;
    --min-free-kib)
      (($# >= 2)) || operations_fail "argument_missing" "health_check" "disk_threshold_required"
      min_free_kib=$2
      shift 2
      ;;
    --max-backup-age-seconds)
      (($# >= 2)) || operations_fail "argument_missing" "health_check" "backup_threshold_required"
      max_backup_age_seconds=$2
      shift 2
      ;;
    --certificate-warning-days)
      (($# >= 2)) || operations_fail "argument_missing" "health_check" "certificate_threshold_required"
      certificate_warning_days=$2
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      operations_fail "argument_invalid" "health_check" "unknown_option"
      ;;
  esac
done

[[ "$only_check" =~ ^(all|certificate|disk|runtime|backup)$ ]] \
  || operations_fail "argument_invalid" "health_check" "unsupported_check_name"
operations_load_env_file "$env_file"
now_epoch=${now_epoch:-$(date -u +%s)}
min_free_kib=${min_free_kib:-${EXAMFORGE_MIN_FREE_KIB:-5242880}}
max_backup_age_seconds=${max_backup_age_seconds:-${EXAMFORGE_MAX_BACKUP_AGE_SECONDS:-93600}}
certificate_warning_days=${certificate_warning_days:-${EXAMFORGE_CERTIFICATE_WARNING_DAYS:-21}}
for value in "$now_epoch" "$min_free_kib" "$max_backup_age_seconds" "$certificate_warning_days"; do
  [[ "$value" =~ ^[0-9]+$ ]] \
    || operations_fail "threshold_invalid" "health_check" "numeric_threshold_required"
done

check_certificate() {
  operations_require_env "EXAMFORGE_TLS_CERTIFICATE_PATH"
  operations_require_command "openssl"
  if [[ ! -r "$EXAMFORGE_TLS_CERTIFICATE_PATH" ]]; then
    record_error "certificate_missing" "tls"
    return
  fi
  local warning_seconds=$((certificate_warning_days * 86400))
  if ! openssl x509 -checkend "$warning_seconds" -noout \
    -in "$EXAMFORGE_TLS_CERTIFICATE_PATH" >/dev/null 2>&1; then
    record_error "certificate_expiring" "tls"
    return
  fi
  record_ok "tls"
}

check_disk() {
  operations_require_env "EXAMFORGE_DATA_DIR"
  operations_require_command "df"
  local available_kib
  available_kib=$(df -Pk "$EXAMFORGE_DATA_DIR" | awk 'NR == 2 { print $4 }')
  if [[ ! "$available_kib" =~ ^[0-9]+$ ]] || ((available_kib < min_free_kib)); then
    record_error "disk_space_low" "data_disk"
    return
  fi
  record_ok "data_disk"
}

check_runtime() {
  operations_require_env "EXAMFORGE_API_PORT"
  operations_require_command "docker"
  operations_require_command "curl"
  if [[ ! -f "$compose_file" ]]; then
    record_error "compose_missing" "runtime"
    return
  fi

  local service container_id state health
  for service in postgres redis scheduler publisher worker api web; do
    if ! container_id=$(operations_compose ps -q "$service" 2>/dev/null) \
      || [[ -z "$container_id" ]]; then
      record_error "container_missing" "$service"
      continue
    fi
    state=$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)
    if [[ "$state" != "running" ]]; then
      record_error "container_not_running" "$service"
      continue
    fi
    health=$(docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
      "$container_id" 2>/dev/null || true)
    if [[ "$health" != "healthy" ]]; then
      record_error "container_unhealthy" "$service"
      continue
    fi
    record_ok "$service"
  done

  if ! curl --fail --silent --show-error --max-time 5 \
    "http://127.0.0.1:$EXAMFORGE_API_PORT/ready" >/dev/null 2>&1; then
    record_error "readiness_failed" "api"
  else
    record_ok "api_readiness"
  fi
  if ! operations_compose exec -T publisher node -e \
    "fetch('http://127.0.0.1:4010/ready',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; then
    record_error "readiness_failed" "publisher"
  else
    record_ok "publisher_readiness"
  fi
  if ! operations_compose exec -T worker node -e \
    "fetch('http://127.0.0.1:4010/ready',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; then
    record_error "readiness_failed" "worker"
  else
    record_ok "worker_readiness"
  fi
  if ! operations_compose exec -T scheduler python -c \
    "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=3).read()" \
    >/dev/null 2>&1; then
    record_error "readiness_failed" "scheduler"
  else
    record_ok "scheduler_readiness"
  fi
}

check_backup() {
  operations_require_env "EXAMFORGE_BACKUP_DIR"
  operations_require_env "EXAMFORGE_OFFSITE_BACKUP_DIR"
  operations_require_command "date"
  operations_require_command "sha256sum"
  operations_require_command "stat"
  local latest_metadata=""
  local latest_mtime=0
  local metadata mtime
  shopt -s nullglob
  for metadata in "$EXAMFORGE_BACKUP_DIR"/examforge-*.meta; do
    mtime=$(stat -c '%Y' "$metadata" 2>/dev/null || printf '0')
    if [[ "$mtime" =~ ^[0-9]+$ ]] && ((mtime > latest_mtime)); then
      latest_mtime=$mtime
      latest_metadata=$metadata
    fi
  done
  shopt -u nullglob
  if [[ -z "$latest_metadata" ]]; then
    record_error "backup_missing" "postgres_backup"
    return
  fi

  operations_read_metadata "$latest_metadata"
  for key in backup_id created_at dump_file sha256 summary_file summary_sha256 offsite_status; do
    operations_require_metadata "$key"
  done
  local created_epoch age_seconds backup_directory dump_path summary_path actual_sha
  if ! created_epoch=$(date -u -d "${OPERATIONS_METADATA[created_at]}" +%s 2>/dev/null); then
    record_error "backup_metadata_invalid" "postgres_backup"
    return
  fi
  age_seconds=$((now_epoch - created_epoch))
  if ((age_seconds < 0)); then
    record_error "backup_clock_skew" "postgres_backup"
    return
  fi
  if ((age_seconds > max_backup_age_seconds)); then
    record_error "backup_stale" "postgres_backup"
    return
  fi
  backup_directory=$(dirname "$latest_metadata")
  dump_path="$backup_directory/${OPERATIONS_METADATA[dump_file]}"
  summary_path="$backup_directory/${OPERATIONS_METADATA[summary_file]}"
  if [[ ! -f "$dump_path" || ! -f "$summary_path" ]]; then
    record_error "backup_attachment_missing" "postgres_backup"
    return
  fi
  actual_sha=$(sha256sum "$dump_path" | awk '{print $1}')
  if [[ "$actual_sha" != "${OPERATIONS_METADATA[sha256]}" ]]; then
    record_error "backup_checksum_mismatch" "postgres_backup"
    return
  fi
  actual_sha=$(sha256sum "$summary_path" | awk '{print $1}')
  if [[ "$actual_sha" != "${OPERATIONS_METADATA[summary_sha256]}" ]]; then
    record_error "backup_checksum_mismatch" "postgres_backup"
    return
  fi
  if [[ "${OPERATIONS_METADATA[offsite_status]}" != "copied" ]]; then
    record_error "backup_offsite_missing" "postgres_backup"
    return
  fi
  local extension backup_id=${OPERATIONS_METADATA[backup_id]}
  for extension in dump sha256 summary meta; do
    if [[ ! -f "$EXAMFORGE_OFFSITE_BACKUP_DIR/$backup_id.$extension" ]]; then
      record_error "backup_offsite_missing" "postgres_backup"
      return
    fi
  done
  record_ok "postgres_backup"
}

case "$only_check" in
  all)
    check_certificate
    check_disk
    check_runtime
    check_backup
    ;;
  certificate) check_certificate ;;
  disk) check_disk ;;
  runtime) check_runtime ;;
  backup) check_backup ;;
esac

if ((failure_count > 0)); then
  printf 'health-check failed count=%d\n' "$failure_count" >&2
  exit 1
fi
printf 'health-check passed\n'
