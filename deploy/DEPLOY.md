# VPS deploy (Docker Compose)

### BLUF

**Run the chart UI and copilot API as two containers: only port 3000 is published.** The browser talks to the Next.js app on same-origin `/v1/copilot/*`; the `web` service proxies to `http://copilot:8000`. Leave `NEXT_PUBLIC_COPILOT_URL` unset in compose — no LLM secrets on the web container.

### Key metrics & actions

- **Prerequisites:** Docker Compose v2, `deploy/.env` from `deploy/.env.example` (LLM + optional `DATABASE_URL`).
- **Primary commands:** `cd deploy && docker compose up --build -d`
- **UI URL:** `http://localhost:3000` (or `WEB_PUBLISH_PORT`)
- **Copilot on host:** not exposed by default; use `docker compose -f docker-compose.yml -f docker-compose.expose-copilot.yml up` to map `${COPILOT_PUBLISH_PORT:-8000}`

### Architecture

```text
Browser → :3000 web (Next.js)
              └─ server proxy COPILOT_UPSTREAM_URL → copilot:8000 (internal)
```

| Service | Published | Secrets |
|---|---|---|
| `web` | `3000` | None (`COPILOT_UPSTREAM_URL` only) |
| `copilot` | internal `8000` | `LLM_*`, `DATABASE_URL`, etc. in `deploy/.env` |

`CORS_ORIGINS` on copilot is optional for this layout because the browser does not call copilot directly. Set it if you also expose copilot publicly or use a split deployment.

### Postgres (optional)

```bash
docker compose --profile postgres up -d postgres
# set in deploy/.env:
# DATABASE_URL=postgresql+psycopg://copilot:copilot@postgres:5432/copilot
docker compose up -d --build
```

### Cloud Run / single copilot image

See `deploy/cloudrun/deploy.sh` and `apps/copilot/DEPLOY.md` for copilot-only hosting when the UI is on another host (then set `NEXT_PUBLIC_COPILOT_URL` on the web host instead of `COPILOT_UPSTREAM_URL`).

### Build smoke (CI or laptop)

```bash
docker build -t cryptosignal-copilot:test apps/copilot
docker build -t cryptosignal-web:test apps/web
```

Copilot needs a `.env` with valid `LLM_*` values before `docker compose up` will pass health checks in production; image build does not require secrets.
