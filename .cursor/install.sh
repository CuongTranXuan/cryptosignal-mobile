#!/usr/bin/env bash
# Idempotent bootstrap for the CryptoSignal Chart Terminal monorepo.
# Runs after the repo is checked out. Safe to re-run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# The default image ships Python 3.12 but not the stdlib venv module.
if ! python3 -c "import ensurepip" >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq python3.12-venv
fi

# --- apps/copilot (FastAPI + Pydantic AI) ---
cd "$REPO_ROOT/apps/copilot"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --upgrade pip >/dev/null
.venv/bin/pip install -e ".[dev]"
# Local dev env file (git-ignored). Fill LLM_API_KEY to enable the copilot.
if [ ! -f .env ]; then
  cp .env.example .env
fi

# --- apps/web (Next.js + pnpm) ---
cd "$REPO_ROOT/apps/web"
pnpm install
if [ ! -f .env.local ]; then
  cp .env.example .env.local
fi

echo "install.sh complete"
