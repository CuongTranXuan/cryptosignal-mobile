# CryptoSignal Web (`apps/web`)

Next.js chart terminal with an optional Copilot panel. Market data uses public Binance APIs in the browser. Copilot traffic is configured **only via environment variables** — no provider or upstream URLs are baked into the build.

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_COPILOT_URL` | Build + runtime (client) | Optional **direct** copilot origin. When set, the browser calls `{origin}/v1/copilot/*` itself (CORS must allow the web origin). When empty, the client uses same-origin `/v1/copilot/*`. |
| `COPILOT_UPSTREAM_URL` | **Runtime** (server only) | Upstream FastAPI base URL for the App Router proxy (`app/v1/copilot/[...path]`). Not embedded at build time. |
| `PORT` | Runtime | HTTP port (default `3000`). |
| `HOSTNAME` | Runtime | Bind address (use `0.0.0.0` in containers). |
| `NEXT_PUBLIC_COPILOT_MOCK` | Build + runtime | `1` = in-memory mock models/sessions (local UI dev without copilot). |

Copy `.env.example` to `.env.local` for local development.

### Proxy vs direct

- **Same-origin proxy (default local):** leave `NEXT_PUBLIC_COPILOT_URL` empty; set `COPILOT_UPSTREAM_URL` to your copilot service. Next forwards `/v1/copilot/*` at request time (SSE-friendly, streaming).
- **Direct client:** set `NEXT_PUBLIC_COPILOT_URL` to the public copilot origin; `COPILOT_UPSTREAM_URL` is unused.

Models, default selection, reasoning tiers, and limits come **only** from `GET /v1/copilot/models` (`default_model` or first listed model).

## Scripts

```bash
npm install
npm run dev      # http://127.0.0.1:3000
npm run build
npm run start
npm test
```

## Docker

Build from this directory (monorepo context = `apps/web`):

```bash
docker build -t cryptosignal-web .
docker run --rm -p 3000:3000 \
  -e COPILOT_UPSTREAM_URL=http://host.docker.internal:8000 \
  -e PORT=3000 \
  -e HOSTNAME=0.0.0.0 \
  cryptosignal-web
```

Image uses Next `output: 'standalone'`, runs as non-root, honors `PORT` / `HOSTNAME`.

## Compose contract (for `deploy/docker-compose.yml` owner)

| Field | Value |
|---|---|
| **Build context** | `apps/web` (this directory; `Dockerfile` at root of context) |
| **Published port** | Host `3000` → container `PORT` (default `3000`) |
| **Required env** | `COPILOT_UPSTREAM_URL` → reachable copilot base (e.g. `http://copilot:8000`) when not using direct client mode |
| **Optional env** | `NEXT_PUBLIC_COPILOT_URL` (usually unset in compose so the proxy is used), `PORT`, `HOSTNAME=0.0.0.0` |
| **Secrets** | None in the web image — no LLM keys in the web service |
