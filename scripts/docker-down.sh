#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILES=(-f "$ROOT_DIR/infra/docker-compose.yml" -f "$ROOT_DIR/infra/docker-compose.local.yml")
ENV_FILE="${CRYPTO_SIGNAL_ENV_FILE:-$ROOT_DIR/.env}"

export CRYPTO_SIGNAL_ENV_FILE="$ENV_FILE"

docker compose "${COMPOSE_FILES[@]}" --profile runner --profile telegram --profile market-live --profile market-retain --profile mcp-research down --remove-orphans "$@"
