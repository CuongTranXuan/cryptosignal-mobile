#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"
ENV_FILE="${1:?Usage: $0 /absolute/path/to/production.env [--with-runner] [--with-telegram]}"
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

export CRYPTO_SIGNAL_ENV_FILE="$ENV_FILE"
export CRYPTO_SIGNAL_API_BIND="${CRYPTO_SIGNAL_API_BIND:-127.0.0.1:3000}"

docker compose -f "$COMPOSE_FILE" "${profiles[@]}" up --build --detach --remove-orphans
docker compose -f "$COMPOSE_FILE" "${profiles[@]}" ps
