#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck disable=SC1091
source "$repository_root/scripts/deploy/operations-lib.sh"

env_file="$repository_root/.env.production"
compose_file="$repository_root/compose.production.yml"
backup_metadata=""
target_database=""
confirmed=false
restored_summary=""

usage() {
  cat <<'EOF'
Usage: scripts/deploy/restore-postgres.sh [options]

Options:
  --env-file PATH            Production environment file (default: .env.production)
  --compose-file PATH        Production Compose file (default: compose.production.yml)
  --backup PATH              Backup .meta file
  --target-database NAME     Existing disposable target database
  --confirm-disposable       Confirm destructive writes to the marked target
  --help                     Show this help
EOF
}

cleanup() {
  [[ -z "$restored_summary" ]] || rm -f "$restored_summary"
}
trap cleanup EXIT

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || operations_fail "argument_missing" "restore" "env_file_path_required"
      env_file=$2
      shift 2
      ;;
    --compose-file)
      (($# >= 2)) || operations_fail "argument_missing" "restore" "compose_file_path_required"
      compose_file=$2
      shift 2
      ;;
    --backup)
      (($# >= 2)) || operations_fail "argument_missing" "restore" "backup_path_required"
      backup_metadata=$2
      shift 2
      ;;
    --target-database)
      (($# >= 2)) || operations_fail "argument_missing" "restore" "target_database_required"
      target_database=$2
      shift 2
      ;;
    --confirm-disposable)
      confirmed=true
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      operations_fail "argument_invalid" "restore" "unknown_option"
      ;;
  esac
done

[[ -n "$backup_metadata" ]] \
  || operations_fail "argument_missing" "restore" "backup_path_required"
[[ -n "$target_database" ]] \
  || operations_fail "argument_missing" "restore" "target_database_required"
[[ "$confirmed" == "true" ]] \
  || operations_fail "restore_confirmation_missing" "postgres_restore" "confirm_disposable_required"

operations_load_env_file "$env_file"
for name in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; do
  operations_require_env "$name"
done
for command in docker sha256sum awk cmp mktemp grep dirname basename; do
  operations_require_command "$command"
done
[[ -f "$compose_file" ]] \
  || operations_fail "compose_missing" "restore" "compose_file_not_found"
operations_validate_identifier "$POSTGRES_USER" "postgres_user"
operations_validate_identifier "$POSTGRES_DB" "postgres_database"
operations_validate_identifier "$target_database" "restore_target"
[[ "$target_database" != "$POSTGRES_DB" && "$target_database" == *_disposable ]] \
  || operations_fail "restore_target_not_disposable" "postgres_restore" "target_database_name_rejected"

target_marker=$(operations_compose exec -T postgres psql \
  --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align \
  --username "$POSTGRES_USER" --dbname postgres \
  --command "SELECT coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = '$target_database'") \
  || operations_fail "restore_target_unavailable" "postgres_restore" "target_database_query_failed"
target_marker=${target_marker//$'\r'/}
target_marker=${target_marker//$'\n'/}
[[ "$target_marker" == "examforge.disposable=true" ]] \
  || operations_fail "restore_target_not_disposable" "postgres_restore" "database_marker_missing"

operations_read_metadata "$backup_metadata"
for key in schema_version backup_id database created_at format migration_version dump_file \
  sha256 size_bytes summary_file summary_sha256 offsite_status retention_days; do
  operations_require_metadata "$key"
done
[[ "${OPERATIONS_METADATA[schema_version]}" == "1" \
  && "${OPERATIONS_METADATA[format]}" == "postgresql-custom" \
  && "${OPERATIONS_METADATA[database]}" == "$POSTGRES_DB" \
  && "${OPERATIONS_METADATA[offsite_status]}" == "copied" ]] \
  || operations_fail "backup_metadata_invalid" "postgres_backup" "metadata_contract_mismatch"
backup_id=${OPERATIONS_METADATA[backup_id]}
[[ "$backup_id" =~ ^examforge-[0-9]{8}T[0-9]{15}Z-[0-9]{4}_[a-z0-9_]+$ ]] \
  || operations_fail "backup_metadata_invalid" "postgres_backup" "backup_id_invalid"
[[ "${OPERATIONS_METADATA[dump_file]}" == "$backup_id.dump" \
  && "${OPERATIONS_METADATA[summary_file]}" == "$backup_id.summary" ]] \
  || operations_fail "backup_metadata_invalid" "postgres_backup" "attachment_name_invalid"

backup_directory=$(dirname "$backup_metadata")
dump_path="$backup_directory/${OPERATIONS_METADATA[dump_file]}"
source_summary="$backup_directory/${OPERATIONS_METADATA[summary_file]}"
[[ -f "$dump_path" && -f "$source_summary" ]] \
  || operations_fail "backup_attachment_missing" "postgres_backup" "backup_attachment_not_found"
actual_dump_sha=$(sha256sum "$dump_path" | awk '{print $1}')
actual_summary_sha=$(sha256sum "$source_summary" | awk '{print $1}')
[[ "$actual_dump_sha" == "${OPERATIONS_METADATA[sha256]}" \
  && "$actual_summary_sha" == "${OPERATIONS_METADATA[summary_sha256]}" ]] \
  || operations_fail "backup_checksum_mismatch" "postgres_backup" "backup_attachment_tampered"

if ! operations_compose exec -T postgres pg_restore \
  --username "$POSTGRES_USER" --dbname "$target_database" \
  --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction \
  < "$dump_path" >/dev/null; then
  operations_fail "restore_archive_failed" "postgres_restore" "pg_restore_failed"
fi

database_url="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$target_database"
if ! migration_check_output=$(operations_compose run --rm --no-deps -T \
  -e "DATABASE_URL=$database_url" migrate \
  node packages/db/dist/migration-check.js 2>/dev/null); then
  operations_fail "restore_migration_check_failed" "postgres_restore" "migration_check_command_failed"
fi
for expected in \
  '"firstRunAppliedCount": 0' \
  '"secondRunAppliedCount": 0' \
  '"missingTables": []' \
  '"missingConstraints": []' \
  '"backfillMismatches": []' \
  '"legacyRelationColumns": []' \
  '"constraintProfileMismatches": []'; do
  grep -Fq "$expected" <<< "$migration_check_output" \
    || operations_fail "restore_migration_check_failed" "postgres_restore" "migration_check_result_invalid"
done

# The redacted summary covers user_teacher_scopes, user_student_group_scopes,
# published_run_id, schedule_job_events, schedule_job_attempts and audit_events.
restored_summary=$(mktemp)
operations_database_summary "$target_database" "$restored_summary"
cmp -s "$source_summary" "$restored_summary" \
  || operations_fail "restore_summary_mismatch" "postgres_restore" "redacted_summary_differs"

printf 'Restore verification passed backup_id=%s target_database=%s\n' \
  "$backup_id" "$target_database"
