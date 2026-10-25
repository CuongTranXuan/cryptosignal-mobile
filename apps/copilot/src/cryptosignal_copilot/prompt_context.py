"""Compact analyze prompt payloads (feature sheet + tail candles)."""

from __future__ import annotations

import json
from typing import Any

from cryptosignal_copilot.features import compact_candle_row
from cryptosignal_copilot.schema import AnalyzeRequest

TAIL_CANDLE_COUNT = 25


def compact_candle_rows(request: AnalyzeRequest) -> list[list[float]]:
    return [compact_candle_row(c) for c in request.closedCandles]  # Candle satisfies CandleLike


def tail_candle_rows(request: AnalyzeRequest, count: int = TAIL_CANDLE_COUNT) -> list[list[float]]:
    candles = request.closedCandles[-count:] if request.closedCandles else []
    return [compact_candle_row(c) for c in candles]


def estimate_prompt_candle_chars(request: AnalyzeRequest, *, compact: bool) -> int:
    if compact:
        payload = tail_candle_rows(request)
    else:
        payload = [c.model_dump() for c in request.closedCandles]
    return len(json.dumps(payload, separators=(",", ":")))


def build_prompt_context(
    request: AnalyzeRequest,
    *,
    feature_sheet: dict[str, Any],
    candidates: list[dict[str, Any]],
    style_slice: str,
) -> dict[str, Any]:
    return {
        "symbol": request.symbol,
        "interval": request.interval,
        "from": request.from_,
        "to": request.to,
        "intent": request.intent.model_dump() if request.intent else None,
        "feature_sheet": feature_sheet,
        "candidates": candidates,
        "recent_closed_candles": tail_candle_rows(request),
        "style_guidance": style_slice,
    }
