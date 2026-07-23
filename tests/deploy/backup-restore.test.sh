#!/usr/bin/env bash

set -Eeuo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
backup_script="$repository_root/scripts/deploy/backup-postgres.sh"
restore_script="$repository_root/scripts/deploy/restore-postgres.sh"
postgres_image="postgres:16-alpine"
node_image="node:22.22.2-bookworm-slim"
project_name="examforge-backup-test-$$"
fixture_dir=$(mktemp -d)
compose_file="$fixture_dir/compose.yml"
env_file="$fixture_dir/.env.production"
backup_dir="$fixture_dir/backups"
offsite_dir="$fixture_dir/offsite"
source_database="examforge"
restore_database="examforge_restore_disposable"

cleanup() {
  docker compose --env-file "$env_file" -f "$compose_file" -p "$project_name" \
    down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$fixture_dir"
}
trap cleanup EXIT

fail() {
  printf 'backup-restore test failed: %s\n' "$*" >&2
  exit 1
}

[[ -x "$backup_script" ]] || fail "backup script is missing or not executable"
[[ -x "$restore_script" ]] || fail "restore script is missing or not executable"

mkdir -p "$backup_dir" "$offsite_dir"

cat > "$compose_file" <<EOF
services:
  postgres:
    image: $postgres_image
    environment:
      POSTGRES_USER: examforge
      POSTGRES_PASSWORD: backup-test-postgres-password
      POSTGRES_DB: $source_database
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U examforge -d $source_database"]
      interval: 1s
      timeout: 2s
      retries: 30
  migrate:
    image: $node_image
    working_dir: /repo
    volumes:
      - type: bind
        source: $repository_root
        target: /repo
        read_only: true
    command: ["node", "packages/db/dist/migration-check.js"]
EOF

cat > "$env_file" <<EOF
COMPOSE_PROJECT_NAME=$project_name
EXAMFORGE_BACKUP_DIR=$backup_dir
EXAMFORGE_OFFSITE_BACKUP_DIR=$offsite_dir
EXAMFORGE_BACKUP_RETENTION_DAYS=14
POSTGRES_USER=examforge
POSTGRES_PASSWORD=backup-test-postgres-password
POSTGRES_DB=$source_database
EOF
chmod 600 "$env_file"

npm run build --workspace @examforge/shared >/dev/null
npm run build --workspace @examforge/scheduling-application >/dev/null
npm run build --workspace @examforge/db >/dev/null

docker compose --env-file "$env_file" -f "$compose_file" -p "$project_name" \
  up -d --wait postgres >/dev/null

database_url="postgres://examforge:backup-test-postgres-password@postgres:5432/$source_database"
docker compose --env-file "$env_file" -f "$compose_file" -p "$project_name" \
  run --rm --no-deps -T -e "DATABASE_URL=$database_url" migrate \
  node packages/db/dist/migrations.js >/dev/null

docker compose --env-file "$env_file" -f "$compose_file" -p "$project_name" \
  exec -T postgres psql -v ON_ERROR_STOP=1 -U examforge -d "$source_database" >/dev/null <<'SQL'
INSERT INTO users (
  id, username, display_name, password_hash, password_salt,
  scrypt_n, scrypt_r, scrypt_p, scrypt_key_length
) VALUES (
  'backup-user', 'teacher', 'Backup Teacher', 'redacted-hash', 'redacted-salt',
  2, 1, 1, 1
);
INSERT INTO user_roles (user_id, role_id) VALUES ('backup-user', 'teacher');
SQL

docker compose --env-file "$env_file" -f "$compose_file" -p "$project_name" \
  run --rm --no-deps -T -e "DATABASE_URL=$database_url" migrate \
  node packages/db/dist/seed.js >/dev/null

docker compose --env-file "$env_file" -f "$compose_file" -p "$project_name" \
  exec -T postgres psql -v ON_ERROR_STOP=1 -U examforge -d "$source_database" >/dev/null <<'SQL'
INSERT INTO audit_events (
  id, actor, actor_user_id, actor_roles, action, entity_type, entity_id, payload
) VALUES (
  'backup-audit', 'backup-test', 'backup-user', '["teacher"]'::jsonb,
  'backup.probe', 'backup', 'backup-test', '{"redacted":true}'::jsonb
);
SQL

old_id="examforge-20000101T000000000000000Z-0014_user_audience_scopes"
for extension in dump sha256 summary meta; do
  printf 'expired\n' > "$backup_dir/$old_id.$extension"
  touch -d '20 days ago' "$backup_dir/$old_id.$extension"
done

backup_output=$("$backup_script" --env-file "$env_file" --compose-file "$compose_file")
[[ "$backup_output" == *"Backup completed"* ]] || fail "backup did not report success"
[[ ! -e "$backup_dir/$old_id.meta" ]] || fail "retention did not remove expired backup"

mapfile -t manifests < <(find "$backup_dir" -maxdepth 1 -type f -name 'examforge-*.meta' -print)
((${#manifests[@]} == 1)) || fail "expected exactly one valid local backup"
manifest=${manifests[0]}
backup_id=$(basename "$manifest" .meta)
[[ "$backup_id" =~ ^examforge-[0-9]{8}T[0-9]{15}Z-[0-9]{4}_[a-z0-9_]+$ ]] \
  || fail "backup filename does not follow the immutable convention: $backup_id"

for extension in dump sha256 summary meta; do
  [[ -f "$backup_dir/$backup_id.$extension" ]] || fail "missing local $extension"
  [[ -f "$offsite_dir/$backup_id.$extension" ]] || fail "missing offsite $extension"
done

(
  cd "$backup_dir"
  sha256sum --check "$backup_id.sha256" >/dev/null
)
docker compose --env-file "$env_file" -f "$compose_file" -p "$project_name" \
  exec -T postgres pg_restore --list < "$backup_dir/$backup_id.dump" >/dev/null
expected_migration_count=$(find "$repository_root/packages/db/drizzle" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d '[:space:]')
[[ "$expected_migration_count" =~ ^[1-9][0-9]*$ ]] \
  || fail "migration source count is invalid: $expected_migration_count"
grep -qx "schema_migration_count=$expected_migration_count" "$backup_dir/$backup_id.summary" \
  || fail "migration count is missing from the redacted summary"
grep -qx 'scope_association_count=1' "$backup_dir/$backup_id.summary" \
  || fail "scope association count is missing from the redacted summary"
grep -qx 'audit_event_count=1' "$backup_dir/$backup_id.summary" \
  || fail "audit count is missing from the redacted summary"
! grep -Eq 'Backup Teacher|redacted-hash|redacted-salt|backup-test-postgres-password' \
  "$backup_dir/$backup_id.summary" || fail "summary contains sensitive row data"

manifest_sha_before=$(sha256sum "$manifest" | awk '{print $1}')
for extension in dump sha256 summary meta; do
  touch -d '20 days ago' "$backup_dir/$backup_id.$extension"
done
stub_dir="$fixture_dir/stub-bin"
mkdir "$stub_dir"
cat > "$stub_dir/cp" <<'EOF'
#!/usr/bin/env bash
printf 'simulated offsite failure\n' >&2
exit 75
EOF
chmod 755 "$stub_dir/cp"
set +e
failed_output=$(PATH="$stub_dir:$PATH" "$backup_script" \
  --env-file "$env_file" --compose-file "$compose_file" 2>&1)
failed_status=$?
set -e
((failed_status != 0)) || fail "offsite copy failure unexpectedly succeeded"
[[ "$failed_output" == *"category=backup_offsite_copy_failed"* ]] \
  || fail "offsite failure category is missing"
[[ -f "$manifest" ]] || fail "failed backup deleted the previous valid manifest"
[[ "$(sha256sum "$manifest" | awk '{print $1}')" == "$manifest_sha_before" ]] \
  || fail "failed backup changed the previous valid manifest"

docker compose --env-file "$env_file" -f "$compose_file" -p "$project_name" \
  exec -T postgres createdb -U examforge "$restore_database"

set +e
unmarked_output=$("$restore_script" --env-file "$env_file" --compose-file "$compose_file" \
  --backup "$manifest" --target-database "$restore_database" --confirm-disposable 2>&1)
unmarked_status=$?
set -e
((unmarked_status != 0)) || fail "restore accepted an unmarked target database"
[[ "$unmarked_output" == *"category=restore_target_not_disposable"* ]] \
  || fail "unmarked restore failure category is missing"

docker compose --env-file "$env_file" -f "$compose_file" -p "$project_name" \
  exec -T postgres psql -v ON_ERROR_STOP=1 -U examforge -d postgres \
  -c "COMMENT ON DATABASE $restore_database IS 'examforge.disposable=true'" >/dev/null

restore_output=$("$restore_script" --env-file "$env_file" --compose-file "$compose_file" \
  --backup "$manifest" --target-database "$restore_database" --confirm-disposable)
[[ "$restore_output" == *"Restore verification passed"* ]] \
  || fail "restore did not report verification success"

restored_scope_count=$(docker compose --env-file "$env_file" -f "$compose_file" -p "$project_name" \
  exec -T postgres psql -At -U examforge -d "$restore_database" \
  -c 'SELECT count(*) FROM user_teacher_scopes')
[[ "$restored_scope_count" == "1" ]] || fail "restored scope association is missing"

printf 'backup and restore integration passed\n'
