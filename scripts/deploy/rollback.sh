#!/usr/bin/env bash

set -Eeuo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck disable=SC1091
source "$repository_root/scripts/deploy/operations-lib.sh"

env_file="$repository_root/.env.production"
compose_file="$repository_root/compose.production.yml"
state_dir="/srv/apps/examforge/releases"
preflight_hot_root="/srv/data/hot"
preflight_offsite_root="/srv/data/cos"

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || operations_fail "argument_missing" "rollback" "env_file_path_required"
      env_file=$2
      shift 2
      ;;
    --compose-file)
      (($# >= 2)) || operations_fail "argument_missing" "rollback" "compose_file_path_required"
      compose_file=$2
      shift 2
      ;;
    --state-dir)
      (($# >= 2)) || operations_fail "argument_missing" "rollback" "state_directory_required"
      state_dir=$2
      shift 2
      ;;
    --preflight-hot-root)
      (($# >= 2)) || operations_fail "argument_missing" "rollback" "hot_root_path_required"
      preflight_hot_root=$2
      shift 2
      ;;
    --preflight-offsite-root)
      (($# >= 2)) || operations_fail "argument_missing" "rollback" "offsite_root_path_required"
      preflight_offsite_root=$2
      shift 2
      ;;
    *)
      operations_fail "argument_invalid" "rollback" "unknown_option"
      ;;
  esac
done

previous_manifest="$state_dir/previous/release-manifest.json"
[[ -f "$previous_manifest" ]] \
  || operations_fail "rollback_previous_missing" "rollback" "previous_release_manifest_not_found"

"$repository_root/scripts/deploy/deploy.sh" \
  --env-file "$env_file" \
  --compose-file "$compose_file" \
  --release-manifest "$previous_manifest" \
  --state-dir "$state_dir" \
  --preflight-hot-root "$preflight_hot_root" \
  --preflight-offsite-root "$preflight_offsite_root"

printf 'Rollback completed state=%s\n' "$state_dir/current"
