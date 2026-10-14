# Copilot API deploy

### BLUF

**Ship the FastAPI copilot as a Docker image with env-only LLM and database configuration.** Sessions use SQLAlchemy 2.x and Alembic migrations driven by `DATABASE_URL`; run `alembic upgrade head` or set `COPILOT_RUN_DB_MIGRATIONS=true` on startup.

### Key metrics & actions

| Item | Value |
|---|---|
| Health | `GET /v1/copilot/health` |
| Migrations | `cd apps/copilot && alembic upgrade head` |
| Compose (web + copilot) | `deploy/DEPLOY.md` |
| Cloud Run | `deploy/cloudrun/deploy.sh` |
| Secrets | `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `DATABASE_URL` via Secret Manager / host env |

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `LLM_API_STYLE` | yes* | — | `openai` or `anthropic` |
| `LLM_BASE_URL` | yes* | — | OpenAI-compatible base URL |
| `LLM_API_KEY` | yes* | — | Provider API key |
| `LLM_MODEL` | yes* | — | Default model id; always injected into `/models` fallback |
| `LLM_TIMEOUT_S` | no | `60` | HTTP timeout for provider calls |
| `DATABASE_URL` | no | sqlite under `COPILOT_DATA_DIR` or `/tmp` | SQLAlchemy URL (`sqlite:///`, `postgresql+psycopg://`, `sqlite+libsql://`) |
| `COPILOT_SESSIONS_DB` | no | — | If `DATABASE_URL` unset, derive `sqlite:///` from this path |
| `COPILOT_DATA_DIR` | no | — | Default sqlite file: `{dir}/sessions.sqlite3` |
| `COPILOT_RUN_DB_MIGRATIONS` | no | `false` | Run `alembic upgrade head` on process start |
| `COPILOT_MODEL_PROVIDERS` | no | empty | CSV `owned_by` / id prefix filter; empty = all providers |
| `COPILOT_MODEL_VISIBILITY_ALLOWLIST` | no | empty | CSV model ids after collapse; empty = no allowlist |
| `COPILOT_MODEL_ID_PREFIX_ALIASES` | no | empty | `from/:to/` prefix rewrites (CSV) |
| `COPILOT_MODEL_OVERRIDES_FILE` | no | — | JSON file for per-model limits, `structured_output_mode`, hide, advanced |
| `COPILOT_MODEL_OVERRIDES_JSON` | no | — | Inline overrides JSON (same schema as file) |
| `COPILOT_MODEL_ADVANCED_SUBSTRINGS` | no | `/no-think/,/auto/,auto/` | Mark catalog entries advanced |
| `COPILOT_MODEL_INCLUDE_COMBO` | no | `false` | Include `combo/*` routes |
| `COPILOT_MODEL_NEGATIVE_CACHE_TTL_S` | no | `300` | Temporary hide after 402/502 |
| `COPILOT_MODELS_CACHE_TTL_S` | no | `600` | `/models` cache TTL |
| `COPILOT_DEFAULT_CANDLE_COUNT` | no | `100` | Default session/analyze window |
| `CORS_ORIGINS` / `COPILOT_CORS_ORIGINS` | prod** | localhost dev | Browser origins when calling API directly |
| `RATE_LIMIT_PER_MINUTE` | no | `10` | `POST /analyze` per IP |
| `PORT` | no | `8000` | Uvicorn bind (Docker / Cloud Run) |

\*Required for successful analyze and 200 health; missing → 503 on health/models.  
\*\*Not required when the UI proxies server-side (`COPILOT_UPSTREAM_URL` on Next.js).

### Database migration notes

1. **New install:** set `DATABASE_URL`, then `COPILOT_RUN_DB_MIGRATIONS=true` or run `alembic upgrade head` from `apps/copilot`.
2. **Legacy sqlite (`copilot_sessions` with JSON `payload` only):** point `DATABASE_URL` or `COPILOT_SESSIONS_DB` at the existing file; migration `20251014_0001` adds `reasoning_effort` if missing. If the schema already matches, `alembic stamp 20251014_0001` then `alembic upgrade head`.
3. **Postgres / Turso:** use `postgresql+psycopg://…` or `sqlite+libsql://…` (install optional `[libsql]` extra). Same Alembic revision.

### Docker

```bash
cd apps/copilot
docker build -t cryptosignal-copilot .
docker run --rm -p 8000:8000 --env-file .env \
  -e COPILOT_RUN_DB_MIGRATIONS=true cryptosignal-copilot
```

Image runs as non-root, honors `PORT`, uvicorn `--proxy-headers --forwarded-allow-ips='*'`, healthcheck on `/v1/copilot/health`.

### Cloud Run

```bash
export PROJECT_ID=your-gcp-project
# Create secrets: LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, DATABASE_URL, CORS_ORIGINS
./deploy/cloudrun/deploy.sh
```

Defaults: `asia-southeast1`, min instances 0, request timeout 600s.

### Tests

```bash
cd apps/copilot
pytest                    # SQLite sessions (always)
POSTGRES_TEST_URL=postgresql+psycopg://... pytest tests/test_db_postgres.py
./scripts/run-postgres-tests.sh   # or COPILOT_USE_TESTCONTAINERS=1 with Docker
```

### OmniRoute example

Copy `config/omniroute.env.example` and `config/omniroute.model-overrides.json.example` — illustrative only, not defaults in code.
