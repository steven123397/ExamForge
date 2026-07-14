#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck disable=SC1091
source "$repository_root/scripts/deploy/operations-lib.sh"

env_file="$repository_root/.env.production"
compose_file="$repository_root/compose.production.yml"
local_staging=""
offsite_staging=""
backup_id=""
published=false

usage() {
  cat <<'EOF'
Usage: scripts/deploy/backup-postgres.sh [options]

Options:
  --env-file PATH       Production environment file (default: .env.production)
  --compose-file PATH   Production Compose file (default: compose.production.yml)
  --help                Show this help
EOF
}

cleanup() {
  [[ -z "$local_staging" ]] || rm -rf "$local_staging"
  [[ -z "$offsite_staging" ]] || rm -rf "$offsite_staging"
  if [[ "$published" != "true" && -n "$backup_id" ]]; then
    rm -f "$EXAMFORGE_BACKUP_DIR/$backup_id."{dump,sha256,summary,meta} 2>/dev/null || true
    rm -f "$EXAMFORGE_OFFSITE_BACKUP_DIR/$backup_id."{dump,sha256,summary,meta} \
      2>/dev/null || true
  fi
}
trap cleanup EXIT

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || operations_fail "argument_missing" "backup" "env_file_path_required"
      env_file=$2
      shift 2
      ;;
    --compose-file)
      (($# >= 2)) || operations_fail "argument_missing" "backup" "compose_file_path_required"
      compose_file=$2
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      operations_fail "argument_invalid" "backup" "unknown_option"
      ;;
  esac
done

operations_load_env_file "$env_file"
for name in EXAMFORGE_BACKUP_DIR EXAMFORGE_OFFSITE_BACKUP_DIR POSTGRES_USER POSTGRES_DB; do
  operations_require_env "$name"
done
for command in docker sha256sum stat date awk cp mv mktemp find sort; do
  operations_require_command "$command"
done
[[ -f "$compose_file" ]] \
  || operations_fail "compose_missing" "backup" "compose_file_not_found"
[[ -d "$EXAMFORGE_BACKUP_DIR" && -w "$EXAMFORGE_BACKUP_DIR" ]] \
  || operations_fail "backup_directory_unavailable" "postgres_backup" "local_backup_directory_unavailable"
[[ -d "$EXAMFORGE_OFFSITE_BACKUP_DIR" && -w "$EXAMFORGE_OFFSITE_BACKUP_DIR" ]] \
  || operations_fail "backup_offsite_copy_failed" "postgres_backup" "offsite_directory_unavailable"

operations_validate_identifier "$POSTGRES_USER" "postgres_user"
operations_validate_identifier "$POSTGRES_DB" "postgres_database"
retention_days=${EXAMFORGE_BACKUP_RETENTION_DAYS:-14}
[[ "$retention_days" =~ ^[0-9]+$ ]] \
  || operations_fail "retention_invalid" "postgres_backup" "retention_days_invalid"
((retention_days >= 1 && retention_days <= 365)) \
  || operations_fail "retention_invalid" "postgres_backup" "retention_days_out_of_range"

migration_version=$(operations_compose exec -T postgres psql \
  --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --command 'SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1') \
  || operations_fail "backup_migration_query_failed" "postgres_backup" "migration_version_unavailable"
migration_version=${migration_version//$'\r'/}
migration_version=${migration_version//$'\n'/}
[[ "$migration_version" =~ ^[0-9]{4}_[a-z0-9_]+$ ]] \
  || operations_fail "backup_migration_query_failed" "postgres_backup" "migration_version_invalid"

created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
timestamp=$(date -u +%Y%m%dT%H%M%S%NZ)
backup_id="examforge-$timestamp-$migration_version"
local_staging=$(mktemp -d "$EXAMFORGE_BACKUP_DIR/.staging-$backup_id.XXXXXX")
offsite_staging=$(mktemp -d "$EXAMFORGE_OFFSITE_BACKUP_DIR/.staging-$backup_id.XXXXXX")

dump_file="$local_staging/$backup_id.dump"
summary_file="$local_staging/$backup_id.summary"
checksum_file="$local_staging/$backup_id.sha256"
metadata_file="$local_staging/$backup_id.meta"

if ! operations_compose exec -T postgres pg_dump \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --format=custom --compress=9 --no-owner --no-privileges \
  --serializable-deferrable --lock-wait-timeout=30000 > "$dump_file"; then
  operations_fail "backup_dump_failed" "postgres_backup" "pg_dump_failed"
fi
[[ -s "$dump_file" ]] \
  || operations_fail "backup_dump_failed" "postgres_backup" "pg_dump_empty"
operations_compose exec -T postgres pg_restore --list < "$dump_file" >/dev/null \
  || operations_fail "backup_archive_invalid" "postgres_backup" "pg_restore_list_failed"

operations_database_summary "$POSTGRES_DB" "$summary_file"
dump_sha=$(sha256sum "$dump_file" | awk '{print $1}')
summary_sha=$(sha256sum "$summary_file" | awk '{print $1}')
size_bytes=$(stat -c '%s' "$dump_file")
printf '%s  %s\n' "$dump_sha" "$backup_id.dump" > "$checksum_file"
cat > "$metadata_file" <<EOF
schema_version=1
backup_id=$backup_id
database=$POSTGRES_DB
created_at=$created_at
format=postgresql-custom
migration_version=$migration_version
dump_file=$backup_id.dump
sha256=$dump_sha
size_bytes=$size_bytes
summary_file=$backup_id.summary
summary_sha256=$summary_sha
offsite_status=copied
retention_days=$retention_days
EOF

for extension in dump sha256 summary meta; do
  if ! cp --preserve=mode,timestamps \
    "$local_staging/$backup_id.$extension" "$offsite_staging/$backup_id.$extension"; then
    operations_fail "backup_offsite_copy_failed" "postgres_backup" "offsite_copy_failed"
  fi
done

for extension in dump sha256 summary; do
  mv "$offsite_staging/$backup_id.$extension" \
    "$EXAMFORGE_OFFSITE_BACKUP_DIR/$backup_id.$extension"
done
mv "$offsite_staging/$backup_id.meta" "$EXAMFORGE_OFFSITE_BACKUP_DIR/$backup_id.meta"
for extension in dump sha256 summary; do
  mv "$local_staging/$backup_id.$extension" "$EXAMFORGE_BACKUP_DIR/$backup_id.$extension"
done
mv "$local_staging/$backup_id.meta" "$EXAMFORGE_BACKUP_DIR/$backup_id.meta"
published=true

while IFS= read -r -d '' expired_metadata; do
  expired_id=$(basename "$expired_metadata" .meta)
  [[ "$expired_id" =~ ^examforge-[0-9]{8}T[0-9]{15}Z-[0-9]{4}_[a-z0-9_]+$ ]] || continue
  [[ "$expired_id" != "$backup_id" ]] || continue
  rm -f "$EXAMFORGE_BACKUP_DIR/$expired_id."{dump,sha256,summary,meta}
  rm -f "$EXAMFORGE_OFFSITE_BACKUP_DIR/$expired_id."{dump,sha256,summary,meta}
done < <(find "$EXAMFORGE_BACKUP_DIR" -maxdepth 1 -type f \
  -name 'examforge-*.meta' -mtime "+$retention_days" -print0)

printf 'Backup completed id=%s manifest=%s\n' \
  "$backup_id" "$EXAMFORGE_BACKUP_DIR/$backup_id.meta"
