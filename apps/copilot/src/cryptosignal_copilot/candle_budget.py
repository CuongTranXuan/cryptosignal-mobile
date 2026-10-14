from __future__ import annotations

from cryptosignal_copilot.config import load_default_candle_count

TOKENS_PER_CANDLE = 54
SYSTEM_OVERHEAD_TOKENS = 4_000
HISTORY_TOKEN_CAP = 4_000
BINANCE_CANDLE_LIMIT = 1_000
CANDLE_PRESETS: tuple[int, ...] = (50, 100, 150, 200, 300, 500)
DEFAULT_RECOMMENDED_MAX_CANDLES = 500


def history_token_estimate(text: str) -> int:
    return min(HISTORY_TOKEN_CAP, max(0, len(text) // 3))


def max_candles_for_context(
    context_window: int,
    *,
    reserved_output: int,
    history_tokens: int = 0,
) -> int:
    hist = min(history_tokens, HISTORY_TOKEN_CAP)
    budget = context_window - SYSTEM_OVERHEAD_TOKENS - hist - reserved_output
    if budget <= 0:
        return 0
    return budget // TOKENS_PER_CANDLE


def largest_preset_at_most(value: int) -> int:
    eligible = [p for p in CANDLE_PRESETS if p <= value]
    return eligible[-1] if eligible else 0


def model_candle_limits(
    context_window: int,
    request_max_tokens: int,
    *,
    window_bars: int,
    history_tokens: int = 0,
) -> tuple[int, int, list[int]]:
    """Return (recommended_candles, recommended_max_candles, presets)."""
    raw_max = max_candles_for_context(
        context_window,
        reserved_output=request_max_tokens,
        history_tokens=history_tokens,
    )
    cap = min(raw_max, window_bars, BINANCE_CANDLE_LIMIT)
    safe_max = largest_preset_at_most(cap)
    if safe_max <= 0:
        return 0, 0, []
    presets = [p for p in CANDLE_PRESETS if p <= safe_max]
    default_recommended = load_default_candle_count()
    recommended = default_recommended if default_recommended in presets else presets[-1]
    recommended_max = min(DEFAULT_RECOMMENDED_MAX_CANDLES, safe_max)
    if recommended_max not in presets:
        recommended_max = largest_preset_at_most(recommended_max)
    return recommended, recommended_max, presets


def previous_preset(current: int) -> int:
    below = [p for p in CANDLE_PRESETS if p < current]
    return below[-1] if below else CANDLE_PRESETS[0]


def clamp_candle_count(
    requested: int | None,
    *,
    available: int,
    recommended: int,
    recommended_max: int,
) -> tuple[int, bool]:
    target = requested if requested is not None else recommended
    target = min(target, available, recommended_max)
    target = max(1, target)
    clamped = requested is not None and target != requested
    return target, clamped
