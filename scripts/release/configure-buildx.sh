#!/usr/bin/env bash

set -Eeuo pipefail

if (($# != 1)); then
  printf 'Usage: configure-buildx.sh BUILDER_NAME\n' >&2
  exit 2
fi

builder_name=$1
[[ "$builder_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] \
  || { printf 'Buildx builder name is invalid.\n' >&2; exit 2; }

docker buildx rm "$builder_name" >/dev/null

create_args=(
  buildx create
  --name "$builder_name"
  --driver docker-container
  --use
  --driver-opt network=host
)
for proxy_name in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy; do
  proxy_value=${!proxy_name:-}
  if [[ -n "$proxy_value" ]]; then
    create_args+=(--driver-opt "env.$proxy_name=$proxy_value")
  fi
done

docker "${create_args[@]}" >/dev/null
docker buildx inspect "$builder_name" --bootstrap >/dev/null
