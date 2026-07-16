#!/usr/bin/env bash

set -Eeuo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
env_file="$repository_root/.env.production"
compose_file="$repository_root/compose.production.yml"
validate_env_only=false
skip_image_check=false
read_only=false
hot_root_prefix="/srv/data/hot"
offsite_root_prefix="/srv/data/cos"

usage() {
  cat <<'EOF'
Usage: scripts/deploy/preflight.sh [options]

Options:
  --env-file PATH          Production environment file (default: .env.production)
  --compose-file PATH      Production Compose file (default: compose.production.yml)
  --validate-env-only      Validate file permissions and values, then stop
  --skip-image-check       Skip remote digest manifest checks
  --read-only              Explicitly document that this invocation must not mutate the host
  --hot-root-prefix PATH   Override the allowed hot-data root for isolated local validation
  --offsite-root-prefix PATH
                           Override the allowed offsite root for isolated local validation
  --help                   Show this help
EOF
}

fail() {
  printf 'Preflight failed: %s\n' "$*" >&2
  exit 1
}

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || fail "--env-file requires a path."
      env_file=$2
      shift 2
      ;;
    --compose-file)
      (($# >= 2)) || fail "--compose-file requires a path."
      compose_file=$2
      shift 2
      ;;
    --validate-env-only)
      validate_env_only=true
      shift
      ;;
    --skip-image-check)
      skip_image_check=true
      shift
      ;;
    --read-only)
      read_only=true
      shift
      ;;
    --hot-root-prefix)
      (($# >= 2)) || fail "--hot-root-prefix requires a path."
      hot_root_prefix=$2
      shift 2
      ;;
    --offsite-root-prefix)
      (($# >= 2)) || fail "--offsite-root-prefix requires a path."
      offsite_root_prefix=$2
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

[[ -f "$env_file" ]] || fail "environment file does not exist: $env_file"
[[ -f "$compose_file" ]] || fail "Compose file does not exist: $compose_file"

env_mode=$(stat -c '%a' "$env_file")
[[ "$env_mode" == "600" ]] || fail "environment file must use mode 600 (found $env_mode)."
env_owner=$(stat -c '%u' "$env_file")
[[ "$env_owner" == "$(id -u)" ]] || fail "environment file must be owned by the deployment user."

declare -A loaded_variables=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line=${line%$'\r'}
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] \
    || fail "environment file contains an unsupported line."
  variable=${BASH_REMATCH[1]}
  value=${BASH_REMATCH[2]}
  [[ -z "${loaded_variables[$variable]:-}" ]] \
    || fail "environment variable is defined more than once: $variable"
  [[ "$value" != *$'\n'* ]] || fail "environment values must remain single-line."
  printf -v "$variable" '%s' "$value"
  export "${variable?}"
  loaded_variables[$variable]=1
done < "$env_file"

require_variable() {
  local name=$1
  [[ -n "${loaded_variables[$name]:-}" ]] || fail "$name must be defined in the environment file."
  [[ -n "${!name:-}" ]] || fail "$name must not be empty."
}

image_variables=(
  EXAMFORGE_API_IMAGE
  EXAMFORGE_WEB_IMAGE
  EXAMFORGE_WORKER_IMAGE
  EXAMFORGE_SCHEDULER_IMAGE
  EXAMFORGE_POSTGRES_IMAGE
  EXAMFORGE_REDIS_IMAGE
)
for variable in "${image_variables[@]}"; do
  require_variable "$variable"
  [[ "${!variable}" =~ ^[^[:space:]]+@sha256:[a-f0-9]{64}$ ]] \
    || fail "$variable must contain an immutable sha256 digest."
done

required_variables=(
  EXAMFORGE_PUBLIC_ORIGIN
  EXAMFORGE_TRUSTED_ORIGINS
  EXAMFORGE_API_PORT
  EXAMFORGE_WEB_PORT
  EXAMFORGE_DATA_DIR
  EXAMFORGE_BACKUP_DIR
  EXAMFORGE_OFFSITE_BACKUP_DIR
  EXAMFORGE_BACKUP_RETENTION_DAYS
  EXAMFORGE_MAX_BACKUP_AGE_SECONDS
  EXAMFORGE_MIN_FREE_KIB
  EXAMFORGE_CERTIFICATE_WARNING_DAYS
  EXAMFORGE_TLS_CERTIFICATE_PATH
  POSTGRES_USER
  POSTGRES_PASSWORD
  POSTGRES_DB
  EXAMFORGE_ADMIN_PASSWORD
  EXAMFORGE_OPERATOR_PASSWORD
  EXAMFORGE_TEACHER_PASSWORD
  EXAMFORGE_STUDENT_PASSWORD
  EXAMFORGE_SESSION_COOKIE_SECURE
  EXAMFORGE_SESSION_TTL_SECONDS
  SCHEDULE_JOB_MAX_ATTEMPTS
  SCHEDULE_JOB_RETRY_BASE_DELAY_MS
)
for variable in "${required_variables[@]}"; do
  require_variable "$variable"
done

[[ "$EXAMFORGE_PUBLIC_ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] \
  || fail "EXAMFORGE_PUBLIC_ORIGIN must be one exact HTTPS origin."
[[ "$EXAMFORGE_TRUSTED_ORIGINS" == "$EXAMFORGE_PUBLIC_ORIGIN" ]] \
  || fail "EXAMFORGE_TRUSTED_ORIGINS must exactly match EXAMFORGE_PUBLIC_ORIGIN for production."
[[ "$EXAMFORGE_SESSION_COOKIE_SECURE" == "true" ]] \
  || fail "EXAMFORGE_SESSION_COOKIE_SECURE must be true."
[[ "$EXAMFORGE_SESSION_TTL_SECONDS" =~ ^[0-9]+$ ]] \
  || fail "EXAMFORGE_SESSION_TTL_SECONDS must be an integer."
((EXAMFORGE_SESSION_TTL_SECONDS >= 300 && EXAMFORGE_SESSION_TTL_SECONDS <= 604800)) \
  || fail "EXAMFORGE_SESSION_TTL_SECONDS must be between 300 and 604800."

[[ "$SCHEDULE_JOB_MAX_ATTEMPTS" =~ ^[0-9]{1,2}$ ]] \
  || fail "SCHEDULE_JOB_MAX_ATTEMPTS must be an integer between 2 and 10."
schedule_job_max_attempts=$((10#$SCHEDULE_JOB_MAX_ATTEMPTS))
((schedule_job_max_attempts >= 2 && schedule_job_max_attempts <= 10)) \
  || fail "SCHEDULE_JOB_MAX_ATTEMPTS must be an integer between 2 and 10."
[[ "$SCHEDULE_JOB_RETRY_BASE_DELAY_MS" =~ ^[0-9]{1,5}$ ]] \
  || fail "SCHEDULE_JOB_RETRY_BASE_DELAY_MS must be an integer between 1 and 30000."
schedule_job_retry_delay_ms=$((10#$SCHEDULE_JOB_RETRY_BASE_DELAY_MS))
((schedule_job_retry_delay_ms >= 1 && schedule_job_retry_delay_ms <= 30000)) \
  || fail "SCHEDULE_JOB_RETRY_BASE_DELAY_MS must be an integer between 1 and 30000."
schedule_job_final_retry_delay_ms=$schedule_job_retry_delay_ms
for ((attempt = 2; attempt < schedule_job_max_attempts; attempt += 1)); do
  ((schedule_job_final_retry_delay_ms *= 2))
done
((schedule_job_final_retry_delay_ms <= 30000)) \
  || fail "Schedule job final retry delay must not exceed 30000 ms."

for variable in EXAMFORGE_API_PORT EXAMFORGE_WEB_PORT; do
  [[ "${!variable}" =~ ^[0-9]+$ ]] || fail "$variable must be a TCP port."
  (( ${!variable} >= 1 && ${!variable} <= 65535 )) || fail "$variable is out of range."
done
[[ "$EXAMFORGE_API_PORT" != "$EXAMFORGE_WEB_PORT" ]] \
  || fail "API and Web ports must be different."

[[ "$POSTGRES_USER" =~ ^[a-z_][a-z0-9_-]{0,62}$ ]] \
  || fail "POSTGRES_USER contains unsupported characters."
[[ "$POSTGRES_DB" =~ ^[a-z_][a-z0-9_-]{0,62}$ ]] \
  || fail "POSTGRES_DB contains unsupported characters."
[[ "$POSTGRES_PASSWORD" =~ ^[A-Za-z0-9_-]{24,}$ ]] \
  || fail "POSTGRES_PASSWORD must be URL-safe and contain at least 24 characters."

password_variables=(
  EXAMFORGE_ADMIN_PASSWORD
  EXAMFORGE_OPERATOR_PASSWORD
  EXAMFORGE_TEACHER_PASSWORD
  EXAMFORGE_STUDENT_PASSWORD
)
declare -A seen_passwords=()
for variable in "${password_variables[@]}"; do
  value=${!variable}
  ((${#value} >= 20)) || fail "$variable must contain at least 20 characters."
  lower_value=${value,,}
  [[ ! "$lower_value" =~ (change[-_[:space:]]?me|replace|example|placeholder|\<|\>) ]] \
    || fail "$variable must not contain a placeholder value."
  [[ -z "${seen_passwords[$value]:-}" ]] || fail "role passwords must be unique."
  [[ "$value" != "$POSTGRES_PASSWORD" ]] || fail "role passwords must differ from POSTGRES_PASSWORD."
  seen_passwords[$value]=1
done

validate_absolute_directory() {
  local path=$1
  local prefix=$2
  local name=$3
  [[ "$path" == "$prefix"/* && "$path" != *"/../"* && "$path" != */.. ]] \
    || fail "$name must be an absolute child of $prefix."
}

[[ "$hot_root_prefix" == /* && "$hot_root_prefix" != "/" ]] \
  || fail "hot data root prefix must be an absolute non-root path."
[[ "$offsite_root_prefix" == /* && "$offsite_root_prefix" != "/" ]] \
  || fail "offsite root prefix must be an absolute non-root path."
validate_absolute_directory "$EXAMFORGE_DATA_DIR" "$hot_root_prefix" "EXAMFORGE_DATA_DIR"
validate_absolute_directory "$EXAMFORGE_BACKUP_DIR" "$hot_root_prefix" "EXAMFORGE_BACKUP_DIR"
validate_absolute_directory "$EXAMFORGE_OFFSITE_BACKUP_DIR" "$offsite_root_prefix" "EXAMFORGE_OFFSITE_BACKUP_DIR"

for variable in EXAMFORGE_BACKUP_RETENTION_DAYS EXAMFORGE_MAX_BACKUP_AGE_SECONDS \
  EXAMFORGE_MIN_FREE_KIB EXAMFORGE_CERTIFICATE_WARNING_DAYS; do
  [[ "${!variable}" =~ ^[0-9]+$ ]] || fail "$variable must be an integer."
done
((EXAMFORGE_BACKUP_RETENTION_DAYS >= 1 && EXAMFORGE_BACKUP_RETENTION_DAYS <= 365)) \
  || fail "EXAMFORGE_BACKUP_RETENTION_DAYS must be between 1 and 365."
((EXAMFORGE_MAX_BACKUP_AGE_SECONDS >= 3600 && EXAMFORGE_MAX_BACKUP_AGE_SECONDS <= 604800)) \
  || fail "EXAMFORGE_MAX_BACKUP_AGE_SECONDS must be between 3600 and 604800."
((EXAMFORGE_MIN_FREE_KIB >= 1048576)) \
  || fail "EXAMFORGE_MIN_FREE_KIB must be at least 1 GiB."
((EXAMFORGE_CERTIFICATE_WARNING_DAYS >= 1 && EXAMFORGE_CERTIFICATE_WARNING_DAYS <= 90)) \
  || fail "EXAMFORGE_CERTIFICATE_WARNING_DAYS must be between 1 and 90."
[[ "$EXAMFORGE_TLS_CERTIFICATE_PATH" =~ ^/etc/letsencrypt/live/[A-Za-z0-9.-]+/fullchain\.pem$ ]] \
  || fail "EXAMFORGE_TLS_CERTIFICATE_PATH must point to a Certbot fullchain.pem."

if [[ "$validate_env_only" == "true" ]]; then
  printf 'Production environment validation passed.\n'
  exit 0
fi

for command in docker df ss; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is unavailable: $command"
done
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is unavailable."
docker compose --env-file "$env_file" -f "$compose_file" config --quiet \
  || fail "production Compose configuration is invalid."

check_directory() {
  local path=$1
  local expected_uid=$2
  local expected_gid=$3
  local require_current_access=$4
  [[ -d "$path" ]] || fail "required directory does not exist: $path"
  local actual_uid
  actual_uid=$(stat -c '%u' "$path")
  [[ "$actual_uid" == "$expected_uid" ]] \
    || fail "$path must be owned by UID $expected_uid (found $actual_uid)."
  local actual_gid
  actual_gid=$(stat -c '%g' "$path")
  [[ "$actual_gid" == "$expected_gid" ]] \
    || fail "$path must be owned by GID $expected_gid (found $actual_gid)."
  if [[ "$require_current_access" == "true" ]]; then
    [[ -r "$path" && -w "$path" && -x "$path" ]] || fail "directory is not accessible: $path"
    return
  fi
  local permissions owner_permissions
  permissions=$(stat -c '%a' "$path")
  owner_permissions=${permissions: -3:1}
  (( (10#$owner_permissions & 3) == 3 )) \
    || fail "$path owner must have write and execute permissions."
}

deployment_uid=$(id -u)
deployment_gid=$(id -g)
check_directory "$EXAMFORGE_DATA_DIR" "$deployment_uid" "$deployment_gid" "true"
check_directory "$EXAMFORGE_DATA_DIR/postgres" "70" "70" "false"
check_directory "$EXAMFORGE_DATA_DIR/redis" "999" "1000" "false"
check_directory "$EXAMFORGE_BACKUP_DIR" "$deployment_uid" "$deployment_gid" "true"
check_directory "$EXAMFORGE_OFFSITE_BACKUP_DIR" "$deployment_uid" "$deployment_gid" "true"

available_kib=$(df -Pk "$EXAMFORGE_DATA_DIR" | awk 'NR == 2 { print $4 }')
[[ "$available_kib" =~ ^[0-9]+$ ]] || fail "could not determine available data disk space."
((available_kib >= 5 * 1024 * 1024)) || fail "data disk must have at least 5 GiB free."

memory_kib=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)
[[ "$memory_kib" =~ ^[0-9]+$ ]] || fail "could not determine total memory."
((memory_kib >= 3500000)) || fail "host must provide at least 3.5 million KiB of memory."

port_is_listening() {
  local port=$1
  ss -H -ltn | awk -v expected=":$port" '$4 ~ expected "$" { found = 1 } END { exit(found ? 0 : 1) }'
}
for port in "$EXAMFORGE_API_PORT" "$EXAMFORGE_WEB_PORT"; do
  ! port_is_listening "$port" || fail "host port is already in use: $port"
done

if [[ "$skip_image_check" != "true" ]]; then
  for variable in "${image_variables[@]}"; do
    docker manifest inspect "${!variable}" >/dev/null \
      || fail "image digest is not readable with current registry credentials: $variable"
  done
fi

if [[ "$read_only" == "true" ]]; then
  printf 'Read-only production preflight passed; no host state was changed.\n'
else
  printf 'Production preflight passed; this script did not change host state.\n'
fi
