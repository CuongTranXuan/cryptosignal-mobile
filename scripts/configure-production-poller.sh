#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.poller.yml"
ENV_FILE="${1:?Usage: $0 /absolute/path/to/production.env}"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Production environment file is not readable: $ENV_FILE" >&2
  exit 1
fi

for required_key in DATABASE_URL TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_USER_IDS SIGNAL_INGEST_TOKEN; do
  if ! grep -qE "^${required_key}=.+" "$ENV_FILE"; then
    echo "Production environment file is missing $required_key" >&2
    exit 1
  fi
done

export CRYPTO_SIGNAL_POLLING_ENV_FILE="$ENV_FILE"
export CRYPTO_SIGNAL_API_BIND="${CRYPTO_SIGNAL_API_BIND:-127.0.0.1:3000}"

docker compose -f "$COMPOSE_FILE" up --build --detach --remove-orphans
docker compose -f "$COMPOSE_FILE" ps
