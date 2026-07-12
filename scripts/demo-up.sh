#!/usr/bin/env bash
set -euo pipefail

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-examforge}"
: "${EXAMFORGE_ADMIN_PASSWORD:?Set EXAMFORGE_ADMIN_PASSWORD before starting the demo}"
: "${EXAMFORGE_OPERATOR_PASSWORD:?Set EXAMFORGE_OPERATOR_PASSWORD before starting the demo}"
: "${EXAMFORGE_TEACHER_PASSWORD:?Set EXAMFORGE_TEACHER_PASSWORD before starting the demo}"
: "${EXAMFORGE_STUDENT_PASSWORD:?Set EXAMFORGE_STUDENT_PASSWORD before starting the demo}"
docker compose up --build --wait
