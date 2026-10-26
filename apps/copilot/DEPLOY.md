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

### Google Gemini (OpenAI-compatible)

Use the [Gemini OpenAI compatibility layer](https://ai.google.dev/gemini-api/docs/openai) with env-only switching (no code changes):

```bash
LLM_API_STYLE=openai
LLM_PROVIDER=gemini   # optional; auto-detected from generativelanguage.googleapis.com base URL
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=<Gemini API key from Google AI Studio>
LLM_MODEL=gemini-2.5-flash
```

**Cloud Run:** store `LLM_API_KEY` in Secret Manager (never commit the key). Mount the same variables as other LLM providers. See `config/gemini.env.example`.

Copilot normalizes `/models` ids (`models/gemini-2.5-flash` → `gemini-2.5-flash`), maps `reasoning_effort` per the [thinking table](https://ai.google.dev/gemini-api/docs/openai#thinking), and strips unsupported OpenAI chat params before requests hit Gemini.

**Native `LLM_API_STYLE=google`:** not enabled in this branch — the OpenAI-compatible path covers Gemini with one pydantic-ai `OpenAIChatModel` stack and identical catalog/analyze behavior.

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `LLM_API_STYLE` | yes* | — | `openai` or `anthropic` |
| `LLM_BASE_URL` | yes* | — | OpenAI-compatible base URL |
| `LLM_API_KEY` | yes* | — | Provider API key |
| `LLM_MODEL` | yes* | — | Default model id; always injected into `/models` fallback |
| `LLM_TIMEOUT_S` | no | `60` | HTTP timeout for provider calls |
| `LLM_PROVIDER` | no | auto | `gemini` or `generic`; auto-detect from `LLM_BASE_URL` host |
| `DATABASE_URL` | no | sqlite under `COPILOT_DATA_DIR` or `/tmp` | SQLAlchemy URL (`sqlite:///`, `postgresql+psycopg://`, `sqlite+libsql://`) |
| `COPILOT_SESSIONS_DB` | no | — | If `DATABASE_URL` unset, derive `sqlite:///` from this path |
| `COPILOT_DATA_DIR` | no | — | Default sqlite file: `{dir}/sessions.sqlite3` |
| `COPILOT_RUN_DB_MIGRATIONS` | no | `false` | Run `alembic upgrade head` on process start |
| `COPILOT_MODEL_PROVIDERS` | no | empty | CSV `owned_by` / id prefix filter; empty = all providers |
| `COPILOT_MODEL_VISIBILITY_ALLOWLIST` | no | empty | CSV model ids after collapse; empty = no allowlist. Entries **bypass the media filter** when gateways mislabel chat models as `type=image`. |
| `COPILOT_EXPOSE_ERROR_DETAIL` | no | `false` | Include truncated exception text in SSE `internal_error` detail (always logged to stderr). |
| `COPILOT_MODEL_ID_PREFIX_ALIASES` | no | empty | `from/:to/` prefix rewrites (CSV) |
| `COPILOT_MODEL_OVERRIDES_FILE` | no | — | JSON file for per-model limits, `structured_output_mode`, hide, advanced |
| `COPILOT_MODEL_OVERRIDES_JSON` | no | — | Inline overrides JSON (same schema as file) |
| `COPILOT_MODEL_ADVANCED_SUBSTRINGS` | no | `/no-think/,/auto/,auto/` | Mark catalog entries advanced |
| `COPILOT_MODEL_INCLUDE_COMBO` | no | `false` | Include `combo/*` routes |
| `COPILOT_MODEL_NEGATIVE_CACHE_TTL_S` | no | `300` | Temporary hide after 402/502 |
| `COPILOT_MODELS_CACHE_TTL_S` | no | `600` | `/models` cache TTL |
| `COPILOT_MODEL_PROBE_ENABLED` | no | `true` | Live-probe each catalog model (1 tiny chat completion) and list only those that answer. Applies to `LLM_API_STYLE=openai`; `false` restores the unverified catalog listing (`status:"unverified"`). |
| `COPILOT_MODEL_PROBE_TTL_S` | no | `600` | Probe cache TTL (stale-while-revalidate after expiry) |
| `COPILOT_MODEL_PROBE_DOWN_TTL_S` | no | `15` | TTL for an "upstream unreachable" report, so a freshly started OmniRoute appears quickly |
| `COPILOT_MODEL_PROBE_TIMEOUT_S` | no | `10` | Per-model probe timeout |
| `COPILOT_MODEL_PROBE_CONCURRENCY` | no | `8` | Parallel probe requests (1–32) |
| `COPILOT_MODEL_PROBE_MAX_TOKENS` | no | `1` | `max_tokens` on the probe request (1–4); retried once as `max_completion_tokens` if rejected |
| `COPILOT_MODEL_PROBE_MAX_MODELS` | no | `0` | `0` = probe every listed model. A positive value caps candidates (order: default model, allowlist, ids healthy last time, then id); the rest are hidden and listed in `skipped_ids` / `skipped_count` |
| `COPILOT_MODEL_PROBE_FIRST_WAIT_S` | no | `3` | How long a GET that had to start a probe waits before answering with the partial (in-progress) view |
| `COPILOT_MODEL_PROBE_REFRESH_MIN_INTERVAL_S` | no | `30` | Minimum gap between probe starts for a forced refresh; otherwise `429` + `Retry-After` |
| `COPILOT_MODELS_FETCH_TIMEOUT_S` | no | `10` | Timeout of the upstream `/models` list call |
| `COPILOT_DEFAULT_CANDLE_COUNT` | no | `100` | Default session/analyze window |
| `COPILOT_DEFAULT_MODEL_CONTEXT` | no | `32000` | Catalog fallback when provider omits limits |
| `COPILOT_DEFAULT_MODEL_MAX_OUTPUT` | no | `4096` | Max-output fallback when provider omits limits |
| `CORS_ORIGINS` / `COPILOT_CORS_ORIGINS` | prod** | localhost dev | Browser origins when calling API directly |
| `RATE_LIMIT_PER_MINUTE` | no | `10` | `POST /analyze` per IP |
| `PORT` | no | `8000` | Uvicorn bind (Docker / Cloud Run) |

\*Required for successful analyze and 200 health; missing → 503 on health/models.  
\*\*Not required when the UI proxies server-side (`COPILOT_UPSTREAM_URL` on Next.js).

### Model probe endpoints

The picker shows only models the configured OpenAI-compatible upstream (OmniRoute, Gemini, any `/v1` gateway) can serve **right now**. For each catalog candidate (after the usual provider / allowlist / media filters) the server sends one chat completion (`"Reply OK"`, `max_tokens` 1) and classifies the result as `ok`, `auth_error`, `quota_or_rate_limited`, `not_found`, `provider_unconfigured` (gateway route whose CLI/transport is not installed or logged in), `timeout` or `upstream_error`. With ~160 OmniRoute ids a full run takes ~35 s; results are published as they arrive, so `GET /models` lists healthy models found so far with `probe_in_progress:true` instead of blocking. Results are cached in-process, shared by concurrent callers (single flight) and warmed in the background at startup (startup never waits). Keys, bearer tokens and credentialed URLs are redacted from messages and never logged.

| Endpoint | Behaviour |
|---|---|
| `GET /v1/copilot/models[?refresh=1][&q=]` | Healthy models only (existing catalog fields + `latency_ms`, `status:"ok"`), plus `default_model` (effective), `requested_default`, `default_fallback`, `probed_at`, `ttl_s`, `stale`, `probe_in_progress`, `upstream_reachable`, `upstream_error`. `refresh=1` is rate-limited like POST. |
| `GET /v1/copilot/models/probe` | Full report incl. failures: `probed_at`, `ttl_s`, `provider` (`omniroute`/`gemini`/`openai_compat`), `upstream_reachable`, `upstream_error`, `skipped_count`, `skipped_ids`, `complete`, `probe_in_progress`, `results[]` (`id`, `status`, `latency_ms`, `http_status`, `error_code`, `message`). |
| `POST /v1/copilot/models/probe` | Force a re-probe and return the report. Joins an in-flight probe instead of failing. Too soon → `429`, `Retry-After: <s>`, body `{code:"probe_rate_limited", message, retry_after_s}` (not applied while the last report says the upstream is unreachable). |

If the upstream `/models` call fails (connection refused, DNS, timeout, 5xx, auth), both endpoints return `200` with `upstream_reachable:false`, `upstream_error:{code,message}` and no models (`code` ∈ `connect_error`, `timeout`, `http_error`, `auth_error`, `quota_or_rate_limited`, `network_error`, `invalid_response`). Incomplete `LLM_*` env gives the same shape with `code:"config_missing"` (message lists missing variable names only; `/health` stays `503`). If the configured `LLM_MODEL` fails its probe, `default_model` becomes the first healthy model (allowlist order, then latency) with `default_fallback:true`; `POST /analyze` without `model` uses it, and naming a model whose last probe failed returns `422 model_unavailable` with structured `model` and `probe_status` fields (plus the `detail` string). Wire fixtures: `tests/fixtures/wire/models_response.json`, `tests/fixtures/wire/models_probe_report.json`.

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
