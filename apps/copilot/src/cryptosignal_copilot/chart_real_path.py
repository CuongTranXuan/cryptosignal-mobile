"""Resolve → guardrails → schema filter → gate → cap (agent-equivalent preview path)."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any

from cryptosignal_copilot.candidates import CandidateCatalog
from cryptosignal_copilot.chart_response import enrich_shapes_with_guardrails
from cryptosignal_copilot.drawing_gate import DrawingWindow
from cryptosignal_copilot.drawing_intent import (
    DrawingIntent,
    enrich_resolved_shapes,
    fit_intents_to_shape_budget,
    resolve_drawing_intents,
)
from cryptosignal_copilot.gate_policy import split_gate_and_cap_drops
from cryptosignal_copilot.schema import Candle, filter_preview_details


@dataclass
class RealPathMetrics:
    intents: int
    shapes_in: int
    shapes_out: int
    gate_dropped: int
    cap_dropped: int
    split_picks: int
    invalidations_in: int
    invalidations_out: int
    evidence_in: int
    evidence_out: int
    gate_reasons: dict[str, int]


def _invalidation_count(shapes: list[dict[str, Any]]) -> int:
    total = 0
    for shape in shapes:
        guard = shape.get("guardrail")
        if isinstance(guard, dict) and guard.get("invalidation"):
            total += 1
    return total


def _evidence_count(shapes: list[dict[str, Any]]) -> int:
    total = 0
    for shape in shapes:
        guard = shape.get("guardrail")
        if isinstance(guard, dict) and guard.get("evidence_against"):
            total += 1
    return total


def _split_pick_count(
    intents: list[DrawingIntent],
    catalog: CandidateCatalog,
    valid: list[dict[str, Any]],
) -> int:
    by_id = catalog.by_id()
    out_ids = {str(s.get("_candidate_id", "")) for s in valid if s.get("_candidate_id")}
    splits = 0
    for intent in intents:
        if intent.type != "candidate":
            continue
        cand = by_id.get(intent.candidate_id)
        if cand is None:
            continue
        present = sum(1 for s in valid if str(s.get("_candidate_id", "")) == cand.id)
        if 0 < present < len(cand.shapes):
            splits += 1
        if present > 0 and cand.id not in out_ids:
            splits += 1
    return splits


def run_real_path(
    catalog: CandidateCatalog,
    candles: list[Candle],
    *,
    symbol: str,
    interval: str,
    style: str,
) -> tuple[list[dict[str, Any]], RealPathMetrics]:
    intents = fit_intents_to_shape_budget(catalog, style)
    shapes, _ = resolve_drawing_intents(intents, catalog)
    last_close = float(candles[-1].close)
    shapes = enrich_resolved_shapes(shapes, catalog, last_close=last_close)
    inv_in = _invalidation_count(shapes)
    ev_in = _evidence_count(shapes)
    window = DrawingWindow(
        candles=candles,
        interval=interval,  # type: ignore[arg-type]
        window_start=candles[0].time,
        allowed_times={c.time for c in candles},
    )
    valid, dropped = filter_preview_details(
        shapes,
        {c.time for c in candles},
        symbol=symbol,
        interval=interval,  # type: ignore[arg-type]
        window=window,
    )
    valid, _anchors = enrich_shapes_with_guardrails(
        valid,
        regime=str(catalog.regime),
        symbol=symbol,
        interval=interval,
    )
    gate_drops, cap_drops = split_gate_and_cap_drops(dropped)
    metrics = RealPathMetrics(
        intents=len(intents),
        shapes_in=len(shapes),
        shapes_out=len(valid),
        gate_dropped=len(gate_drops),
        cap_dropped=len(cap_drops),
        split_picks=_split_pick_count(intents, catalog, valid),
        invalidations_in=inv_in,
        invalidations_out=_invalidation_count(valid),
        evidence_in=ev_in,
        evidence_out=_evidence_count(valid),
        gate_reasons=dict(Counter(reason for _, reason in gate_drops)),
    )
    return valid, metrics
