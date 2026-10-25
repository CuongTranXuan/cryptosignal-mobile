from __future__ import annotations

from typing import Any, Literal

ChartStyleId = Literal["classic", "smc", "elliott", "wyckoff"]
ChartBias = Literal["bullish", "bearish", "neutral"]

# Patterns with an implemented or stub detector hook in this branch.
_STYLE_PATTERNS: dict[str, tuple[str, ...]] = {
    "classic": (
        "head_and_shoulders",
        "inverse_head_and_shoulders",
        "double_top",
        "double_bottom",
        "ascending_triangle",
        "descending_triangle",
        "symmetrical_triangle",
        "channel_up",
        "channel_down",
        "trendline",
        "support_resistance",
        "fib_retracement",
    ),
    "smc": (
        "bos",
        "choch",
        "fvg",
        "order_block",
        "liquidity",
    ),
    "elliott": (),
    "wyckoff": (),
}

ALL_STYLES: frozenset[str] = frozenset(_STYLE_PATTERNS)
ALL_PATTERNS: frozenset[str] = frozenset(
    pattern for patterns in _STYLE_PATTERNS.values() for pattern in patterns
)


def list_styles_payload() -> dict[str, Any]:
    styles = [
        {"id": style_id, "patterns": [{"id": pid} for pid in _STYLE_PATTERNS[style_id]]}
        for style_id in ("classic", "smc", "elliott", "wyckoff")
    ]
    return {"styles": styles}


def patterns_for_style(style: str) -> tuple[str, ...]:
    return _STYLE_PATTERNS.get(style, ())


def validate_style(style: str) -> bool:
    return style in ALL_STYLES


def validate_pattern_for_style(style: str, pattern: str) -> bool:
    return pattern in patterns_for_style(style)
