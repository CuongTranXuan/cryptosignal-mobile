# CryptoSignal

CryptoSignal is a **signals-only crypto-market research web application**. It stores completed public OHLCV candles for BTC/USDT, ETH/USDT, and BNB/USDT; analyzes evidence with a pinned Freqtrade strategy; and displays protected browser research dashboards. Telegram long polling is an optional owner-allowlisted integration for alert delivery and mirrored controls.

> **No orders are placed.** The system has no exchange private keys, portfolio access, or order-execution capability. Chart scenarios are research conditions, not price targets, guarantees, or personalized recommendations.

## Architecture

| Component | Responsibility |
|---|---|
| Browser dashboard | Username/password-protected charts, signal history, indicator evidence, shared controls, runner health, and audit history. |
| Express/tRPC API | First-party password session endpoints, protected dashboard data, signal ingestion, and health checks. |
| MySQL/TiDB | Credentials, hashed sessions, immutable signals, candle history, configuration, runner health, and audit records. |
| Freqtrade adapter | Runs local public-market closed-candle analysis without trading commands or credentials. |
| Telegram long polling | Owner-allowlisted alerts and all operational configuration commands. |

## Local development

Install Node.js 22+, pnpm 9+, Python 3.12+, and the pinned Freqtrade runtime. Then install JavaScript dependencies and start the API/web development processes.

```bash
pnpm install --frozen-lockfile
sudo uv pip install --system freqtrade==2026.7 pytest
pnpm dev
```

Create a database migration whenever `drizzle/schema.ts` changes. Review the generated SQL before applying it.

```bash
pnpm drizzle-kit generate
# Review drizzle/<new_migration>.sql
# Apply reviewed statements using the deployment database migration process.
```

## First owner bootstrap

Set `DASHBOARD_BOOTSTRAP_TOKEN` to a random value of at least 32 characters before exposing the service. Browse to the dashboard, create the first administrator username/password, and store both the password and bootstrap token in a password manager. The bootstrap route rejects all further setup after the first credential exists.

The browser receives only an HTTP-only session cookie. Passwords are stored as salted PBKDF2-SHA-256 hashes; raw passwords and raw session tokens are never stored in MySQL.

## Required environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | MySQL/TiDB connection string with TLS in production. |
| `DASHBOARD_BOOTSTRAP_TOKEN` | Yes | One-time first-admin setup key; use at least 32 random characters. |
| `TELEGRAM_BOT_TOKEN` | Optional | Bot API token used only when the optional long-polling integration is enabled. |
| `TELEGRAM_ALLOWED_USER_IDS` | With Telegram | Comma-separated Telegram numeric user-ID allowlist. |
| `SIGNAL_INGEST_TOKEN` | Yes | Private token authorizing Freqtrade closed-candle signal and history submissions. |
| `PORT` | Yes | API listen port; use `3000` behind the reverse proxy. |
| `NODE_ENV` | Yes | Set to `production` on the persistent host. |
| `TELEGRAM_POLLING_ENABLED` | Docker poller only | Set to `true` only in the single production polling container. Production API processes default to polling disabled. |
| `CRYPTO_SIGNAL_API_BASE_URL` | Runner host | HTTPS API base URL used by the cron-driven Freqtrade runner. |

`JWT_SECRET` remains required only if the template’s legacy OAuth endpoints are retained. It is not used for the first-party username/password session implementation.

## Persistent-host deployment

Build the Node API and static browser bundle on the host or CI artifact, then serve both through HTTPS on one domain. The browser uses relative `/api` paths in production, so the reverse proxy must route `/api/` to the Node API.

```bash
pnpm install --frozen-lockfile
pnpm build:all
NODE_ENV=production PORT=3000 pnpm start
```

### Optional Docker-owned Telegram poller

The web app does not require Telegram to run or to test its core dashboard features. When alert delivery is needed, the production Telegram poller is the **only** process that sets `TELEGRAM_POLLING_ENABLED=true`. It is intentionally isolated in the Docker deployment below. Other API instances retain dashboard/API behavior with polling disabled.

```bash
chmod +x scripts/configure-production-poller.sh scripts/run-configured-cycle-quiet.sh
scripts/configure-production-poller.sh /etc/cryptosignal/poller.env
```

The Docker host needs Docker Compose, and `/etc/cryptosignal/poller.env` must be readable by the deployment user and contain `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, and `SIGNAL_INGEST_TOKEN`. The service binds to `127.0.0.1:3000` by default for a same-host reverse proxy. Use `docker compose -f infra/docker-compose.poller.yml ps` to check service health.

### Quiet cron runner

Install the provided cron template on the host that has the pinned Freqtrade runtime. The wrapper takes a non-blocking lock, prevents overlap, suppresses cron output, and reports compact health data back to the dashboard API. It must run on the same private network as the API or use an explicit HTTPS `CRYPTO_SIGNAL_API_BASE_URL` and `SIGNAL_INGEST_TOKEN`.

```bash
chmod 600 /etc/cryptosignal/runner.env
crontab infra/cron/cryptosignal.crontab
# The scheduled wrapper runs: scripts/run-configured-cycle-quiet.sh
```

The following Nginx shape serves the exported web bundle and proxies the API on a single HTTPS domain. Replace paths and hostname.

```nginx
server {
  listen 443 ssl http2;
  server_name signals.example.com;
  root /srv/cryptosignal/dist/web;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location / { try_files $uri $uri/ /index.html; }
}
```

## Operations

The browser dashboard is the primary test surface and owns the versioned configuration, runner health, and immutable operational audit history. When enabled, Telegram shares that configuration and delivers eligible signals without logging background health polling to the browser console. Use `/help` for bot commands and `/web` for the dashboard link only after configuring the integration. Run a backup for the database and environment file before migrations or engine upgrades.

## Validation

```bash
pnpm check
pnpm lint
pnpm test
PYTHONPATH=engines/freqtrade pytest -q engines/freqtrade/tests/test_strategy_contract.py
freqtrade show-config --config engines/freqtrade/config/signals-only.json --userdir engines/freqtrade/user_data
```

## Project conventions

Read [`AGENTS.md`](AGENTS.md) before changing this repository. It contains mandatory security boundaries, database migration workflow, required tests, deployment constraints, and the source-of-truth file map for future coding agents.
