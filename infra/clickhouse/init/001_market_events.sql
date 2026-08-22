CREATE TABLE IF NOT EXISTS market_events (
  event_id String,
  venue LowCardinality(String),
  stream_type LowCardinality(String),
  asset_symbol LowCardinality(String),
  exchange_event_time DateTime64(3, 'UTC'),
  ingested_at DateTime64(3, 'UTC'),
  source_connection_id String,
  is_closed_candle UInt8,
  integrity_hash FixedString(64),
  payload_json String
) ENGINE = ReplacingMergeTree
PARTITION BY toDate(exchange_event_time)
ORDER BY (venue, stream_type, asset_symbol, exchange_event_time, event_id)
TTL exchange_event_time + INTERVAL 90 DAY DELETE;

CREATE MATERIALIZED VIEW IF NOT EXISTS market_bars_1m (
  asset_symbol LowCardinality(String),
  minute DateTime('UTC'),
  low AggregateFunction(min, Float64),
  high AggregateFunction(max, Float64),
  open AggregateFunction(argMin, Float64, DateTime64(3, 'UTC')),
  close AggregateFunction(argMax, Float64, DateTime64(3, 'UTC')),
  event_count AggregateFunction(count)
) ENGINE = AggregatingMergeTree
PARTITION BY toDate(minute)
ORDER BY (asset_symbol, minute)
AS SELECT
  asset_symbol,
  toStartOfMinute(exchange_event_time) AS minute,
  minState(JSONExtractFloat(payload_json, 'price')) AS low,
  maxState(JSONExtractFloat(payload_json, 'price')) AS high,
  argMinState(JSONExtractFloat(payload_json, 'price'), exchange_event_time) AS open,
  argMaxState(JSONExtractFloat(payload_json, 'price'), exchange_event_time) AS close,
  countState() AS event_count
FROM market_events
WHERE stream_type = 'AGG_TRADE'
GROUP BY asset_symbol, minute;
