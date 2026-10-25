"""Regime-aware summary checks (anti-sycophancy, no trade calls)."""

from __future__ import annotations

import re

from pydantic_ai import ModelRetry

from cryptosignal_copilot.chart_regime import Regime

_FORBIDDEN_TRADE = re.compile(
    r"\b("
    r"mua ngay|bán ngay|đặt lệnh|vào lệnh|chốt lời|cắt lỗ|"
    r"buy now|sell now|enter (?:here|now)|take profit|stop loss|"
    r"entry|target price|giá mục tiêu"
    r")\b",
    re.IGNORECASE,
)

_REGIME_ACK: dict[str, re.Pattern[str]] = {
    "trend_up": re.compile(
        r"tăng|xu hướng tăng|uptrend|bullish|thị trường tăng|regime.*tăng",
        re.IGNORECASE,
    ),
    "trend_down": re.compile(
        r"giảm|xu hướng giảm|downtrend|bearish|thị trường giảm|regime.*giảm",
        re.IGNORECASE,
    ),
    "range": re.compile(r"đi ngang|range|sideways|tích lũy|biên độ", re.IGNORECASE),
    "volatile": re.compile(r"biến động|volatile|atr cao", re.IGNORECASE),
}

_CONTRADICT: dict[str, re.Pattern[str]] = {
    "trend_down": re.compile(r"tăng mạnh|bull run|mua ngay|breakout up", re.IGNORECASE),
    "trend_up": re.compile(r"giảm mạnh|bear market|bán ngay|breakdown", re.IGNORECASE),
}


def validate_summary_language(summary: str, regime: Regime | str) -> None:
    text = summary.strip()
    if not text:
        return
    if _FORBIDDEN_TRADE.search(text):
        raise ModelRetry(
            "Summary must not include entry/exit/stop/target calls (mua/bán/entry/stop). "
            "Describe geometry and regime only."
        )
    reg = str(regime)
    ack = _REGIME_ACK.get(reg)
    if ack is not None and not ack.search(text):
        raise ModelRetry(
            f"Summary must acknowledge detector regime={reg} (e.g. xu hướng tăng/giảm/đi ngang). "
            "Do not contradict the server regime."
        )
    contradict = _CONTRADICT.get(reg)
    if contradict is not None and contradict.search(text):
        raise ModelRetry(
            f"Summary contradicts detector regime={reg}. Align wording with the regime event."
        )
