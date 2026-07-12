#!/usr/bin/env bash
set -euo pipefail

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-examforge}"
export E2E_API_BASE_URL="${E2E_API_BASE_URL:-http://127.0.0.1:${API_PORT:-4000}}"
export E2E_WEB_BASE_URL="${E2E_WEB_BASE_URL:-http://127.0.0.1:${WEB_PORT:-3000}}"
export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-$E2E_API_BASE_URL}"

cleanup() {
  exit_code=$?
  trap - EXIT INT TERM
  if [[ "${KEEP_DEMO_STACK:-0}" == "1" ]]; then
    printf 'Keeping Compose project %s for inspection.\n' "$COMPOSE_PROJECT_NAME"
  else
    docker compose down --volumes --remove-orphans || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

npm run demo:reset
DEMO_API_BASE_URL="$E2E_API_BASE_URL" DEMO_WEB_BASE_URL="$E2E_WEB_BASE_URL" npm run demo:smoke
E2E_EXTERNAL_SERVICES=1 npx playwright test
