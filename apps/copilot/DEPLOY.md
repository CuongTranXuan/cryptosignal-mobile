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
| `COPILOT_PROJECT_BARS` | optional | overrides the forward-projection k table; hard max `48`. Unset uses 1m=30, 15m/1h=24, 4h=18, 1d=12 |

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

## Actionable drawings

**BLUF:** Analyze keeps only in-play `trendline`, `polyline`, and `zone` shapes, and may emit one forward endpoint past the last closed candle so the overlay can paint it.

* **Grid:** `lastClosedCandleTime + k×barSeconds`, one forward endpoint per agent shape. k comes from the interval table above unless `COPILOT_PROJECT_BARS` is set (still capped at 48).
* **Triangle apex:** upper/lower trendline pairs are intersected in time/price. A forward endpoint later than apex + 3 bars is dropped. No `apexTime` field is added.
* **Also dropped (shape skipped, analyze continues):** confidence below 0.55, last touch in the oldest 35% of the window, trendline span under 8 bars (triangle names under 15, polylines under 12), single-touch diagonals, near-vertical rays, mid-body anchors, triangle polylines, an unpaired triangle rail, Fib 1.272/1.618 without pivot C.
* **Skip codes:** the SSE text line and `shapes.dropped` list `{id, reason}`. Codes include `non-wick`, `not-swing`, `single-touch`, `min-span`, `ancient`, `low-conf`, `near-vertical`, `beyond-k`, `apex+3`, `triangle-polyline`, `unpaired-triangle`, `triangle-structure`, `fib-no-C`. A converging pair is capped as one unit.
* **Not claimed:** entries, stops, or that a level will hold. Fib has no kind — horizontal `Fib 0.382` / `Fib 0.5` / `Fib 0.618` trendlines plus a `Fib pocket 0.5–0.618` zone.
* **Follow-up:** wick-snap tolerance and the near-vertical slope cutoff are code constants (`WICK_ATR_FRACTION`, `NEAR_VERTICAL_SLOPE`), not env-tunable yet. A channel return with only one touch is still rejected by the single-touch rule.

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
