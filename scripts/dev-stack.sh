#!/usr/bin/env bash
# Start CryptoSignal local stack: copilot (:8000) + web (:3000).
# Run this in your own Terminal (not via an agent shell) for a durable session:
#   cd /Users/cuong/Documents/cryptosignal-mobile && ./scripts/dev-stack.sh
# Stop:
#   ./scripts/dev-stack.sh --stop
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/apps/web"
COPILOT="$ROOT/apps/copilot"
PID_DIR="$ROOT/.dev-stack"
WEB_LOG="$PID_DIR/web.log"
COPILOT_LOG="$PID_DIR/copilot.log"
mkdir -p "$PID_DIR"

stop_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

stop_stack() {
  echo "Stopping stack on :3000 and :8000..."
  stop_port 3000
  stop_port 8000
  rm -f "$PID_DIR/web.pid" "$PID_DIR/copilot.pid"
  echo "Stopped."
}

if [[ "${1:-}" == "--stop" ]]; then
  stop_stack
  exit 0
fi

if [[ ! -f "$COPILOT/.env" ]]; then
  echo "Missing $COPILOT/.env — copy from .env.example and set LLM_* (OmniRoute)." >&2
  exit 1
fi
if [[ ! -x "$COPILOT/.venv/bin/uvicorn" ]]; then
  echo "Copilot venv missing. Run: cd apps/copilot && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'" >&2
  exit 1
fi

stop_stack

PNPM="$(command -v pnpm)"

echo "Starting copilot on http://127.0.0.1:8000 ..."
# Detach fully so agent/CI shells don't kill children on exit.
nohup env -i HOME="$HOME" PATH="$PATH" USER="$USER" \
  bash -lc "cd \"$COPILOT\" && set -a && source .env && set +a && exec .venv/bin/uvicorn cryptosignal_copilot.app:app --app-dir src --reload --host 127.0.0.1 --port 8000" \
  >"$COPILOT_LOG" 2>&1 </dev/null &
echo $! >"$PID_DIR/copilot.pid"
disown || true

echo "Starting web on http://127.0.0.1:3000 ..."
nohup env -i HOME="$HOME" PATH="$PATH" USER="$USER" \
  COPILOT_UPSTREAM_URL="${COPILOT_UPSTREAM_URL:-http://127.0.0.1:8000}" \
  NEXT_PUBLIC_COPILOT_URL="${NEXT_PUBLIC_COPILOT_URL:-}" \
  bash -lc "cd \"$WEB\" && exec \"$PNPM\" exec next dev --hostname 127.0.0.1 --port 3000" \
  >"$WEB_LOG" 2>&1 </dev/null &
echo $! >"$PID_DIR/web.pid"
disown || true

for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:8000/v1/copilot/health" >/dev/null 2>&1 \
    && curl -sf "http://127.0.0.1:3000/" >/dev/null 2>&1 \
    && curl -sf "http://127.0.0.1:3000/v1/copilot/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! curl -sf "http://127.0.0.1:3000/v1/copilot/health" >/dev/null 2>&1; then
  echo "Stack failed to become healthy. See:" >&2
  echo "  $COPILOT_LOG" >&2
  echo "  $WEB_LOG" >&2
  exit 1
fi

echo
echo "=== Stack ready ==="
echo "  Web:            http://127.0.0.1:3000"
echo "  Copilot proxy:  http://127.0.0.1:3000/v1/copilot/health"
echo "  Logs:           $COPILOT_LOG / $WEB_LOG"
echo "  Stop:           ./scripts/dev-stack.sh --stop"
echo "  Ngrok:          one tunnel → :3000 (copilot is same-origin)"
curl -sS "http://127.0.0.1:3000/v1/copilot/health"; echo
