#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${CRYPTO_SIGNAL_RUNNER_ENV_FILE:-/etc/cryptosignal/runner.env}"
LOCK_FILE="${CRYPTO_SIGNAL_RUNNER_LOCK_FILE:-/var/lock/cryptosignal-runner.lock}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if [[ -r "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

exec 9>"$LOCK_FILE"
flock --nonblock 9 || exit 0

cd "$ROOT_DIR"
"$PYTHON_BIN" engines/freqtrade/run_configured_cycle.py --limit 500 --quiet >/dev/null 2>&1
