# Copilot deploy (Render free)

FastAPI SSE agent. No database. Browser must call this host cross-origin when the web app is on Vercel/Cloudflare Pages (set `NEXT_PUBLIC_COPILOT_URL`).

## Required env vars (Render dashboard)

| Name | Required | Notes |
|---|---|---|
| `LLM_API_STYLE` | yes | `openai` or `anthropic` (OmniRoute / OpenAI-compatible → `openai`) |
| `LLM_BASE_URL` | yes | e.g. OmniRoute base URL (no trailing slash required) |
| `LLM_API_KEY` | yes | secret — never commit |
| `LLM_MODEL` | yes | model id as the provider expects |
| `LLM_TIMEOUT_S` | recommended | default `60` in code; use `180`+ for long analyzes |
| `CORS_ORIGINS` | **yes in prod** | comma-separated frontend origins, e.g. `https://your-app.vercel.app` |
| `RATE_LIMIT_PER_MINUTE` | optional | default `10` per client IP on `POST /v1/copilot/analyze` |

Legacy alias: `COPILOT_CORS_ORIGINS` still works if `CORS_ORIGINS` is unset. Unset both → localhost only. Explicit empty `CORS_ORIGINS=` → no browser origins (fail closed).

## Create the service

**Option A — Blueprint:** connect the repo, select `render.yaml`, fill `sync: false` secrets.

**Option B — Manual Web Service**

- Runtime: Docker
- Root / context: `apps/copilot`
- Dockerfile path: `apps/copilot/Dockerfile`
- Instance: Free
- Health check path: `/v1/copilot/health`
- Auto-deploy: branch `feat/lwc-v1-volume-markers` (or `main` once merged)

Start command is in the Dockerfile (`uvicorn` on `$PORT`). Do not override unless you keep `--host 0.0.0.0 --port $PORT`.

## SSE / free-tier caveats

- **Sleep:** Render free spins down after idle; first request after sleep can take 30–60s. Health/poll from the web app may show offline until wake.
- **Timeouts:** set `LLM_TIMEOUT_S` high enough for your provider (e.g. 180). Copilot already emits SSE comment keepalives every ~12s and `X-Accel-Buffering: no` / `Cache-Control: no-cache, no-transform`.
- **Rate limit:** in-memory per instance; resets on restart/sleep. Fine for free single-instance only.
- **No proxy buffering knobs** beyond response headers we already send.

## Local smoke

```bash
cd apps/copilot
pip install -e ".[dev]"
export LLM_API_STYLE=openai LLM_BASE_URL=… LLM_API_KEY=… LLM_MODEL=…
export CORS_ORIGINS=http://localhost:3000
uvicorn cryptosignal_copilot.app:app --app-dir src --port 8000
curl -s localhost:8000/v1/copilot/health
```

Docker:

```bash
cd apps/copilot
docker build -t cryptosignal-copilot .
docker run --rm -p 8000:8000 -e PORT=8000 -e LLM_API_STYLE=… -e LLM_BASE_URL=… \
  -e LLM_API_KEY=… -e LLM_MODEL=… -e CORS_ORIGINS=http://localhost:3000 cryptosignal-copilot
```

## Handoff for frontend (@coder)

1. Deploy web; note the **exact origin** (scheme + host, no path), e.g. `https://cryptosignal.vercel.app`.
2. Put that origin in Render `CORS_ORIGINS` (comma-separate previews if needed).
3. Set `NEXT_PUBLIC_COPILOT_URL=https://<copilot>.onrender.com` on the web host (browser calls Render directly; Next rewrite is for local/same-origin only).
4. Do **not** put `LLM_API_KEY` in the web app.
