#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
fixture_dir=$(mktemp -d)
project_name="examforge-production-test-$$"
registry_name="examforge-registry-test-$$"
state_dir="$fixture_dir/releases"
hot_root="$fixture_dir/hot"
offsite_root="$fixture_dir/offsite"
data_dir="$hot_root/examforge"
backup_dir="$data_dir/backups/postgres"
env_file="$fixture_dir/.env.production"
compose_file="$repository_root/compose.production.yml"
commit_a="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
commit_b="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
before_containers="$fixture_dir/containers.before"
registry_port=""
api_port=""
web_port=""

cleanup() {
  set +e
  if [[ -f "$env_file" ]]; then
    docker compose --env-file "$env_file" -f "$compose_file" -p "$project_name" \
      down --remove-orphans >/dev/null 2>&1
  fi
  docker rm -f "$registry_name" >/dev/null 2>&1
  docker run --rm --user 0 -v "$fixture_dir:/target" postgres:16-alpine \
    sh -c 'rm -rf /target/* /target/.[!.]* /target/..?*' >/dev/null 2>&1
  rmdir "$fixture_dir" >/dev/null 2>&1
}
trap cleanup EXIT

fail() {
  printf 'local production test failed: %s\n' "$*" >&2
  exit 1
}

free_port() {
  node -e 'const net=require("node:net"); const server=net.createServer(); server.listen(0,"127.0.0.1",()=>{process.stdout.write(String(server.address().port));server.close()})'
}

ensure_application_image() {
  local name=$1
  local tag="examforge-task3-$name:verify-fixed"
  local dockerfile="$repository_root/apps/$name/Dockerfile"
  [[ "$name" != "scheduler" ]] || dockerfile="$repository_root/apps/scheduler/Dockerfile"
  local -a arguments=(
    build
    --build-arg "SOURCE_REVISION=$commit_a"
    --build-arg "SOURCE_URL=https://github.com/steven123397/ExamForge"
    --build-arg "SOURCE_CREATED_AT=2026-07-14T00:00:00Z"
    -f "$dockerfile"
    -t "$tag"
  )
  if [[ "$name" == "web" ]]; then
    arguments+=(--build-arg "NEXT_PUBLIC_API_BASE_URL=https://examforge.site")
  fi
  arguments+=("$repository_root")
  docker "${arguments[@]}" >/dev/null
  printf '%s\n' "$tag"
}

push_image() {
  local source=$1
  local repository=$2
  local tag=$3
  local tagged="$registry_host/$repository:$tag"
  docker tag "$source" "$tagged"
  docker push "$tagged" >/dev/null
  local digest
  digest=$(curl --fail --silent --show-error --head \
    --header 'Accept: application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json' \
    "http://$registry_host/v2/$repository/manifests/$tag" \
    | awk -F': ' 'tolower($1) == "docker-content-digest" { gsub("\\r", "", $2); print $2 }')
  [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "registry digest missing for $repository:$tag"
  printf '%s@%s\n' "$registry_host/$repository" "$digest"
}

variant_image() {
  local source=$1
  local name=$2
  local container_id
  container_id=$(docker create "$source")
  docker commit --change "LABEL org.opencontainers.image.revision=$commit_b" \
    "$container_id" "examforge-local-$name:$commit_b" >/dev/null
  docker rm "$container_id" >/dev/null
  printf 'examforge-local-%s:%s\n' "$name" "$commit_b"
}

create_bundle() {
  local output=$1
  local commit=$2
  local created_at=$3
  shift 3
  node "$repository_root/tests/deploy/create-local-release-bundle.mjs" \
    --output "$output" \
    --commit "$commit" \
    --created-at "$created_at" \
    --api-reference "$1" \
    --scheduler-reference "$2" \
    --web-reference "$3" \
    --worker-reference "$4"
}

docker ps -aq --no-trunc | sort > "$before_containers"
registry_port=$(free_port)
api_port=$(free_port)
web_port=$(free_port)
registry_host="127.0.0.1:$registry_port"

docker pull registry:2 >/dev/null
docker run -d --name "$registry_name" -p "127.0.0.1:$registry_port:5000" registry:2 >/dev/null
for _ in {1..30}; do
  curl --fail --silent "http://$registry_host/v2/" >/dev/null 2>&1 && break
  sleep 0.2
done
curl --fail --silent "http://$registry_host/v2/" >/dev/null \
  || fail "local registry did not become ready"

api_a=$(ensure_application_image api)
scheduler_a=$(ensure_application_image scheduler)
web_a=$(ensure_application_image web)
worker_a=$(ensure_application_image worker)
api_b=$(variant_image "$api_a" api)
scheduler_b=$(variant_image "$scheduler_a" scheduler)
web_b=$(variant_image "$web_a" web)
worker_b=$(variant_image "$worker_a" worker)

api_ref_a=$(push_image "$api_a" examforge/api "$commit_a")
scheduler_ref_a=$(push_image "$scheduler_a" examforge/scheduler "$commit_a")
web_ref_a=$(push_image "$web_a" examforge/web "$commit_a")
worker_ref_a=$(push_image "$worker_a" examforge/worker "$commit_a")
api_ref_b=$(push_image "$api_b" examforge/api "$commit_b")
scheduler_ref_b=$(push_image "$scheduler_b" examforge/scheduler "$commit_b")
web_ref_b=$(push_image "$web_b" examforge/web "$commit_b")
worker_ref_b=$(push_image "$worker_b" examforge/worker "$commit_b")
postgres_ref=$(push_image postgres:16-alpine examforge/postgres 16-alpine)
redis_ref=$(push_image redis:7-alpine examforge/redis 7-alpine)

manifest_a=$(create_bundle "$fixture_dir/bundle-a" "$commit_a" \
  "2026-07-14T00:00:00.000Z" \
  "$api_ref_a" "$scheduler_ref_a" "$web_ref_a" "$worker_ref_a")
manifest_b=$(create_bundle "$fixture_dir/bundle-b" "$commit_b" \
  "2026-07-14T01:00:00.000Z" \
  "$api_ref_b" "$scheduler_ref_b" "$web_ref_b" "$worker_ref_b")

mkdir -p "$data_dir/postgres" "$data_dir/redis" "$backup_dir" "$offsite_root/examforge/postgres"
docker run --rm --user 0 -v "$data_dir/postgres:/target" postgres:16-alpine \
  chown 70:70 /target
docker run --rm --user 0 -v "$data_dir/redis:/target" redis:7-alpine \
  chown 999:1000 /target

cat > "$env_file" <<EOF
COMPOSE_PROJECT_NAME=$project_name
EXAMFORGE_API_IMAGE=$api_ref_a
EXAMFORGE_WEB_IMAGE=$web_ref_a
EXAMFORGE_WORKER_IMAGE=$worker_ref_a
EXAMFORGE_SCHEDULER_IMAGE=$scheduler_ref_a
EXAMFORGE_POSTGRES_IMAGE=$postgres_ref
EXAMFORGE_REDIS_IMAGE=$redis_ref
EXAMFORGE_PUBLIC_ORIGIN=https://examforge.site
EXAMFORGE_TRUSTED_ORIGINS=https://examforge.site
EXAMFORGE_API_PORT=$api_port
EXAMFORGE_WEB_PORT=$web_port
EXAMFORGE_DATA_DIR=$data_dir
EXAMFORGE_BACKUP_DIR=$backup_dir
EXAMFORGE_OFFSITE_BACKUP_DIR=$offsite_root/examforge/postgres
EXAMFORGE_BACKUP_RETENTION_DAYS=14
EXAMFORGE_MAX_BACKUP_AGE_SECONDS=93600
EXAMFORGE_MIN_FREE_KIB=1048576
EXAMFORGE_CERTIFICATE_WARNING_DAYS=21
EXAMFORGE_TLS_CERTIFICATE_PATH=/etc/letsencrypt/live/examforge.site/fullchain.pem
POSTGRES_USER=examforge
POSTGRES_PASSWORD=local-production-postgres-password-20260714
POSTGRES_DB=examforge
EXAMFORGE_ADMIN_PASSWORD=local-production-admin-password-20260714
EXAMFORGE_OPERATOR_PASSWORD=local-production-operator-password-20260714
EXAMFORGE_TEACHER_PASSWORD=local-production-teacher-password-20260714
EXAMFORGE_STUDENT_PASSWORD=local-production-student-password-20260714
EXAMFORGE_SESSION_COOKIE_NAME=examforge_session
EXAMFORGE_SESSION_COOKIE_SECURE=true
EXAMFORGE_SESSION_TTL_SECONDS=43200
SCHEDULE_JOB_MAX_ATTEMPTS=6
SCHEDULE_JOB_RETRY_BASE_DELAY_MS=1000
LOG_LEVEL=error
EOF
chmod 600 "$env_file"

"$repository_root/scripts/deploy/deploy.sh" \
  --env-file "$env_file" --compose-file "$compose_file" \
  --release-manifest "$manifest_a" --state-dir "$state_dir" \
  --preflight-hot-root "$hot_root" --preflight-offsite-root "$offsite_root" \
  --bootstrap-demo >/dev/null

COMPOSE_PROJECT_NAME="$project_name" \
ONLINE_API_BASE_URL="http://127.0.0.1:$api_port" \
ONLINE_WEB_BASE_URL="http://127.0.0.1:$web_port" \
ONLINE_COMPOSE_FILE="$compose_file" \
ONLINE_COMPOSE_ENV_FILE="$env_file" \
ONLINE_RUN_FAULT_DRILLS=1 \
node --env-file="$env_file" "$repository_root/scripts/deploy/online-smoke.mjs" \
  > "$fixture_dir/fault-smoke.json" &
smoke_pid=$!
sample_id=0
while kill -0 "$smoke_pid" >/dev/null 2>&1; do
  sample_id=$((sample_id + 1))
  mapfile -t running_containers < <(
    docker compose --env-file "$env_file" -f "$compose_file" -p "$project_name" ps -q
  )
  if ((${#running_containers[@]} > 0)); then
    while IFS= read -r sample; do
      [[ -n "$sample" ]] && printf '%s\t%s\n' "$sample_id" "$sample" \
        >> "$fixture_dir/resource-samples.tsv"
    done < <(docker stats --no-stream --format '{{json .}}' "${running_containers[@]}")
  fi
done
wait "$smoke_pid"
resource_summary=$(node "$repository_root/tests/deploy/summarize-resource-samples.mjs" \
  "$fixture_dir/resource-samples.tsv")
max_recovery_ms=$(node -e \
  'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(Math.max(...value.timelines.map((item)=>item.durationMs),0)))' \
  "$fixture_dir/fault-smoke.json")

"$repository_root/scripts/deploy/backup-postgres.sh" \
  --env-file "$env_file" --compose-file "$compose_file" >/dev/null
backup_manifest=$(find "$backup_dir" -maxdepth 1 -type f -name 'examforge-*.meta' -print -quit)
[[ -n "$backup_manifest" ]] || fail "online backup metadata is missing"
restore_database="examforge_local_restore_disposable"
docker compose --env-file "$env_file" -f "$compose_file" -p "$project_name" \
  exec -T postgres createdb -U examforge "$restore_database"
docker compose --env-file "$env_file" -f "$compose_file" -p "$project_name" \
  exec -T postgres psql -U examforge -d postgres \
  -c "COMMENT ON DATABASE $restore_database IS 'examforge.disposable=true'" >/dev/null
"$repository_root/scripts/deploy/restore-postgres.sh" \
  --env-file "$env_file" --compose-file "$compose_file" \
  --backup "$backup_manifest" --target-database "$restore_database" \
  --confirm-disposable >/dev/null

"$repository_root/scripts/deploy/deploy.sh" \
  --env-file "$env_file" --compose-file "$compose_file" \
  --release-manifest "$manifest_b" --state-dir "$state_dir" \
  --preflight-hot-root "$hot_root" --preflight-offsite-root "$offsite_root" >/dev/null
[[ "$(readlink "$state_dir/current")" == "commits/$commit_b" ]] \
  || fail "second release did not become current"

COMPOSE_PROJECT_NAME="$project_name" \
ONLINE_API_BASE_URL="http://127.0.0.1:$api_port" \
ONLINE_WEB_BASE_URL="http://127.0.0.1:$web_port" \
ONLINE_COMPOSE_FILE="$compose_file" \
ONLINE_COMPOSE_ENV_FILE="$env_file" \
ONLINE_RUN_FAULT_DRILLS=0 \
node --env-file="$env_file" "$repository_root/scripts/deploy/online-smoke.mjs" >/dev/null

"$repository_root/scripts/deploy/rollback.sh" \
  --env-file "$env_file" --compose-file "$compose_file" --state-dir "$state_dir" \
  --preflight-hot-root "$hot_root" --preflight-offsite-root "$offsite_root" >/dev/null
[[ "$(readlink "$state_dir/current")" == "commits/$commit_a" ]] \
  || fail "rollback did not restore the first release"
grep -Fq "EXAMFORGE_API_IMAGE=$api_ref_a" "$env_file" \
  || fail "rollback did not restore the first API digest"

COMPOSE_PROJECT_NAME="$project_name" \
ONLINE_API_BASE_URL="http://127.0.0.1:$api_port" \
ONLINE_WEB_BASE_URL="http://127.0.0.1:$web_port" \
ONLINE_COMPOSE_FILE="$compose_file" \
ONLINE_COMPOSE_ENV_FILE="$env_file" \
ONLINE_RUN_FAULT_DRILLS=0 \
node --env-file="$env_file" "$repository_root/scripts/deploy/online-smoke.mjs" >/dev/null

docker compose --env-file "$env_file" -f "$compose_file" -p "$project_name" \
  down --remove-orphans >/dev/null
docker rm -f "$registry_name" >/dev/null
registry_name=""
docker ps -aq --no-trunc | sort > "$fixture_dir/containers.after"
cmp -s "$before_containers" "$fixture_dir/containers.after" \
  || fail "pre-existing Docker container set changed"

printf 'local production deploy, backup, second release and rollback passed resources=%s max_recovery_ms=%s\n' \
  "$resource_summary" "$max_recovery_ms"
