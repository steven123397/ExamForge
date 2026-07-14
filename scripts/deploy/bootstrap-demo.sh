#!/usr/bin/env bash

set -Eeuo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck disable=SC1091
source "$repository_root/scripts/deploy/operations-lib.sh"

env_file="$repository_root/.env.production"
compose_file="$repository_root/compose.production.yml"
confirmed=false

usage() {
  cat <<'EOF'
Usage: scripts/deploy/bootstrap-demo.sh [options]

Options:
  --env-file PATH              Production environment file
  --compose-file PATH          Production Compose file
  --confirm-empty-database     Confirm one-time demo bootstrap
  --help                       Show this help
EOF
}

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || operations_fail "argument_missing" "bootstrap" "env_file_path_required"
      env_file=$2
      shift 2
      ;;
    --compose-file)
      (($# >= 2)) || operations_fail "argument_missing" "bootstrap" "compose_file_path_required"
      compose_file=$2
      shift 2
      ;;
    --confirm-empty-database)
      confirmed=true
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      operations_fail "argument_invalid" "bootstrap" "unknown_option"
      ;;
  esac
done

[[ "$confirmed" == "true" ]] \
  || operations_fail "bootstrap_confirmation_missing" "postgres_bootstrap" "empty_database_confirmation_required"
operations_load_env_file "$env_file"
for name in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; do
  operations_require_env "$name"
done
operations_validate_identifier "$POSTGRES_USER" "postgres_user"
operations_validate_identifier "$POSTGRES_DB" "postgres_database"

existing_counts=$(operations_compose exec -T postgres psql \
  --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align --field-separator=: \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --command 'SELECT (SELECT count(*) FROM exam_batches), (SELECT count(*) FROM schedule_runs), (SELECT count(*) FROM users), (SELECT count(*) FROM audit_events)') \
  || operations_fail "bootstrap_database_query_failed" "postgres_bootstrap" "database_count_query_failed"
existing_counts=${existing_counts//$'\r'/}
existing_counts=${existing_counts//$'\n'/}
[[ "$existing_counts" == "0:0:0:0" ]] \
  || operations_fail "bootstrap_database_not_empty" "postgres_bootstrap" "business_tables_are_not_empty"

database_url="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB"
operations_compose run --rm --no-deps -T -e "DATABASE_URL=$database_url" migrate \
  node packages/db/dist/seed.js >/dev/null \
  || operations_fail "bootstrap_seed_failed" "postgres_bootstrap" "seed_command_failed"

bootstrap_id="deployment-bootstrap-$(date -u +%Y%m%dT%H%M%S%NZ)"
operations_compose exec -T postgres psql \
  --no-psqlrc --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --command "INSERT INTO audit_events (id, actor, actor_roles, action, entity_type, entity_id, payload) VALUES ('$bootstrap_id', 'deployment', '[]'::jsonb, 'deployment.bootstrap', 'exam_batch', 'batch-2026-spring-final', '{\"mode\":\"explicit_demo_bootstrap\"}'::jsonb)" \
  >/dev/null \
  || operations_fail "bootstrap_audit_failed" "postgres_bootstrap" "audit_event_insert_failed"

printf 'Database bootstrap completed actor=deployment mode=explicit_demo_bootstrap\n'
