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
| Redis (`market-live`) | Internal latest-event cache used only for public live snapshots and evaluator reads. |
| ClickHouse (`market-retain`) | Internal 90-day warm raw-event replay store with deterministic ordering. |
| SeaweedFS (`market-retain`) | Internal S3-compatible verified Parquet archive store for durable local retention. |

## Configurable research rules

The dashboard and Telegram share one versioned configuration. Users can enable or disable every named candlestick pattern as well as individual methodology rules. A rule must be selected **and** its parent family must be enabled before it can contribute to an eligible alert.

| Family | Individually selectable rules |
|---|---|
| Candlestick patterns | Doji, Hammer, Inverted Hammer, Shooting Star, Hanging Man, Spinning Top, Engulfing, Harami, Tweezers, Morning/Evening Star, Three White Soldiers/Black Crows, and Three Inside Up/Down. |
| Trend, momentum, volume | EMA alignment, RSI + MACD agreement, and relative-volume confirmation. |
| Wyckoff / SMC / Elliott | Explicitly labelled closed-candle research proxies for spring/upthrust, break of structure, and impulse structure. These are not discretionary wave counts or trade instructions. |

Telegram commands include `/patterns enable HAMMER`, `/patterns disable BULLISH_ENGULFING`, `/rules enable SMC_BULLISH_BOS_PROXY`, and `/rules disable EMA_TREND`. Use `/methodology enable SMC` to enable the parent family. `/help` lists all controls.

## Local debugging (not a test or deployment path)

Install Node.js 22+, pnpm 9+, Python 3.11 or 3.12, and [uv](https://docs.astral.sh/uv/). JavaScript and Python dependencies remain isolated: Node dependencies stay in the pnpm workspace and the signal engine uses `engines/freqtrade/.venv`.

```bash
pnpm install --frozen-lockfile
(cd engines/freqtrade && uv sync --all-groups)
pnpm dev
```

Use this mode only for interactive debugging and browser inspection. It does not start durable market services, the production runner, or Telegram polling. All supported test and deployment commands use Docker so they run against the same locked Node, Python, and uv environment as the deployed application.

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
| `MARKET_REDIS_URL` | `market-live` | Internal Redis URL for public live market snapshots. |
| `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` | `market-retain` | Internal ClickHouse replay-store connection. |
| `SEAWEEDFS_S3_ENDPOINT`, `SEAWEEDFS_S3_BUCKET`, `SEAWEEDFS_S3_ACCESS_KEY`, `SEAWEEDFS_S3_SECRET_KEY` | `market-retain` | Local SeaweedFS archive connection; these are storage credentials, not exchange credentials. |
| `BINANCE_MCP_ENABLED`, `BINANCE_MCP_PUBLIC_TOOL_IDS` | `mcp-research` only | Disabled-by-default optional public research adapter; never configure Binance account credentials. |

## Docker-only verification and deployment

Docker is the only supported route for full application verification and deployment. The test image uses the locked JavaScript dependencies and the Freqtrade virtual environment created by `uv`; the deployment image uses the same build inputs and never uses `pip install --system` or a global Python package installation. The application services run through separate Compose profiles.

Run the full verification suite before a deployment:

```bash
pnpm test:docker
```

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

### Local public live-market profiles

Start public WebSocket collection and the Redis-backed live evaluator with `market-live`. Add the durable local ClickHouse and SeaweedFS writer path with `market-retain`. These profiles use only public Binance market streams; they do not receive exchange account credentials, submit orders, or expose Redis, ClickHouse, or SeaweedFS ports outside Compose networks.

```bash
scripts/configure-production.sh /etc/cryptosignal/production.env --with-market-live
scripts/configure-production.sh /etc/cryptosignal/production.env --with-market-live --with-market-retain
```

The optional `mcp-research` profile is disabled by default and is not part of the collection, evaluator, writer, or Telegram paths. It must remain read-only and requires a dashboard-confirmed request plus an exact public tool allowlist.

```bash
scripts/configure-production.sh /etc/cryptosignal/production.env --with-mcp-research
```

The API binds to `127.0.0.1:3000` by default. Set `CRYPTO_SIGNAL_API_BIND=0.0.0.0:3000` only for local testing or when a firewall and network policy make that appropriate. On a public host, keep the bind private and use one HTTPS reverse proxy for the dashboard and `/api/`.

```bash
docker compose -f infra/docker-compose.yml ps
docker compose -f infra/docker-compose.yml --profile runner --profile telegram logs --tail=100
```

## Operations

The dashboard is the primary test surface and owns the versioned configuration, runner health, and immutable operational audit history. Telegram shares the same configuration only when the optional profile is enabled. Back up the database and protected environment file before schema migrations or engine upgrades.

Use an HTTPS reverse proxy with one same-origin domain. The browser uses relative `/api` paths in production, so proxy `/api/` to the private web service while serving the static browser bundle through the Node application.

### Local market-data backup, restore, and verification

Run backups on a Docker host after stopping or quiescing the relevant market profiles. The backup script writes a timestamped tar archive containing Compose configuration, SeaweedFS volume export, ClickHouse event export, and a manifest-ledger procedure note. It never deletes source data.

```bash
scripts/backup-market-data.sh --output-dir /var/backups/cryptosignal
scripts/verify-market-archive.sh --manifest /absolute/path/to/manifest.ndjson --object-root /absolute/path/to/archive-objects
# For a live SeaweedFS check, the verifier issues read-only S3 HeadObject calls and compares sha256 metadata.
scripts/verify-market-archive.sh --manifest /absolute/path/to/manifest.ndjson --s3-endpoint http://seaweedfs:8333 --s3-bucket cryptosignal-market-archive --s3-access-key "$SEAWEEDFS_S3_ACCESS_KEY" --s3-secret-key "$SEAWEEDFS_S3_SECRET_KEY"
scripts/restore-market-data.sh --source /var/backups/cryptosignal/cryptosignal-market-<UTC>.tar.gz --target-empty-dir /srv/cryptosignal-restore-staging
```

The restore script refuses missing arguments and nonempty targets, prints its exact plan, and stages data only. An operator must inspect checksums, keep services stopped, and import staged data deliberately. Record the three-symbol pilot in [`docs/operations/market-data-capacity-report-template.md`](docs/operations/market-data-capacity-report-template.md) before estimating a disk budget or adding streams.

> Docker image builds, Compose rendering, a backup drill, and a 24-hour public-stream soak require a host with Docker and outbound network access. They cannot be accepted solely from this sandbox.

## Verification

```bash
pnpm test:docker
```

The Docker verification command type-checks, lints, runs serial Vitest contracts (excluding the sandbox-sensitive Telegram credential reachability check), runs the Freqtrade strategy contract, and validates the operator scripts. Do not treat a host `pnpm test` or a locally activated Python environment as a release gate.

## Project conventions

Read [`AGENTS.md`](AGENTS.md) before changing this repository. It contains security boundaries, database migration workflow, required tests, deployment constraints, and the source-of-truth file map for future coding agents.
