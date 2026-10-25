"""Server-authored Vietnamese stream summary (N14): regime bias from detector, not LLM prose."""

from __future__ import annotations

from typing import Any, Literal

from pydantic_ai import ModelRetry

from cryptosignal_copilot.analysis_events import build_analysis_event, regime_to_bias
from cryptosignal_copilot.candidates import CandidateCatalog, DrawingCandidate
from cryptosignal_copilot.chart_regime import Regime
from cryptosignal_copilot.drawing_intent import AnalyzeResultLlm, DrawingIntent
from cryptosignal_copilot.output_language_validate import validate_pick_note

SummaryDirection = Literal["bullish", "bearish", "neutral", "conditional"]


def summary_direction_from_regime(
    regime: Regime | str,
    *,
    bias_conflict: bool = False,
    has_invalidation: bool = False,
) -> SummaryDirection:
    if bias_conflict and has_invalidation:
        return "conditional"
    if bias_conflict:
        return "neutral"
    bias = regime_to_bias(str(regime))
    if bias == "bullish":
        return "bullish"
    if bias == "bearish":
        return "bearish"
    return "neutral"


def _regime_lead(regime: str, symbol: str, interval: str) -> str:
    if regime == "trend_up":
        return (
            f"{symbol} {interval}: chế độ detector là xu hướng tăng — "
            "cấu trúng đỉnh/đáy cao hơn trên các nến đã đóng."
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


def _conditional_clause(invalidation: dict[str, Any] | None) -> str:
    if not invalidation or invalidation.get("price") is None:
        return (
            "Kịch bản hai phía: nếu giá phá vượt vùng invalidation thì bias theo hướng phá; "
            "nếu giữ trong vùng thì coi là range."
        )
    price = invalidation.get("price")
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


def _pick_lines(
    catalog: CandidateCatalog,
    intents: list[DrawingIntent],
    notes_by_id: dict[str, str],
) -> list[str]:
    by_id = catalog.by_id()
    lines: list[str] = []
    for intent in intents:
        ids = [intent.candidate_id] if intent.type == "candidate" else list(intent.candidate_ids)
        for cid in ids:
            cand = by_id.get(cid)
            label = cand.name if cand is not None else cid
            note = (notes_by_id.get(cid) or "").strip()
            if note:
                try:
                    validate_pick_note(note)
                except ModelRetry:
                    note = ""
            if note:
                lines.append(f"• {label}: {note}")
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
    analysis = build_analysis_event(catalog, shapes, intent_check, picked=picked or None)
    regime = str(catalog.regime)
    direction = summary_direction_from_regime(
        regime,
        bias_conflict=bool(intent_check.get("bias_conflict")),
        has_invalidation=analysis.get("invalidation") is not None,
    )
    parts = [_regime_lead(regime, symbol, interval)]

    bias = str(analysis.get("bias") or regime_to_bias(regime))
    if direction == "conditional":
        parts.append(_conditional_clause(analysis.get("invalidation")))
    elif bias == "bullish":
        parts.append("Bias overlay (server): thiên hướng tăng theo detector.")
    elif bias == "bearish":
        parts.append("Bias overlay (server): thiên hướng giảm theo detector.")
    else:
        parts.append("Bias overlay (server): trung tính / range theo detector.")

    ev_for = analysis.get("evidence_for") or []
    if ev_for:
        parts.append("Ủng hộ: " + "; ".join(str(x) for x in ev_for[:3]) + ".")
    ev_against = analysis.get("evidence_against") or []
    if ev_against:
        parts.append("Lưu ý: " + "; ".join(str(x) for x in ev_against[:4]) + ".")

    notes_by_id = {n.candidate_id: n.note for n in llm_output.pick_notes}
    pick_lines = _pick_lines(catalog, llm_output.drawing_intents, notes_by_id)
    if pick_lines:
        parts.append("Ghi chú theo pick (mô hình, không phải khuyến nghị giao dịch):")
        parts.extend(pick_lines)

    parts.append("Đây không phải tín hiệu vào lệnh; chỉ mô tả geometry trên nến đã đóng.")
    return "\n\n".join(parts), direction


def notes_by_id(llm_output: AnalyzeResultLlm) -> dict[str, str]:
    return {n.candidate_id: n.note for n in llm_output.pick_notes}
