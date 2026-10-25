"""Structured summary direction + narrow imperative trade-call blocklist."""

from __future__ import annotations

import re
from typing import Literal

from pydantic_ai import ModelRetry

from cryptosignal_copilot.chart_regime import Regime

SummaryDirection = Literal["bullish", "bearish", "neutral", "conditional"]

# Imperative trade instructions only — not descriptive geometry/volatility/invalidation prose.
_IMPERATIVE_BLOCKLIST: tuple[re.Pattern[str], ...] = (
    re.compile(r"\blong\s+ở\b", re.IGNORECASE),
    re.compile(r"\bshort\s+tại\b", re.IGNORECASE),
    re.compile(r"\bnên\s+bán\b", re.IGNORECASE),
    re.compile(r"\bhãy\s+mua\s+vào\b", re.IGNORECASE),
    re.compile(r"\bBuy the dip\b", re.IGNORECASE),
    re.compile(r"\bgo long\b", re.IGNORECASE),
    re.compile(r"\bSL\s+[\d,.]+", re.IGNORECASE),
    re.compile(r"\bstop at\s+[\d,.]+", re.IGNORECASE),
    re.compile(r"\bTP\s+[\d,.]+", re.IGNORECASE),
    re.compile(r"\bstop at\s+[\d,.]+,\s*TP\s+[\d,.]+", re.IGNORECASE),
    re.compile(r"\bmua ngay\b", re.IGNORECASE),
    re.compile(r"\bbán ngay\b", re.IGNORECASE),
    re.compile(r"\bđặt lệnh\b", re.IGNORECASE),
    re.compile(r"\bvào lệnh\b", re.IGNORECASE),
    re.compile(r"\bbuy now\b", re.IGNORECASE),
    re.compile(r"\bsell now\b", re.IGNORECASE),
)


def validate_summary_imperatives(summary: str) -> None:
    text = summary.strip()
    if not text:
        return
    for pattern in _IMPERATIVE_BLOCKLIST:
        if pattern.search(text):
            raise ModelRetry(
                "Summary must not give trade instructions (long/short/mua/bán/SL/TP as orders). "
                "Use summary_direction for bias; describe geometry only."
            )


def validate_summary_direction(
    direction: SummaryDirection,
    regime: Regime | str,
) -> None:
    reg = str(regime)
    if direction == "conditional":
        return
    if reg == "trend_down" and direction == "bullish":
        raise ModelRetry(
            "summary_direction=bullish contradicts detector regime=trend_down. "
            "Use bearish, neutral, or conditional with explicit if/then framing."
        )
    if reg == "trend_up" and direction == "bearish":
        raise ModelRetry(
            "summary_direction=bearish contradicts detector regime=trend_up. "
            "Use bullish, neutral, or conditional with explicit if/then framing."
        )
    if reg == "volatile" and direction in ("bullish", "bearish"):
        raise ModelRetry("summary_direction should be neutral or conditional when regime=volatile.")


def imperative_patterns() -> tuple[re.Pattern[str], ...]:
    return _IMPERATIVE_BLOCKLIST
