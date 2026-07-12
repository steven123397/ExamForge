#!/usr/bin/env bash
set -euo pipefail

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-examforge}"
: "${EXAMFORGE_ADMIN_PASSWORD:?Set EXAMFORGE_ADMIN_PASSWORD before resetting the demo}"
: "${EXAMFORGE_OPERATOR_PASSWORD:?Set EXAMFORGE_OPERATOR_PASSWORD before resetting the demo}"
: "${EXAMFORGE_TEACHER_PASSWORD:?Set EXAMFORGE_TEACHER_PASSWORD before resetting the demo}"
: "${EXAMFORGE_STUDENT_PASSWORD:?Set EXAMFORGE_STUDENT_PASSWORD before resetting the demo}"
volume_name="${COMPOSE_PROJECT_NAME}-demo-postgres-data"

printf 'Resetting Compose project %s and volume %s\n' "$COMPOSE_PROJECT_NAME" "$volume_name"
docker compose down --volumes --remove-orphans
docker compose up --build --wait
