# CryptoSignal

CryptoSignal is a **signals-only crypto-market research web application**. It retrieves completed public OHLCV candles for BTC/USDT, ETH/USDT, and BNB/USDT; evaluates named candlestick patterns and configurable research rules; records immutable evidence; and displays it in a protected browser dashboard. Telegram long polling is an optional owner-allowlisted surface for alerts and shared controls.

> **No orders are placed.** The system has no exchange private keys, portfolio access, or order-execution capability. Every pattern and methodology result is a completed-candle research observation, not a price target, guarantee, or personalized recommendation.

## Architecture

| Component | Responsibility |
|---|---|
| Browser dashboard | Password-protected charts, indicator history, enabled-rule controls, runner health, and audit history. |
| Express/tRPC API | Dashboard data, configuration, signal ingestion, sessions, and health checks. |
| MySQL/TiDB | Credentials, sessions, immutable signals, candle history, rule selections, runner health, and audit events. |
| Freqtrade adapter | Pinned, public-market, closed-candle analysis with no order commands or exchange credentials. |
| Telegram long polling | Optional owner-allowlisted alerts and synchronized configuration controls. |

## Configurable research rules

The dashboard and Telegram share one versioned configuration. Users can enable or disable every named candlestick pattern as well as individual methodology rules. A rule must be selected **and** its parent family must be enabled before it can contribute to an eligible alert.

| Family | Individually selectable rules |
|---|---|
| Candlestick patterns | Doji, Hammer, Inverted Hammer, Shooting Star, Hanging Man, Spinning Top, Engulfing, Harami, Tweezers, Morning/Evening Star, Three White Soldiers/Black Crows, and Three Inside Up/Down. |
| Trend, momentum, volume | EMA alignment, RSI + MACD agreement, and relative-volume confirmation. |
| Wyckoff / SMC / Elliott | Explicitly labelled closed-candle research proxies for spring/upthrust, break of structure, and impulse structure. These are not discretionary wave counts or trade instructions. |

Telegram commands include `/patterns enable HAMMER`, `/patterns disable BULLISH_ENGULFING`, `/rules enable SMC_BULLISH_BOS_PROXY`, and `/rules disable EMA_TREND`. Use `/methodology enable SMC` to enable the parent family. `/help` lists all controls.

## Local development

Install Node.js 22+, pnpm 9+, Python 3.11 or 3.12, and [uv](https://docs.astral.sh/uv/). JavaScript and Python dependencies remain isolated: Node dependencies stay in the pnpm workspace and the signal engine uses `engines/freqtrade/.venv`.

```bash
pnpm install --frozen-lockfile
(cd engines/freqtrade && uv sync --all-groups)
pnpm dev
```

Create a database migration whenever `drizzle/schema.ts` changes. Review generated SQL before applying it.

```bash
pnpm drizzle-kit generate
# Review drizzle/<new_migration>.sql
# Apply reviewed statements through the deployment database migration process.
```

## First owner bootstrap

Set `DASHBOARD_BOOTSTRAP_TOKEN` to a random value of at least 32 characters before exposing the service. Browse to the dashboard, create the first administrator username/password, and store both the password and bootstrap token in a password manager. The bootstrap route rejects all further setup after the first credential exists.

The browser receives only an HTTP-only session cookie. Passwords are stored as salted PBKDF2-SHA-256 hashes; raw passwords and raw session tokens are never stored in MySQL.

## Required environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | MySQL/TiDB connection string with TLS in production. |
| `DASHBOARD_BOOTSTRAP_TOKEN` | Yes | One-time first-admin setup key; use at least 32 random characters. |
| `SIGNAL_INGEST_TOKEN` | Yes | Private token authorizing closed-candle history and signal submissions. |
| `TELEGRAM_BOT_TOKEN` | Telegram profile only | Bot API token used only by the optional long-polling profile. |
| `TELEGRAM_ALLOWED_USER_IDS` | Telegram profile only | Comma-separated numeric owner allowlist. |
| `PORT` | Container default | API listen port, set to `3000` in the deployment image. |
| `TELEGRAM_POLLING_ENABLED` | Set by Compose | `false` for web and runner; `true` only for the one Telegram poller. |
| `CRYPTO_SIGNAL_API_BASE_URL` | Runner profile | API base URL used by the configured closed-candle runner. |

## Docker deployment for a host, VPS, or local machine

The production image is multi-stage. Its Python stage runs `uv sync --no-dev --frozen` and copies the resulting `engines/freqtrade/.venv` into the final image; it never uses `pip install --system` or a global Python package installation. The same image runs the web API, the optional Telegram poller, and the optional Freqtrade runner through separate Compose services.

First copy the example environment file to a protected location outside the checkout.

```bash
sudo install -d -m 700 /etc/cryptosignal
sudo cp infra/cryptosignal.env.example /etc/cryptosignal/production.env
sudo chmod 600 /etc/cryptosignal/production.env
# Edit the file securely and replace every placeholder.
```

Start the dashboard/API only:

```bash
scripts/configure-production.sh /etc/cryptosignal/production.env
```

Add the configured public closed-candle runner, which evaluates the selected watchlist every five minutes inside the container:

```bash
scripts/configure-production.sh /etc/cryptosignal/production.env --with-runner
```

Add Telegram long polling only when the environment file includes the token and owner allowlist. Run this profile once only; parallel pollers using the same token are intentionally prohibited.

```bash
scripts/configure-production.sh /etc/cryptosignal/production.env --with-runner --with-telegram
```

The API binds to `127.0.0.1:3000` by default. Set `CRYPTO_SIGNAL_API_BIND=0.0.0.0:3000` only for local testing or when a firewall and network policy make that appropriate. On a public host, keep the bind private and use one HTTPS reverse proxy for the dashboard and `/api/`.

```bash
docker compose -f infra/docker-compose.yml ps
docker compose -f infra/docker-compose.yml --profile runner --profile telegram logs --tail=100
```

### Host-side runner alternative

If containers are not used for the scheduler, create the same isolated environment before installing the existing cron template. The wrapper uses `engines/freqtrade/.venv/bin/python` by default, takes a non-blocking lock, and suppresses normal cron output.

```bash
(cd engines/freqtrade && uv sync --no-dev)
chmod 600 /etc/cryptosignal/runner.env
crontab infra/cron/cryptosignal.crontab
```

## Operations

The dashboard is the primary test surface and owns the versioned configuration, runner health, and immutable operational audit history. Telegram shares the same configuration only when the optional profile is enabled. Back up the database and protected environment file before schema migrations or engine upgrades.

Use an HTTPS reverse proxy with one same-origin domain. The browser uses relative `/api` paths in production, so proxy `/api/` to the private web service while serving the static browser bundle through the Node application.

## Validation

```bash
pnpm check
pnpm lint
pnpm test
PYTHONPATH=engines/freqtrade pytest -q engines/freqtrade/tests/test_strategy_contract.py
freqtrade show-config --config engines/freqtrade/config/signals-only.json --userdir engines/freqtrade/user_data
```

## Project conventions

Read [`AGENTS.md`](AGENTS.md) before changing this repository. It contains security boundaries, database migration workflow, required tests, deployment constraints, and the source-of-truth file map for future coding agents.
