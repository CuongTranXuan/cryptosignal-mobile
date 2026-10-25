"""SSE payloads for regime and analysis (Part B §5 / spec #32)."""

from __future__ import annotations

from typing import Any

from cryptosignal_copilot.candidates import CandidateCatalog, DrawingCandidate
from cryptosignal_copilot.chart_regime import Regime
from cryptosignal_copilot.market_price import format_market_price


def regime_to_bias(regime: Regime | str) -> str:
    if regime == "trend_up":
        return "bullish"
    if regime == "trend_down":
        return "bearish"
    return "neutral"


def build_regime_event(
    catalog: CandidateCatalog,
    intent_check: dict[str, Any],
    *,
    htf: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "ltf": {
            "regime": str(catalog.regime),
            "atr": catalog.atr,
        },
        "htf": htf or {},
        "intent_check": intent_check,
    }


def _evidence_for_regime(catalog: CandidateCatalog, *, symbol: str) -> list[str]:
    regime = str(catalog.regime)
    lines: list[str] = []
    if regime == "trend_up":
        lines.append("Đỉnh/đáy cao hơn trên các swing gần đây")
        lines.append("Giá trên EMA50, độ dốc EMA20 dương")
    elif regime == "trend_down":
        lines.append("Đỉnh/đáy thấp hơn trên các swing gần đây")
        lines.append("Giá dưới EMA50, độ dốc EMA20 âm")
    elif regime == "volatile":
        lines.append("ATR cao so với trung vị gần đây")
    else:
        lines.append("Cấu trúc swing hỗn hợp, chưa rõ xu hướng")
    if catalog.atr is not None:
        lines.append(f"ATR14 ≈ {format_market_price(float(catalog.atr), symbol)}")
    return lines


def build_analysis_event(
    catalog: CandidateCatalog,
    shapes: list[dict[str, Any]],
    intent_check: dict[str, Any],
    *,
    picked: list[DrawingCandidate] | None = None,
    symbol: str = "BTCUSDT",
) -> dict[str, Any]:
    bias = regime_to_bias(catalog.regime)
    evidence_for = _evidence_for_regime(catalog, symbol=symbol)
    evidence_against: list[str] = []
    confidences: list[float] = []
    primary_inv: dict[str, Any] | None = None

    for shape in shapes:
        guard = shape.get("guardrail")
        if not isinstance(guard, dict):
            continue
        conf = guard.get("confidence")
        if isinstance(conf, (int, float)):
            confidences.append(float(conf))
        against = guard.get("evidence_against")
        if isinstance(against, list):
            for item in against:
                if isinstance(item, str) and item and item not in evidence_against:
                    evidence_against.append(item)
        inv = guard.get("invalidation")
        if primary_inv is None and isinstance(inv, dict) and inv.get("price") is not None:
            primary_inv = inv

    if picked:
        for cand in picked:
            for item in cand.evidence_against:
                if item and item not in evidence_against:
                    evidence_against.append(item)

    confidence = round(sum(confidences) / len(confidences), 3) if confidences else 0.55
    if not evidence_for:
        evidence_for = ["Chế độ detector từ nến đã đóng"]
    if shapes and not evidence_against:
        evidence_against = ["Không có cảnh báo cấu trúc trên các hình đã chọn"]

    return {
        "bias": bias,
        "no_valid_pattern": len(shapes) == 0,
        "evidence_for": evidence_for,
        "evidence_against": evidence_against,
        "invalidation": primary_inv,
        "confidence": confidence,
        "intent_check": intent_check,
    }
