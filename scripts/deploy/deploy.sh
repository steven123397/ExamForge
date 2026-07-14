#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck disable=SC1091
source "$repository_root/scripts/deploy/operations-lib.sh"

env_file="$repository_root/.env.production"
compose_file="$repository_root/compose.production.yml"
release_manifest=""
state_dir="/srv/apps/examforge/releases"
bootstrap_demo=false
preflight_hot_root="/srv/data/hot"
preflight_offsite_root="/srv/data/cos"
canonical_env_file=""
next_env=""
old_env=""
deployment_started=false

usage() {
  cat <<'EOF'
Usage: scripts/deploy/deploy.sh [options]

Options:
  --env-file PATH          Production environment file
  --compose-file PATH      Production Compose file
  --release-manifest PATH  Verified release-manifest.json
  --state-dir PATH         Release state directory
  --bootstrap-demo         Explicitly bootstrap an empty database before first start
  --preflight-hot-root PATH
                           Override hot-data root for isolated local validation
  --preflight-offsite-root PATH
                           Override offsite root for isolated local validation
  --help                   Show this help
EOF
}

cleanup() {
  [[ -z "$next_env" ]] || rm -f "$next_env"
  [[ -z "$old_env" ]] || rm -f "$old_env"
}

rollback_on_error() {
  local status=$?
  trap - ERR
  set +e
  if [[ "$deployment_started" == "true" ]]; then
    operations_compose down --remove-orphans >/dev/null 2>&1
  fi
  if [[ -n "$old_env" && -f "$old_env" ]]; then
    cp --preserve=mode "$old_env" "$canonical_env_file"
    env_file=$canonical_env_file
  fi
  if [[ "$deployment_started" == "true" ]]; then
    if [[ -L "$state_dir/current" && -f "$env_file" ]]; then
      operations_compose pull >/dev/null 2>&1
      operations_compose up -d --wait >/dev/null 2>&1
    fi
  fi
  printf 'operation error category=deployment_failed_rollback component=deployment message=previous_release_restored\n' >&2
  exit "$status"
}
trap cleanup EXIT
trap rollback_on_error ERR

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || operations_fail "argument_missing" "deployment" "env_file_path_required"
      env_file=$2
      shift 2
      ;;
    --compose-file)
      (($# >= 2)) || operations_fail "argument_missing" "deployment" "compose_file_path_required"
      compose_file=$2
      shift 2
      ;;
    --release-manifest)
      (($# >= 2)) || operations_fail "argument_missing" "deployment" "release_manifest_path_required"
      release_manifest=$2
      shift 2
      ;;
    --state-dir)
      (($# >= 2)) || operations_fail "argument_missing" "deployment" "state_directory_required"
      state_dir=$2
      shift 2
      ;;
    --bootstrap-demo)
      bootstrap_demo=true
      shift
      ;;
    --preflight-hot-root)
      (($# >= 2)) || operations_fail "argument_missing" "deployment" "hot_root_path_required"
      preflight_hot_root=$2
      shift 2
      ;;
    --preflight-offsite-root)
      (($# >= 2)) || operations_fail "argument_missing" "deployment" "offsite_root_path_required"
      preflight_offsite_root=$2
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      operations_fail "argument_invalid" "deployment" "unknown_option"
      ;;
  esac
done

[[ -n "$release_manifest" && -f "$release_manifest" ]] \
  || operations_fail "release_manifest_missing" "deployment" "release_manifest_not_found"
[[ -f "$env_file" && -f "$compose_file" ]] \
  || operations_fail "deployment_configuration_missing" "deployment" "env_or_compose_file_not_found"
for command in node docker cp mv mktemp mkdir ln readlink; do
  operations_require_command "$command"
done
canonical_env_file=$env_file

node "$repository_root/scripts/release/verify-release.mjs" \
  "$release_manifest" --verify-files >/dev/null \
  || operations_fail "release_manifest_invalid" "deployment" "release_verification_failed"
commit_sha=$(node -e \
  'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(value.commitSha)' \
  "$release_manifest")
[[ "$commit_sha" =~ ^[a-f0-9]{40}$ ]] \
  || operations_fail "release_manifest_invalid" "deployment" "commit_sha_invalid"

mkdir -p "$state_dir/commits"
release_dir="$state_dir/commits/$commit_sha"
if [[ ! -d "$release_dir" ]]; then
  staged_release=$(mktemp -d "$state_dir/commits/.staging-$commit_sha.XXXXXX")
  cp -a "$(dirname "$release_manifest")/." "$staged_release/"
  node "$repository_root/scripts/release/verify-release.mjs" \
    "$staged_release/release-manifest.json" --verify-files >/dev/null
  mv "$staged_release" "$release_dir"
else
  node "$repository_root/scripts/release/verify-release.mjs" \
    "$release_dir/release-manifest.json" --verify-files >/dev/null
fi

old_env=$(mktemp "$(dirname "$env_file")/.env.previous.XXXXXX")
cp --preserve=mode "$env_file" "$old_env"
next_env=$(mktemp "$(dirname "$env_file")/.env.next.XXXXXX")
rm -f "$next_env"
node "$repository_root/scripts/deploy/apply-release-env.mjs" \
  --env-file "$env_file" \
  --manifest "$release_dir/release-manifest.json" \
  --output "$next_env" >/dev/null
"$repository_root/scripts/deploy/preflight.sh" \
  --env-file "$next_env" --compose-file "$compose_file" \
  --hot-root-prefix "$preflight_hot_root" \
  --offsite-root-prefix "$preflight_offsite_root" \
  --validate-env-only >/dev/null

env_file=$next_env
operations_load_env_file "$env_file"
operations_compose pull
deployment_started=true
operations_compose up -d --wait postgres redis
operations_compose run --rm --no-deps -T migrate
if [[ "$bootstrap_demo" == "true" ]]; then
  "$repository_root/scripts/deploy/bootstrap-demo.sh" \
    --env-file "$env_file" --compose-file "$compose_file" \
    --confirm-empty-database
fi
operations_compose up -d --wait
"$repository_root/scripts/deploy/health-check.sh" \
  --env-file "$env_file" --compose-file "$compose_file" --only runtime

mv "$next_env" "$canonical_env_file"
next_env=""
env_file=$canonical_env_file

current_target=""
if [[ -L "$state_dir/current" ]]; then
  current_target=$(readlink "$state_dir/current")
fi
if [[ -n "$current_target" && "$current_target" != "commits/$commit_sha" ]]; then
  previous_link="$state_dir/.previous.$$"
  ln -s "$current_target" "$previous_link"
  mv -Tf "$previous_link" "$state_dir/previous"
fi
current_link="$state_dir/.current.$$"
ln -s "commits/$commit_sha" "$current_link"
mv -Tf "$current_link" "$state_dir/current"
trap - ERR

printf 'Deployment completed commit=%s state=%s\n' "$commit_sha" "$state_dir/current"
