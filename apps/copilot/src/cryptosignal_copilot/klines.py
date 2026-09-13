from __future__ import annotations

import httpx
from cryptosignal_copilot.schema import Candle

KLINES_URL = "https://api.binance.com/api/v3/klines"


async def fetch_klines(
    symbol: str,
    interval: str,
    limit: int = 500,
    start_time: int | None = None,
    end_time: int | None = None,
    *,
    client: httpx.AsyncClient | None = None,
) -> list[Candle]:
    limit = max(1, min(int(limit), 1000))
    params: dict[str, str | int] = {"symbol": symbol.upper(), "interval": interval, "limit": limit}
    if start_time is not None:
        params["startTime"] = start_time
    if end_time is not None:
        params["endTime"] = end_time
    own = client is None
    http = client or httpx.AsyncClient(timeout=20)
    try:
        response = await http.get(KLINES_URL, params=params)
        response.raise_for_status()
        rows = response.json()
    finally:
        if own:
            await http.aclose()
    candles: list[Candle] = []
    for row in rows:
        candles.append(
            Candle(
                time=int(row[0]) // 1000,
                open=float(row[1]),
                high=float(row[2]),
                low=float(row[3]),
                close=float(row[4]),
                volume=float(row[5]),
            )
        )
    return candles
