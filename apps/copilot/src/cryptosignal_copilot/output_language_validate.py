"""Trade-call blocklist for per-pick notes (N13/N15) — pattern classes, not phrase lists."""

from __future__ import annotations

import re

from pydantic_ai import ModelRetry

# --- Allow overrides (N15): checked before blocks ---
_ALLOW_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"thanh khoản\s+long", re.IGNORECASE),
    re.compile(r"liquidity\s+long", re.IGNORECASE),
    re.compile(r"phe\s+short", re.IGNORECASE),
    re.compile(r"lực\s+bán\s+ngay\s+sau", re.IGNORECASE),
    re.compile(r"volume\s+tp\b", re.IGNORECASE),
    re.compile(r"\btp\s+1h\b", re.IGNORECASE),
)

# C.10 exact high-signal phrases (still blocked)
_LEGACY_PHRASE_BLOCKS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\blong\s+ở\b", re.IGNORECASE),
    re.compile(r"\bshort\s+tại\b", re.IGNORECASE),
    re.compile(r"\bnên\s+bán\b", re.IGNORECASE),
    re.compile(r"\bhãy\s+mua\s+vào\b", re.IGNORECASE),
    re.compile(r"\bBuy the dip\b", re.IGNORECASE),
    re.compile(r"\bgo long\b", re.IGNORECASE),
    re.compile(r"\bmua ngay\b", re.IGNORECASE),
    re.compile(r"\bbán ngay\b", re.IGNORECASE),
    re.compile(r"\bđặt lệnh\b", re.IGNORECASE),
    re.compile(r"\bvào lệnh\b", re.IGNORECASE),
    re.compile(r"\bbuy now\b", re.IGNORECASE),
    re.compile(r"\bsell now\b", re.IGNORECASE),
)

# N13 general classes
_TRADE_SIDE_AT_PRICE = re.compile(
    r"\b(long|short|mua|bán|buy|sell)\b"
    r"(?:\s+vào)?"
    r"(?:\s+(?:ở|tại|quanh|at|here))+"
    r"(?:\s*[\d,.]+[kmb]?)?",
    re.IGNORECASE,
)
_TRADE_SIDE_AT_PRICE_COMPACT = re.compile(
    r"\b(long|short|mua|bán|buy|sell)\s+(?:vào\s+)?(?:ở|tại|quanh|at|here)\b",
    re.IGNORECASE,
)
_SL_TP_PRICE = re.compile(
    r"(?:\b(?:sl|tp)\b|stop[- ]?loss|take\s+profit(?:\s+at)?|"
    r"cắt\s+lỗ|chốt\s+lời|đặt\s+stop)"
    r"(?:\s+(?:ở|tại|at))?"
    r"[\s:=-]*[\d,.]+[kmb]?",
    re.IGNORECASE,
)
_SL_TP_PAIR = re.compile(
    r"stop\s+at\s+[\d,.]+[kmb]?\s*,\s*tp\s+[\d,.]+",
    re.IGNORECASE,
)
_IMPERATIVE_TRADE = re.compile(
    r"\b(nên|hãy|canh)\s+(mua|bán|long|short)\b",
    re.IGNORECASE,
)
_BUY_SELL_HERE = re.compile(r"\b(buy|sell)\s+here\b", re.IGNORECASE)
_GO_SHORT_LONG = re.compile(r"\bgo\s+(long|short)\b", re.IGNORECASE)
_SL_EQUALS = re.compile(r"\bsl\s*[=:]\s*[\d,.]+", re.IGNORECASE)

# Directional narrative in pick notes (N14) — must not reach stream via model text
_DIRECTIONAL_NARRATIVE = re.compile(
    r"(phe mua đã kiểm soát|đảo chiều lên|vượt đỉnh cũ|sắp sụp đổ|"
    r"giá sẽ (tăng|giảm|lên|xuống|vượt)|expect a rally|new highs)",
    re.IGNORECASE,
)


def _allowed_descriptive(text: str) -> bool:
    return any(p.search(text) for p in _ALLOW_PATTERNS)


def validate_pick_note(note: str) -> None:
    text = note.strip()
    if not text:
        return
    if _allowed_descriptive(text):
        return
    for pattern in _LEGACY_PHRASE_BLOCKS:
        if pattern.search(text):
            raise ModelRetry(
                "pick note must not contain trade instructions; describe geometry/touches only."
            )
    if _TRADE_SIDE_AT_PRICE.search(text) or _TRADE_SIDE_AT_PRICE_COMPACT.search(text):
        raise ModelRetry("pick note must not instruct entries (side + at/ở + price).")
    if _SL_TP_PRICE.search(text) or _SL_TP_PAIR.search(text) or _SL_EQUALS.search(text):
        raise ModelRetry("pick note must not set SL/TP/stop/take-profit levels.")
    if _IMPERATIVE_TRADE.search(text) or _BUY_SELL_HERE.search(text) or _GO_SHORT_LONG.search(text):
        raise ModelRetry("pick note must not use imperative trade verbs.")
    if _DIRECTIONAL_NARRATIVE.search(text):
        raise ModelRetry("pick note must not state directional forecasts; server sets bias.")


def validate_summary_imperatives(summary: str) -> None:
    """Backward-compat alias: same rules as pick notes."""
    validate_pick_note(summary)


def imperative_patterns() -> tuple[re.Pattern[str], ...]:
    return _LEGACY_PHRASE_BLOCKS
