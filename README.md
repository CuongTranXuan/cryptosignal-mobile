# CryptoSignal

CryptoSignal is a **signals-only crypto-market research system**. It stores completed public OHLCV candles for BTC/USDT, ETH/USDT, and BNB/USDT; analyzes evidence with a pinned Freqtrade strategy; displays protected browser research dashboards; and uses Telegram long polling as the owner-allowlisted operational surface.

> **No orders are placed.** The system has no exchange private keys, portfolio access, or order-execution capability. Chart scenarios are research conditions, not price targets, guarantees, or personalized recommendations.

## Architecture

| Component | Responsibility |
|---|---|
| Browser dashboard | Username/password-protected, read-only charts, signal history, indicator evidence, and scenario conditions. |
| Express/tRPC API | First-party password session endpoints, protected dashboard data, signal ingestion, and health checks. |
| MySQL/TiDB | Credentials, hashed sessions, immutable signals, candle history, configuration, and audit records. |
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
| `TELEGRAM_BOT_TOKEN` | Yes | Bot API token used only by the single long-polling API process. |
| `TELEGRAM_ALLOWED_USER_IDS` | Yes | Comma-separated Telegram numeric user-ID allowlist. |
| `SIGNAL_INGEST_TOKEN` | Yes | Private token authorizing Freqtrade closed-candle signal and history submissions. |
| `PORT` | Yes | API listen port; use `3000` behind the reverse proxy. |
| `NODE_ENV` | Yes | Set to `production` on the persistent host. |

`JWT_SECRET` remains required only if the template’s legacy OAuth endpoints are retained. It is not used for the first-party username/password session implementation.

## Persistent-host deployment (Ubuntu, no Docker)

Build the Node API and static browser bundle on the host or CI artifact, then serve both through HTTPS on one domain. The browser uses relative `/api` paths in production, so the reverse proxy must route `/api/` to the Node API.

```bash
pnpm install --frozen-lockfile
pnpm build:all
NODE_ENV=production PORT=3000 pnpm start
```

Use a process manager such as systemd for the API. Run **one** instance only: the API embeds the Telegram `getUpdates` long-polling loop, and a second instance with the same token produces Telegram `409 Conflict` errors.

Use an external scheduler or systemd timer for the Freqtrade cycle. It must run on the same private network as the API or use an explicit `CRYPTO_SIGNAL_API_BASE_URL` and `SIGNAL_INGEST_TOKEN` over HTTPS.

```bash
python3 engines/freqtrade/run_configured_cycle.py --limit 500
```

The following Nginx shape serves the exported web bundle and proxies the API on a single HTTPS domain. Replace paths and hostname.

```nginx
server {
  listen 443 ssl http2;
  server_name signals.example.com;
  root /srv/cryptosignal/dist-web;
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

The Telegram bot is the configuration surface. Use `/help` for commands, `/web` for the dashboard link, and make every allowed user send `/start` before expecting alerts. Run a backup for the database and environment file before migrations or engine upgrades. For all operations, consult [`docs/LOCAL_OPERATION.md`](docs/LOCAL_OPERATION.md), [`docs/WEB_AND_TELEGRAM_SURFACES.md`](docs/WEB_AND_TELEGRAM_SURFACES.md), and [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md).

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
