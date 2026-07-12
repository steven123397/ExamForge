#!/usr/bin/env bash
set -euo pipefail

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-examforge}"
volume_name="${COMPOSE_PROJECT_NAME}-demo-postgres-data"

printf 'Resetting Compose project %s and volume %s\n' "$COMPOSE_PROJECT_NAME" "$volume_name"
docker compose down --volumes --remove-orphans
docker compose up --build --wait
