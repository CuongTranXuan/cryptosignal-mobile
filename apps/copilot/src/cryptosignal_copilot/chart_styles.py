from __future__ import annotations

from typing import Any, Literal

from cryptosignal_copilot.candidates import CLASSIC_PATTERNS, PATTERNS_WITH_DETECTORS, SMC_PATTERNS

ChartStyleId = Literal["classic", "smc", "elliott", "wyckoff"]
ChartBias = Literal["bullish", "bearish", "neutral"]

_STYLE_PATTERNS: dict[str, tuple[str, ...]] = {
    "classic": tuple(sorted(CLASSIC_PATTERNS)),
    "smc": tuple(sorted(SMC_PATTERNS)),
    "elliott": (),
    "wyckoff": (),
}

ALL_STYLES: frozenset[str] = frozenset(_STYLE_PATTERNS)
ALL_PATTERNS: frozenset[str] = PATTERNS_WITH_DETECTORS


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
