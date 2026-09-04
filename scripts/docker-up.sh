#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILES=(-f "$ROOT_DIR/infra/docker-compose.yml" -f "$ROOT_DIR/infra/docker-compose.local.yml")
ENV_FILE="${CRYPTO_SIGNAL_ENV_FILE:-$ROOT_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Creating $ENV_FILE from .env.example"
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
fi

profiles=()
for option in "$@"; do
  case "$option" in
    --with-runner) profiles+=(--profile runner) ;;
    --with-telegram) profiles+=(--profile telegram) ;;
    --with-market-live) profiles+=(--profile market-live) ;;
    --with-market-retain) profiles+=(--profile market-retain) ;;
    --with-mcp-research) profiles+=(--profile mcp-research) ;;
    *)
      echo "Unknown option: $option" >&2
      echo "Usage: $0 [--with-runner] [--with-telegram] [--with-market-live] [--with-market-retain] [--with-mcp-research]" >&2
      exit 1
      ;;
  esac
done

profile_args=()
if ((${#profiles[@]} > 0)); then
  profile_args=("${profiles[@]}")
fi

for required_key in DATABASE_URL DASHBOARD_BOOTSTRAP_TOKEN SIGNAL_INGEST_TOKEN; do
  if ! grep -qE "^${required_key}=.+" "$ENV_FILE"; then
    echo "Environment file is missing $required_key: $ENV_FILE" >&2
    exit 1
  fi
done

if ((${#profile_args[@]} > 0)); then
  if [[ " ${profile_args[*]} " == *" --profile telegram "* ]]; then
    for required_key in TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_USER_IDS; do
      if ! grep -qE "^${required_key}=.+" "$ENV_FILE"; then
        echo "Telegram profile requires $required_key" >&2
        exit 1
      fi
    done
  fi
fi

export CRYPTO_SIGNAL_ENV_FILE="$ENV_FILE"
export CRYPTO_SIGNAL_API_BIND="${CRYPTO_SIGNAL_API_BIND:-127.0.0.1:3000}"

docker compose "${COMPOSE_FILES[@]}" up -d postgres
docker compose "${COMPOSE_FILES[@]}" --profile migrate run --rm db-migrate
compose_up=(docker compose "${COMPOSE_FILES[@]}")
if ((${#profile_args[@]} > 0)); then
  compose_up+=("${profile_args[@]}")
fi

"${compose_up[@]}" up --build -d --remove-orphans
"${compose_up[@]}" ps
