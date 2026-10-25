"""Server-authored Vietnamese stream summary (N14/N18): no model free text."""

from __future__ import annotations

from typing import Any, Literal

from cryptosignal_copilot.analysis_events import build_analysis_event, regime_to_bias
from cryptosignal_copilot.candidates import CandidateCatalog, DrawingCandidate
from cryptosignal_copilot.chart_regime import Regime
from cryptosignal_copilot.drawing_intent import AnalyzeResultLlm, DrawingIntent, PickAssessment
from cryptosignal_copilot.evidence_i18n import evidence_to_vietnamese
from cryptosignal_copilot.market_price import format_market_price

SummaryDirection = Literal["bullish", "bearish", "neutral", "conditional"]

_QUALITY_VI = {"strong": "mạnh", "ok": "ổn", "weak": "yếu"}
_CONFLUENCE_VI: dict[str, str] = {
    "htf_level": "mức HTF",
    "fib": "Fib",
    "volume": "khối lượng",
    "liquidity": "thanh khoản",
    "ema": "EMA",
    "order_block": "order block",
    "structure": "cấu trúc",
}


def summary_direction_from_regime(
    regime: Regime | str,
    *,
    has_invalidation: bool = False,
) -> SummaryDirection:
    reg = str(regime)
    if reg == "range" and has_invalidation:
        return "conditional"
    bias = regime_to_bias(reg)
    if bias == "bullish":
        return "bullish"
    if bias == "bearish":
        return "bearish"
    return "neutral"


def _regime_lead(regime: str, symbol: str, interval: str) -> str:
    if regime == "trend_up":
        return (
            f"{symbol} {interval}: chế độ detector là xu hướng tăng — "
            "cấu trúc đỉnh/đáy cao hơn trên các nến đã đóng."
        )
    if regime == "trend_down":
        return (
            f"{symbol} {interval}: chế độ detector là xu hướng giảm — "
            "cấu trúc đỉnh/đáy thấp hơn trên các nến đã đóng."
        )
    if regime == "volatile":
        return (
            f"{symbol} {interval}: chế độ detector là biến động cao — "
            "biên độ ATR nổi so với trung vị gần đây."
        )
    return (
        f"{symbol} {interval}: chế độ detector là sideway — "
        "chưa có xu hướng rõ trên các nến đã đóng."
    )


def _bias_line(bias: str) -> str:
    if bias == "bullish":
        return "Thiên hướng overlay (máy chủ): tăng theo detector."
    if bias == "bearish":
        return "Thiên hướng overlay (máy chủ): giảm theo detector."
    return "Thiên hướng overlay (máy chủ): trung tính / range theo detector."


def _conditional_clause(
    invalidation: dict[str, Any] | None,
    *,
    symbol: str,
) -> str:
    if not invalidation or invalidation.get("price") is None:
        return (
            "Kịch bản hai phía: nếu giá phá vượt vùng vô hiệu thì bias theo hướng phá; "
            "nếu giữ trong vùng thì coi là range."
        )
    raw_price = float(invalidation["price"])
    price = format_market_price(raw_price, symbol)
    cond = str(invalidation.get("condition") or "close beyond")
    if cond == "close_below":
        return (
            f"Kịch bản có điều kiện: nếu đóng cửa dưới {price} thì bias giảm; "
            f"nếu giữ trên {price} thì trung tính/range."
        )
    if cond == "close_above":
        return (
            f"Kịch bản có điều kiện: nếu đóng cửa trên {price} thì bias tăng; "
            f"nếu giữ dưới {price} thì trung tính/range."
        )
    return (
        f"Kịch bản có điều kiện: nếu đóng cửa vượt {price} ({cond}) thì đổi bias; "
        f"nếu không vượt thì giữ quan sát range."
    )


def _render_assessment(assessment: PickAssessment) -> str:
    parts = [f"chất lượng {_QUALITY_VI.get(assessment.quality, assessment.quality)}"]
    if assessment.confluence:
        labels = [_CONFLUENCE_VI.get(c, c) for c in assessment.confluence]
        parts.append("hội tụ: " + ", ".join(labels))
    if assessment.touch_ack:
        parts.append("đã xác nhận chạm")
    return "AI đánh giá: " + "; ".join(parts)


def _pick_lines(
    catalog: CandidateCatalog,
    intents: list[DrawingIntent],
    assessments_by_id: dict[str, PickAssessment],
) -> list[str]:
    by_id = catalog.by_id()
    lines: list[str] = []
    for intent in intents:
        ids = [intent.candidate_id] if intent.type == "candidate" else list(intent.candidate_ids)
        for cid in ids:
            cand = by_id.get(cid)
            label = cand.name if cand is not None else cid
            assessment = assessments_by_id.get(cid)
            if assessment is not None:
                lines.append(f"• {label}: {_render_assessment(assessment)}")
            else:
                lines.append(f"• {label}")
    return lines


def compose_stream_summary(
    catalog: CandidateCatalog,
    llm_output: AnalyzeResultLlm,
    *,
    symbol: str,
    interval: str,
    intent_check: dict[str, Any],
    shapes: list[dict[str, Any]],
    picked: list[DrawingCandidate],
) -> tuple[str, SummaryDirection]:
    analysis = build_analysis_event(
        catalog, shapes, intent_check, picked=picked or None, symbol=symbol
    )
    regime = str(catalog.regime)
    direction = summary_direction_from_regime(
        regime,
        has_invalidation=analysis.get("invalidation") is not None,
    )
    parts = [_regime_lead(regime, symbol, interval)]

    bias = str(analysis.get("bias") or regime_to_bias(regime))
    if direction == "conditional":
        parts.append(_conditional_clause(analysis.get("invalidation"), symbol=symbol))
    else:
        parts.append(_bias_line(bias))

    inv = analysis.get("invalidation")
    if isinstance(inv, dict) and inv.get("price") is not None:
        inv_price = format_market_price(float(inv["price"]), symbol)
        cond = str(inv.get("condition") or "close beyond")
        parts.append(f"Vô hiệu hóa (detector): {cond} tại {inv_price}.")

    if bool(intent_check.get("bias_conflict")):
        message = intent_check.get("message")
        conflict_line = (
            message
            if isinstance(message, str) and message
            else "Thiên kiến người dùng không khớp chế độ detector; lớp phủ theo chế độ detector."
        )
        parts.append(f"Lưu ý: {conflict_line}")

    if not shapes:
        parts.append("Không có mô hình hợp lệ trên cửa sổ này.")
    else:
        ev_for = analysis.get("evidence_for") or []
        if ev_for:
            parts.append("Ủng hộ: " + "; ".join(str(x) for x in ev_for[:3]) + ".")
        ev_against = analysis.get("evidence_against") or []
        if ev_against:
            vi = [evidence_to_vietnamese(str(x)) for x in ev_against[:4]]
            parts.append("Lưu ý kỹ thuật: " + "; ".join(vi) + ".")

    assessments_by_id = {a.candidate_id: a for a in llm_output.pick_assessments}
    pick_lines = _pick_lines(catalog, llm_output.drawing_intents, assessments_by_id)
    if pick_lines:
        parts.append("Chi tiết pick:")
        parts.extend(pick_lines)

    parts.append("Đây không phải tín hiệu vào lệnh; chỉ mô tả geometry trên nến đã đóng.")
    return "\n\n".join(parts), direction
