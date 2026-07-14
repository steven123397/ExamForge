#!/usr/bin/env bash

set -Eeuo pipefail

if (($# != 4)); then
  printf 'Usage: probe-image.sh IMAGE COMPONENT EXPECTED_COMMIT PUBLIC_ORIGIN\n' >&2
  exit 2
fi

image=$1
component=$2
expected_commit=$3
public_origin=$4

case "$component" in
  api | scheduler | web | worker) ;;
  *)
    printf 'Unsupported component: %s\n' "$component" >&2
    exit 2
    ;;
esac

image_user=$(docker image inspect --format '{{.Config.User}}' "$image")
[[ -n "$image_user" && "$image_user" != "0" && "$image_user" != "root" && "$image_user" != 0:* ]] \
  || { printf '%s image must declare a non-root user.\n' "$component" >&2; exit 1; }

image_architecture=$(docker image inspect --format '{{.Architecture}}' "$image")
[[ "$image_architecture" == "amd64" ]] \
  || { printf '%s image must target linux/amd64.\n' "$component" >&2; exit 1; }

source_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
[[ "$source_revision" == "$expected_commit" ]] \
  || { printf '%s image source revision is inconsistent.\n' "$component" >&2; exit 1; }

source_url=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.source"}}' "$image")
[[ "$source_url" =~ ^https://github\.com/[^/]+/[^/]+$ ]] \
  || { printf '%s image source URL is invalid.\n' "$component" >&2; exit 1; }

if [[ "$component" == "api" ]]; then
  docker run --rm --entrypoint sh "$image" -c \
    '! command -v python >/dev/null && ! command -v python3 >/dev/null && ! command -v uv >/dev/null'
fi

if [[ "$component" == "web" ]]; then
  configured_origin=$(docker image inspect --format '{{index .Config.Labels "io.examforge.public-origin"}}' "$image")
  [[ "$configured_origin" == "$public_origin" ]] \
    || { printf 'Web image public origin is inconsistent.\n' >&2; exit 1; }
  if docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$image" \
    | grep -Eq '^(DATABASE_URL|REDIS_URL|POSTGRES_PASSWORD|EXAMFORGE_[A-Z_]*PASSWORD)='; then
    printf 'Web image environment contains a server secret variable.\n' >&2
    exit 1
  fi
fi

printf '%s image responsibility probe passed.\n' "$component"
