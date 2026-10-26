"""Server-authored Vietnamese stream summary (N14/N18): no model free text."""

from __future__ import annotations

from typing import Any, Literal

from cryptosignal_copilot.analysis_events import build_analysis_event, regime_to_bias
from cryptosignal_copilot.candidates import CandidateCatalog, DrawingCandidate
from cryptosignal_copilot.chart_regime import Regime
from cryptosignal_copilot.drawing_intent import AnalyzeResultLlm, DrawingIntent, PickAssessment
from cryptosignal_copilot.market_price import format_market_price
from cryptosignal_copilot.vi_text import (
    BIAS_CONFLICT_VI,
    condition_code,
    display_name_vi,
    invalidation_text_vi,
    localize_evidence,
)

SummaryDirection = Literal["bullish", "bearish", "neutral", "conditional"]

_QUALITY_VI = {"strong": "mạnh", "ok": "ổn", "weak": "yếu"}
_CONFLUENCE_VI: dict[str, str] = {
    "htf_level": "mức khung lớn (HTF)",
    "fib": "Fibonacci",
    "volume": "khối lượng",
    "liquidity": "thanh khoản",
    "ema": "EMA",
    "order_block": "khối lệnh",
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
            f"{symbol} {interval}: chế độ thị trường là xu hướng tăng — "
            "cấu trúc đỉnh/đáy cao hơn trên các nến đã đóng."
        )
    if regime == "trend_down":
        return (
            f"{symbol} {interval}: chế độ thị trường là xu hướng giảm — "
            "cấu trúc đỉnh/đáy thấp hơn trên các nến đã đóng."
        )
    if regime == "volatile":
        return (
            f"{symbol} {interval}: chế độ thị trường là biến động mạnh — "
            "biên độ ATR cao so với trung vị gần đây."
        )
    return (
        f"{symbol} {interval}: chế độ thị trường là đi ngang — "
        "chưa có xu hướng rõ trên các nến đã đóng."
    )


def _bias_line(bias: str) -> str:
    if bias == "bullish":
        return "Thiên hướng lớp phủ (máy chủ): tăng theo bộ phát hiện."
    if bias == "bearish":
        return "Thiên hướng lớp phủ (máy chủ): giảm theo bộ phát hiện."
    return "Thiên hướng lớp phủ (máy chủ): trung tính / đi ngang theo bộ phát hiện."


def _conditional_clause(
    invalidation: dict[str, Any] | None,
    *,
    symbol: str,
) -> str:
    if not invalidation or invalidation.get("price") is None:
        return (
            "Kịch bản hai phía: nếu giá phá vượt vùng vô hiệu thì thiên hướng theo hướng phá; "
            "nếu giữ trong vùng thì coi là đi ngang."
        )
    raw_price = float(invalidation["price"])
    price = format_market_price(raw_price, symbol)
    cond = condition_code(invalidation.get("condition"))
    if cond == "close_below":
        return (
            f"Kịch bản có điều kiện: nếu đóng cửa dưới {price} thì thiên hướng giảm; "
            f"nếu giữ trên {price} thì trung tính/đi ngang."
        )
    if cond == "close_above":
        return (
            f"Kịch bản có điều kiện: nếu đóng cửa trên {price} thì thiên hướng tăng; "
            f"nếu giữ dưới {price} thì trung tính/đi ngang."
        )
    return (
        f"Kịch bản có điều kiện: nếu đóng cửa vượt {price} thì đổi thiên hướng; "
        "nếu không vượt thì tiếp tục quan sát vùng đi ngang."
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
            label = display_name_vi(cand.name) if cand is not None else cid
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
        inv_text = invalidation_text_vi(inv.get("condition"), inv_price)
        parts.append(f"Vô hiệu hóa (bộ phát hiện): {inv_text}.")

    if bool(intent_check.get("bias_conflict")):
        message = intent_check.get("message")
        conflict_line = message if isinstance(message, str) and message else BIAS_CONFLICT_VI
        parts.append(f"Lưu ý: {conflict_line}")

    if not shapes:
        parts.append("Không có mô hình hợp lệ trên cửa sổ này.")
    else:
        ev_for = analysis.get("evidence_for") or []
        if ev_for:
            parts.append("Ủng hộ: " + "; ".join(str(x) for x in ev_for[:3]) + ".")
        ev_against = analysis.get("evidence_against") or []
        if ev_against:
            vi = [localize_evidence(str(x)) for x in ev_against[:4]]
            parts.append("Lưu ý kỹ thuật: " + "; ".join(vi) + ".")

    assessments_by_id = {a.candidate_id: a for a in llm_output.pick_assessments}
    pick_lines = _pick_lines(catalog, llm_output.drawing_intents, assessments_by_id)
    if pick_lines:
        parts.append("Chi tiết lựa chọn:")
        parts.extend(pick_lines)

    parts.append("Đây không phải tín hiệu vào lệnh; chỉ mô tả hình học trên nến đã đóng.")
    return "\n\n".join(parts), direction
