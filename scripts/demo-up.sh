#!/usr/bin/env bash
set -euo pipefail

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-examforge}"
docker compose up --build --wait
