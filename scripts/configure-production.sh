#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"
ENV_FILE="${1:?Usage: $0 /absolute/path/to/production.env [--with-runner] [--with-telegram] [--with-market-live] [--with-market-retain] [--with-mcp-research]}"
shift

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Production environment file is not readable: $ENV_FILE" >&2
  exit 1
fi

profiles=()
for option in "$@"; do
  case "$option" in
    --with-runner) profiles+=(--profile runner) ;;
    --with-telegram) profiles+=(--profile telegram) ;;
    --with-market-live) profiles+=(--profile market-live) ;;
    --with-market-retain) profiles+=(--profile market-retain) ;;
    --with-mcp-research) profiles+=(--profile mcp-research) ;;
    *) echo "Unknown option: $option" >&2; exit 1 ;;
  esac
done

for required_key in DATABASE_URL DASHBOARD_BOOTSTRAP_TOKEN SIGNAL_INGEST_TOKEN; do
  if ! grep -qE "^${required_key}=.+" "$ENV_FILE"; then
    echo "Production environment file is missing $required_key" >&2
    exit 1
  fi
done

if [[ " ${profiles[*]} " == *" --profile telegram " ]]; then
  for required_key in TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_USER_IDS; do
    if ! grep -qE "^${required_key}=.+" "$ENV_FILE"; then
      echo "Telegram profile requires $required_key" >&2
      exit 1
    fi
  done
fi

if [[ " ${profiles[*]} " == *" --profile market-live " ]]; then
  for required_key in MARKET_REDIS_URL; do
    if ! grep -qE "^${required_key}=.+" "$ENV_FILE"; then
      echo "market-live profile requires $required_key" >&2
      exit 1
    fi
  done
fi

if [[ " ${profiles[*]} " == *" --profile market-retain " ]]; then
  for required_key in CLICKHOUSE_URL CLICKHOUSE_USER CLICKHOUSE_PASSWORD SEAWEEDFS_S3_ENDPOINT SEAWEEDFS_S3_BUCKET SEAWEEDFS_S3_ACCESS_KEY SEAWEEDFS_S3_SECRET_KEY; do
    if ! grep -qE "^${required_key}=.+" "$ENV_FILE"; then
      echo "market-retain profile requires $required_key" >&2
      exit 1
    fi
  done
fi

export CRYPTO_SIGNAL_ENV_FILE="$ENV_FILE"
export CRYPTO_SIGNAL_API_BIND="${CRYPTO_SIGNAL_API_BIND:-127.0.0.1:3000}"

docker compose -f "$COMPOSE_FILE" "${profiles[@]}" up --build --detach --remove-orphans
docker compose -f "$COMPOSE_FILE" "${profiles[@]}" ps
