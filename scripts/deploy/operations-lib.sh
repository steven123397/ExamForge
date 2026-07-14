#!/usr/bin/env bash

declare -Ag OPERATIONS_ENV_KEYS=()
declare -Ag OPERATIONS_METADATA=()

operations_fail() {
  local category=$1
  local component=$2
  local message=$3
  printf 'operation error category=%s component=%s message=%s\n' \
    "$category" "$component" "$message" >&2
  exit 1
}

operations_load_env_file() {
  local path=$1
  [[ -f "$path" ]] \
    || operations_fail "environment_missing" "configuration" "environment_file_not_found"
  local mode
  mode=$(stat -c '%a' "$path")
  [[ "$mode" == "600" ]] \
    || operations_fail "environment_permissions" "configuration" "environment_file_must_be_600"
  local owner
  owner=$(stat -c '%u' "$path")
  [[ "$owner" == "$(id -u)" ]] \
    || operations_fail "environment_owner" "configuration" "environment_file_owner_mismatch"

  OPERATIONS_ENV_KEYS=()
  local line variable value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] \
      || operations_fail "environment_format" "configuration" "unsupported_environment_line"
    variable=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]}
    [[ -z "${OPERATIONS_ENV_KEYS[$variable]+x}" ]] \
      || operations_fail "environment_duplicate" "configuration" "duplicate_environment_variable"
    printf -v "$variable" '%s' "$value"
    export "${variable?}"
    OPERATIONS_ENV_KEYS[$variable]=1
  done < "$path"
}

operations_require_env() {
  local name=$1
  [[ -n "${OPERATIONS_ENV_KEYS[$name]+x}" && -n "${!name:-}" ]] \
    || operations_fail "environment_required" "configuration" "required_environment_variable_missing"
}

operations_require_command() {
  local name=$1
  command -v "$name" >/dev/null 2>&1 \
    || operations_fail "command_missing" "$name" "required_command_unavailable"
}

operations_validate_identifier() {
  local value=$1
  local component=$2
  [[ "$value" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] \
    || operations_fail "identifier_invalid" "$component" "postgres_identifier_invalid"
}

operations_compose() {
  local -a command=(docker compose --env-file "$env_file" -f "$compose_file")
  if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then
    command+=(-p "$COMPOSE_PROJECT_NAME")
  fi
  "${command[@]}" "$@"
}

operations_read_metadata() {
  local path=$1
  [[ -f "$path" ]] \
    || operations_fail "backup_metadata_missing" "postgres_backup" "metadata_file_not_found"
  OPERATIONS_METADATA=()
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^([a-z][a-z0-9_]*)=([A-Za-z0-9_.:+-]+)$ ]] \
      || operations_fail "backup_metadata_invalid" "postgres_backup" "metadata_line_invalid"
    key=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]}
    [[ -z "${OPERATIONS_METADATA[$key]+x}" ]] \
      || operations_fail "backup_metadata_invalid" "postgres_backup" "metadata_key_duplicate"
    OPERATIONS_METADATA[$key]=$value
  done < "$path"
}

operations_require_metadata() {
  local key=$1
  [[ -n "${OPERATIONS_METADATA[$key]+x}" ]] \
    || operations_fail "backup_metadata_invalid" "postgres_backup" "metadata_key_missing"
}

operations_database_summary() {
  local database=$1
  local output_path=$2
  operations_validate_identifier "$database" "postgres_database"
  operations_compose exec -T postgres psql \
    --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align \
    --username "$POSTGRES_USER" --dbname "$database" > "$output_path" <<'SQL'
SELECT key || '=' || value
FROM (
  SELECT 'audit_event_count' AS key, count(*)::text AS value FROM audit_events
  UNION ALL
  SELECT 'exam_batch_count', count(*)::text FROM exam_batches
  UNION ALL
  SELECT 'published_batch_count', count(*)::text
    FROM exam_batches WHERE published_run_id IS NOT NULL
  UNION ALL
  SELECT 'publication_version_count', count(DISTINCT published_run_id)::text
    FROM exam_batches WHERE published_run_id IS NOT NULL
  UNION ALL
  SELECT 'schedule_job_attempt_count', count(*)::text FROM schedule_job_attempts
  UNION ALL
  SELECT 'schedule_job_count', count(*)::text FROM schedule_jobs
  UNION ALL
  SELECT 'schedule_job_event_count', count(*)::text FROM schedule_job_events
  UNION ALL
  SELECT 'schedule_job_event_sequence_violation_count', count(*)::text
  FROM (
    SELECT sequence,
      lag(sequence) OVER (PARTITION BY job_id ORDER BY sequence) AS previous_sequence
    FROM schedule_job_events
  ) AS ordered_events
  WHERE previous_sequence IS NOT NULL AND sequence <= previous_sequence
  UNION ALL
  SELECT 'scheduled_exam_count', count(*)::text FROM scheduled_exams
  UNION ALL
  SELECT 'schema_migration_count', count(*)::text FROM schema_migrations
  UNION ALL
  SELECT 'scope_association_count', (
    (SELECT count(*) FROM user_teacher_scopes)
    + (SELECT count(*) FROM user_student_group_scopes)
  )::text
) AS summary
ORDER BY key;
SQL
  [[ -s "$output_path" ]] \
    || operations_fail "backup_summary_failed" "postgres_backup" "summary_is_empty"
  if ! awk -F= 'NF != 2 || $1 !~ /^[a-z0-9_]+$/ || $2 !~ /^[0-9]+$/ { exit 1 }' \
    "$output_path"; then
    operations_fail "backup_summary_failed" "postgres_backup" "summary_format_invalid"
  fi
  LC_ALL=C sort -c "$output_path" >/dev/null \
    || operations_fail "backup_summary_failed" "postgres_backup" "summary_order_invalid"
}
