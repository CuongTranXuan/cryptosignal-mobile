# Source Notes: Binance MCP and Superpowers

## Binance Agent-Native MCP documentation

The requested Binance Agent-Native MCP page was accessed on 2026-08-22. Its browser-rendered content did not expose the technical MCP specification through the documentation extractor, so the integration plan will treat that page as an official discovery entry point and validate technical transport, authentication, and tool details from Binance’s machine-readable documentation and linked official references before implementation.

Source: <https://developers.binance.com/en/docs/agent-native/mcp-server/agentic>

## Superpowers upstream repository

The requested upstream repository exposes a `skills/` directory, a `LICENSE` file, and multiple agent-plugin integration directories. At review time, GitHub displayed upstream commit `b36e082` on `main`. The README describes marketplace/plugin installation for supported coding agents, but CryptoSignal should not depend on a runtime plugin installer. The eventual plan will instead assess a pinned vendor copy under `skills/superpowers/`, preserve attribution and license material, and review every imported instruction against CryptoSignal’s signals-only safety constraints.

Source: <https://github.com/obra/superpowers/blob/main/README.md>

The upstream `skills/` directory contained fourteen skill packages at the observed revision: `brainstorming`, `dispatching-parallel-agents`, `executing-plans`, `finishing-a-development-branch`, `receiving-code-review`, `requesting-code-review`, `subagent-driven-development`, `systematic-debugging`, `test-driven-development`, `using-git-worktrees`, `using-superpowers`, `verification-before-completion`, `writing-plans`, and `writing-skills`.

Source: <https://github.com/obra/superpowers/tree/main/skills>

## Official Binance public data and MCP findings

Binance’s Agent OS announcement identifies the MCP endpoint as `https://agent.binance.com/mcp/agentic`. It states that market-data reads—tickers, order books, candlesticks, and funding rates—require no authentication, while balance, trading, and transfer scopes depend on user authorization, account eligibility, and regional availability. The CryptoSignal design will allow only the unauthenticated public-data scope and will refuse every private, transfer, and trading capability even if the connected MCP server exposes them.

The official Spot market-stream documentation lists public combined-stream subscriptions at `wss://stream.binance.com:9443/stream` and documents real-time aggregate trades and best-bid/ask updates, diff-depth updates at 1000ms or 100ms, and live kline updates. Kline payloads include an `x` flag that identifies a closed candle. The WebSocket API documentation also documents connection lifecycle handling—ping/pong, a 24-hour connection lifetime, reconnect requirements, and rate-limit backoff. These support an event-driven WebSocket ingest path while preserving the existing closed-candle confirmation boundary.

Sources: <https://www.binance.com/en/support/announcement/detail/07d45cdd3831498f8a4ff339031a8480>, <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-streams/~>, and <https://developers.binance.com/en/docs/products/spot/web-socket-api>.

## Storage findings

Amazon S3 documents 11-nines designed durability for its multi-Availability-Zone general-purpose storage classes and lifecycle transitions among storage classes. ClickHouse documents an S3-backed MergeTree architecture that separates compute from storage but explicitly warns that lifecycle policies on S3 disks can break ClickHouse-managed tables. TiDB provides strong consistency, horizontal scaling, and real-time HTAP, but remains a more operationally substantial choice for raw high-frequency event retention than a purpose-built analytical/event-store tier.

Sources: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/DataDurability.html>, <https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html>, <https://clickhouse.com/docs/guides/oss/deployment-and-scaling/separation-storage-compute>, and <https://docs.pingcap.com/tidb/stable/overview/>.

## Self-hosted storage candidate findings

The original MinIO community repository now declares itself unmaintained, offers source-only community distribution, and is licensed under AGPLv3. It should not be selected as the default for this project without a deliberate licence and maintenance decision. SeaweedFS is Apache-2.0 licensed, offers a local S3-compatible endpoint, can start as a simple single-node service, and can scale with separate volume servers. Garage is also a self-hostable S3-compatible store targeted at small-to-medium deployments but is AGPLv3 licensed. TimescaleDB is an Apache-2.0 PostgreSQL extension with hypertables, columnstore, continuous aggregates, and time-series/event support, but adds a second relational database engine to operate. ClickHouse remains an open-source analytical candidate, capable of continuously ingesting and serving analytical data, but is more operationally involved than the existing MySQL/TiDB control-plane store.

The plan will therefore assess a local-only architecture in which SeaweedFS is the preferred immutable Parquet archive and ClickHouse is an optional, separately deployable analytical serving tier. The first implementation phase will use no cloud dependency and will retain write-ahead raw spool files until object-store upload verification completes.

Sources: <https://github.com/minio/minio>, <https://github.com/seaweedfs/seaweedfs>, <https://github.com/deuxfleurs-org/garage>, <https://github.com/timescale/timescaledb>, and <https://clickhouse.com/docs/get-started/use-cases/real-time-analytics>.
