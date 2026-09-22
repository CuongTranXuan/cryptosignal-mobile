#!/usr/bin/env bash
# Start CryptoSignal local stack: copilot (:8000) + web (:3000).
# Logs stream to THIS terminal (stdout/stderr). Ctrl+C stops both.
#   cd /Users/cuong/Documents/cryptosignal-mobile && ./scripts/dev-stack.sh
# Stop from another terminal:
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
: >"$COPILOT_LOG"
: >"$WEB_LOG"

prefix_stream() {
  local name="$1"
  # shellcheck disable=SC2016
  sed -u "s/^/[$name] /"
}

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  echo
  echo "Shutting down stack..."
  if [[ -n "${COPILOT_PID:-}" ]]; then kill "$COPILOT_PID" 2>/dev/null || true; fi
  if [[ -n "${WEB_PID:-}" ]]; then kill "$WEB_PID" 2>/dev/null || true; fi
  stop_port 3000
  stop_port 8000
  rm -f "$PID_DIR/web.pid" "$PID_DIR/copilot.pid"
  exit "$code"
}
trap cleanup EXIT INT TERM

echo "Starting copilot on http://127.0.0.1:8000 (logs → stdout) ..."
(
  cd "$COPILOT"
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  exec .venv/bin/uvicorn cryptosignal_copilot.app:app --app-dir src --reload --host 127.0.0.1 --port 8000
) 2>&1 | tee -a "$COPILOT_LOG" | prefix_stream "copilot" &
COPILOT_PID=$!
echo "$COPILOT_PID" >"$PID_DIR/copilot.pid"

echo "Starting web on http://127.0.0.1:3000 (logs → stdout) ..."
(
  cd "$WEB"
  export COPILOT_UPSTREAM_URL="${COPILOT_UPSTREAM_URL:-http://127.0.0.1:8000}"
  export NEXT_PUBLIC_COPILOT_URL="${NEXT_PUBLIC_COPILOT_URL:-}"
  exec "$PNPM" exec next dev --hostname 127.0.0.1 --port 3000
) 2>&1 | tee -a "$WEB_LOG" | prefix_stream "web" &
WEB_PID=$!
echo "$WEB_PID" >"$PID_DIR/web.pid"

echo
echo "=== Stack starting (Ctrl+C to stop; logs stay in this terminal) ==="
echo "  Web:     http://127.0.0.1:3000"
echo "  Health:  http://127.0.0.1:3000/v1/copilot/health"
echo "  Also:    $COPILOT_LOG / $WEB_LOG"
echo

# Wait until healthy (or one process dies), then keep streaming until Ctrl+C / child exit.
for i in $(seq 1 90); do
  if ! kill -0 "$COPILOT_PID" 2>/dev/null || ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "A process exited early. Recent logs:" >&2
    tail -n 40 "$COPILOT_LOG" "$WEB_LOG" >&2 || true
    exit 1
  fi
  if curl -sf "http://127.0.0.1:8000/v1/copilot/health" >/dev/null 2>&1 \
    && curl -sf "http://127.0.0.1:3000/" >/dev/null 2>&1 \
    && curl -sf "http://127.0.0.1:3000/v1/copilot/health" >/dev/null 2>&1; then
    echo "=== Stack ready ==="
    curl -sS "http://127.0.0.1:3000/v1/copilot/health"; echo
    break
  fi
  sleep 0.5
done

# macOS bash 3.2 has no `wait -n` — poll until either pipeline exits.
while kill -0 "$COPILOT_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done
echo "One process stopped; shutting down the rest."
