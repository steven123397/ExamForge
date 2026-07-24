#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
# shellcheck disable=SC1091
source "$repository_root/scripts/deploy/operations-lib.sh"

env_file="$repository_root/.env"
compose_file="$repository_root/compose.production.yml"
online_smoke="$repository_root/scripts/deploy/online-smoke.mjs"
smoke_credentials_file=""
fault_drills=1
safe_path=$PATH
temporary_dir=""
runtime_env=""
node_binary=""
node_container=""

usage() {
  cat <<'EOF'
Usage: scripts/deploy/run-online-smoke.sh [options]

Run the production online smoke with the Node 22 runtime from the deployed API digest.

Options:
  --env-file PATH          Production environment file (default: .env)
  --compose-file PATH      Production Compose file
  --smoke-credentials-file PATH
                           600-permission file containing current ONLINE_* passwords
  --skip-fault-drills      Skip temporary dependency fault drills
  --help                   Show this help
EOF
}

load_smoke_credentials() {
  local path=$1
  local mode owner line variable value
  local -A keys=()

  unset ONLINE_ADMIN_PASSWORD ONLINE_OPERATOR_PASSWORD ONLINE_TEACHER_PASSWORD \
    ONLINE_STUDENT_PASSWORD

  [[ -f "$path" ]] \
    || operations_fail "smoke_credentials_missing" "online_smoke" "smoke_credentials_file_not_found"
  mode=$(stat -c '%a' "$path")
  [[ "$mode" == "600" ]] \
    || operations_fail "smoke_credentials_permissions" "online_smoke" "smoke_credentials_file_must_be_600"
  owner=$(stat -c '%u' "$path")
  [[ "$owner" == "$(id -u)" ]] \
    || operations_fail "smoke_credentials_owner" "online_smoke" "smoke_credentials_file_owner_mismatch"

  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] \
      || operations_fail "smoke_credentials_invalid" "online_smoke" "unsupported_smoke_credentials_line"
    variable=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]}
    case "$variable" in
      ONLINE_ADMIN_PASSWORD|ONLINE_OPERATOR_PASSWORD|ONLINE_TEACHER_PASSWORD|ONLINE_STUDENT_PASSWORD)
        ;;
      *)
        operations_fail "smoke_credentials_invalid" "online_smoke" \
          "smoke_credentials_file_has_unsupported_variable"
        ;;
    esac
    [[ -z "${keys[$variable]+x}" ]] \
      || operations_fail "smoke_credentials_invalid" "online_smoke" "duplicate_smoke_credentials_variable"
    printf -v "$variable" '%s' "$value"
    keys[$variable]=1
  done < "$path"

  for variable in \
    ONLINE_ADMIN_PASSWORD \
    ONLINE_OPERATOR_PASSWORD \
    ONLINE_TEACHER_PASSWORD \
    ONLINE_STUDENT_PASSWORD; do
    [[ -n "${!variable:-}" ]] \
      || operations_fail "smoke_credentials_missing" "online_smoke" "required_smoke_credential_missing"
  done
}

cleanup() {
  local status=$?
  set +e
  if [[ -n "$node_container" ]]; then
    docker container rm "$node_container" >/dev/null 2>&1
  fi
  if [[ -n "$node_binary" && -e "$node_binary" ]]; then
    unlink "$node_binary"
  fi
  if [[ -n "$runtime_env" && -e "$runtime_env" ]]; then
    unlink "$runtime_env"
  fi
  if [[ -n "$temporary_dir" && -d "$temporary_dir" ]]; then
    rmdir "$temporary_dir"
  fi
  exit "$status"
}
trap cleanup EXIT

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || operations_fail "argument_missing" "online_smoke" "env_file_path_required"
      env_file=$2
      shift 2
      ;;
    --compose-file)
      (($# >= 2)) || operations_fail "argument_missing" "online_smoke" "compose_file_path_required"
      compose_file=$2
      shift 2
      ;;
    --smoke-credentials-file)
      (($# >= 2)) || operations_fail "argument_missing" "online_smoke" "smoke_credentials_file_path_required"
      smoke_credentials_file=$2
      shift 2
      ;;
    --skip-fault-drills)
      fault_drills=0
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      operations_fail "argument_invalid" "online_smoke" "unknown_option"
      ;;
  esac
done

[[ -f "$env_file" ]] \
  || operations_fail "environment_missing" "online_smoke" "environment_file_not_found"
[[ -f "$compose_file" ]] \
  || operations_fail "deployment_configuration_missing" "online_smoke" "compose_file_not_found"
[[ -f "$online_smoke" ]] \
  || operations_fail "online_smoke_missing" "online_smoke" "script_not_found"
[[ -n "$smoke_credentials_file" ]] \
  || operations_fail "smoke_credentials_missing" "online_smoke" "smoke_credentials_file_required"

env_file=$(cd "$(dirname "$env_file")" && pwd -P)/$(basename "$env_file")
compose_file=$(cd "$(dirname "$compose_file")" && pwd -P)/$(basename "$compose_file")
smoke_credentials_file=$(cd "$(dirname "$smoke_credentials_file")" && pwd -P)/$(basename "$smoke_credentials_file")

for command in docker mktemp chmod env unlink rmdir; do
  operations_require_command "$command"
done
operations_load_env_file "$env_file"
PATH=$safe_path
export PATH

for variable in \
  EXAMFORGE_API_IMAGE \
  EXAMFORGE_API_PORT \
  EXAMFORGE_WEB_PORT \
  EXAMFORGE_PUBLIC_ORIGIN \
  POSTGRES_USER \
  POSTGRES_DB; do
  operations_require_env "$variable"
done
load_smoke_credentials "$smoke_credentials_file"

[[ "$EXAMFORGE_API_IMAGE" =~ @sha256:[a-f0-9]{64}$ ]] \
  || operations_fail "image_reference_invalid" "online_smoke" "api_image_must_use_immutable_digest"
for port in "$EXAMFORGE_API_PORT" "$EXAMFORGE_WEB_PORT"; do
  [[ "$port" =~ ^[1-9][0-9]{0,4}$ && $((10#$port)) -le 65535 ]] \
    || operations_fail "port_invalid" "online_smoke" "loopback_port_invalid"
done

compose_project_name=${COMPOSE_PROJECT_NAME:-examforge}
[[ "$compose_project_name" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] \
  || operations_fail "compose_project_invalid" "online_smoke" "compose_project_name_invalid"
docker compose version >/dev/null \
  || operations_fail "compose_unavailable" "online_smoke" "docker_compose_plugin_required"
docker image inspect "$EXAMFORGE_API_IMAGE" >/dev/null \
  || operations_fail "online_smoke_image_missing" "online_smoke" "deployed_api_digest_not_present"

temporary_dir=$(mktemp -d "${TMPDIR:-/tmp}/examforge-online-smoke.XXXXXX")
runtime_env="$temporary_dir/.env.online-smoke"
node_binary="$temporary_dir/node"
{
  printf 'EXAMFORGE_PUBLIC_ORIGIN=%s\n' "$EXAMFORGE_PUBLIC_ORIGIN"
  printf 'POSTGRES_USER=%s\n' "$POSTGRES_USER"
  printf 'POSTGRES_DB=%s\n' "$POSTGRES_DB"
  printf 'ONLINE_ADMIN_PASSWORD=%s\n' "$ONLINE_ADMIN_PASSWORD"
  printf 'ONLINE_OPERATOR_PASSWORD=%s\n' "$ONLINE_OPERATOR_PASSWORD"
  printf 'ONLINE_TEACHER_PASSWORD=%s\n' "$ONLINE_TEACHER_PASSWORD"
  printf 'ONLINE_STUDENT_PASSWORD=%s\n' "$ONLINE_STUDENT_PASSWORD"
  printf 'ONLINE_API_BASE_URL=http://127.0.0.1:%s\n' "$EXAMFORGE_API_PORT"
  printf 'ONLINE_WEB_BASE_URL=http://127.0.0.1:%s\n' "$EXAMFORGE_WEB_PORT"
  printf 'ONLINE_COMPOSE_FILE=%s\n' "$compose_file"
  printf 'ONLINE_COMPOSE_ENV_FILE=%s\n' "$env_file"
  printf 'COMPOSE_PROJECT_NAME=%s\n' "$compose_project_name"
  printf 'ONLINE_RUN_FAULT_DRILLS=%s\n' "$fault_drills"
} > "$runtime_env"
chmod 600 "$runtime_env"

node_container=$(docker create --pull=never --entrypoint /bin/true "$EXAMFORGE_API_IMAGE")
docker cp "$node_container:/usr/local/bin/node" "$node_binary"
docker container rm "$node_container" >/dev/null
node_container=""
chmod 700 "$node_binary"

if ! node_version=$("$node_binary" --version 2>/dev/null); then
  operations_fail "online_smoke_runtime_failed" "online_smoke" "released_node_runtime_unavailable"
fi
[[ "$node_version" =~ ^v22\. ]] \
  || operations_fail "online_smoke_runtime_invalid" "online_smoke" "released_node_runtime_must_be_v22"

env -i "PATH=$PATH" "$node_binary" --env-file="$runtime_env" "$online_smoke"
