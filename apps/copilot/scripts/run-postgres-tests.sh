#!/usr/bin/env bash
# CI-friendly Postgres session tests. Provide POSTGRES_TEST_URL or enable testcontainers.
set -euo pipefail
cd "$(dirname "$0")/.."
export COPILOT_RUN_DB_MIGRATIONS=true
if [[ -z "${POSTGRES_TEST_URL:-}" ]]; then
  export COPILOT_USE_TESTCONTAINERS=1
fi
pytest tests/test_db_postgres.py -v
