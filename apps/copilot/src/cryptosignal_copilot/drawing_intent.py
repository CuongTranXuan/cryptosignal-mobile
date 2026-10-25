"""Id-based drawing intents and resolution to PatternShape wire dicts."""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from cryptosignal_copilot.candidates import CandidateCatalog, DrawingCandidate, patterns_for_style
from cryptosignal_copilot.drawing_gate import MAX_SHAPES

CANDIDATE_ID_RE = re.compile(
    r"^(tl|zn|dt|db|tri|ch|hs|ihs|fib|bos|choch|fvg|ob|liq|sr)_[a-f0-9]{12}$"
)
MAX_DRAWING_INTENTS = 6
MIN_CONFIDENCE = 0.55
THIRD_TOUCH_CONFIDENCE_CAP = 0.70


class CandidateDrawingIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["candidate"] = "candidate"
    candidate_id: str = Field(min_length=3, max_length=64)

    @field_validator("candidate_id")
    @classmethod
    def _valid_candidate_id(cls, value: str) -> str:
        if not CANDIDATE_ID_RE.match(value):
            raise ValueError(f"candidate_id must match {CANDIDATE_ID_RE.pattern}")
        return value


class PairDrawingIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["pair"] = "pair"
    candidate_ids: list[str] = Field(min_length=2, max_length=2)

    @field_validator("candidate_ids")
    @classmethod
    def _valid_pair_ids(cls, value: list[str]) -> list[str]:
        for cid in value:
            if not CANDIDATE_ID_RE.match(cid):
                raise ValueError(f"candidate_id must match {CANDIDATE_ID_RE.pattern}")
        return value


DrawingIntent = Annotated[
    CandidateDrawingIntent | PairDrawingIntent,
    Field(discriminator="type"),
]


class PickNote(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidate_id: str = Field(min_length=3, max_length=64)
    note: str = Field(default="", max_length=240)

    @field_validator("candidate_id")
    @classmethod
    def _valid_pick_note_id(cls, value: str) -> str:
        if not CANDIDATE_ID_RE.match(value):
            raise ValueError(f"candidate_id must match {CANDIDATE_ID_RE.pattern}")
        return value


class AnalyzeResultLlm(BaseModel):
    """Structured LLM output — references candidates by id; bias text is server-side."""

    model_config = ConfigDict(extra="forbid")

    pick_notes: list[PickNote] = Field(default_factory=list, max_length=MAX_DRAWING_INTENTS)
    drawing_intents: list[DrawingIntent] = Field(
        default_factory=list, max_length=MAX_DRAWING_INTENTS
    )
    markers: list[dict[str, Any]] = Field(default_factory=list)


def touch_count_for_candidate(cand: DrawingCandidate) -> int:
    if cand.swing_ids:
        return len(cand.swing_ids)
    return 2


def confidence_from_score(score: float, touches: int) -> float | None:
    confidence = round(0.40 + 0.55 * score, 2)
    if touches < 3:
        confidence = min(confidence, THIRD_TOUCH_CONFIDENCE_CAP)
    if confidence < MIN_CONFIDENCE:
        return None
    return min(1.0, confidence)


def invalidation_condition(cand: DrawingCandidate, last_close: float) -> str:
    if cand.invalidation_price is None:
        return "close beyond"
    if cand.invalidation_price < last_close:
        return "close_below"
    return "close_above"


def guardrail_for_candidate(
    cand: DrawingCandidate,
    regime: str,
    *,
    last_close: float | None = None,
) -> dict[str, Any] | None:
    from cryptosignal_copilot.chart_response import Guardrail, Invalidation

    touches = touch_count_for_candidate(cand)
    confidence = confidence_from_score(cand.score, touches)
    if confidence is None:
        return None
    condition = "close beyond"
    if cand.invalidation_price is not None and last_close is not None:
        condition = invalidation_condition(cand, last_close)
    inv = (
        Invalidation(price=cand.invalidation_price, condition=condition)
        if cand.invalidation_price is not None
        else None
    )
    g = Guardrail(
        regime=regime,  # type: ignore[arg-type]
        confidence=confidence,
        evidence_against=list(cand.evidence_against),
        invalidation=inv,
    )
    return g.model_dump()


def resolve_drawing_intents(
    intents: Sequence[DrawingIntent],
    catalog: CandidateCatalog,
    *,
    max_intents: int = MAX_DRAWING_INTENTS,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Map intents to shape dicts; return (shapes, unknown_ids). Caps intents, not shapes."""
    by_id = catalog.by_id()
    shapes: list[dict[str, Any]] = []
    unknown: list[str] = []
    for intent in intents[:max_intents]:
        if intent.type == "candidate":
            cand = by_id.get(intent.candidate_id)
            if cand is None:
                unknown.append(intent.candidate_id)
                continue
            for shape in cand.shapes:
                out = dict(shape)
                out["_candidate_id"] = cand.id
                shapes.append(out)
        else:
            missing = False
            for cid in intent.candidate_ids:
                cand = by_id.get(cid)
                if cand is None:
                    unknown.append(cid)
                    missing = True
                    break
            if missing:
                continue
            for cid in intent.candidate_ids:
                cand = by_id[cid]
                for shape in cand.shapes:
                    out = dict(shape)
                    out["_candidate_id"] = cand.id
                    shapes.append(out)
    return shapes, unknown


def enrich_resolved_shapes(
    shapes: list[dict[str, Any]],
    catalog: CandidateCatalog,
    *,
    last_close: float | None = None,
) -> list[dict[str, Any]]:
    """Attach detector-based guardrails using exact candidate ids."""
    from cryptosignal_copilot.chart_response import stable_drawing_id

    regime = catalog.regime
    by_id = catalog.by_id()
    enriched: list[dict[str, Any]] = []
    for shape in shapes:
        cid = str(shape.get("_candidate_id", "") or shape.get("candidate_id", ""))
        match = by_id.get(cid) if cid else None
        out = dict(shape)
        if match is None:
            match = DrawingCandidate(
                id="fallback",
                pattern_id="trendline",
                style="classic",
                score=float(out.get("confidence", 0.55)),
                swing_ids=[],
                shapes=[shape],
                name=str(out.get("name", "")),
            )
        guardrail = guardrail_for_candidate(match, regime, last_close=last_close)
        if guardrail is None:
            continue
        conf = float(guardrail["confidence"])
        out["guardrail"] = guardrail
        out["confidence"] = conf
        stable = stable_drawing_id(
            str(shape.get("id", cid)), fallback_key=cid or str(out.get("name", ""))
        )
        out["id"] = stable
        if cid:
            out["_candidate_id"] = cid
        enriched.append(out)
    return enriched


def total_shape_cost(
    intents: Sequence[DrawingIntent],
    catalog: CandidateCatalog,
) -> tuple[int, list[tuple[str, int]]]:
    by_id = catalog.by_id()
    costs: list[tuple[str, int]] = []
    total = 0
    for intent in intents:
        ids = [intent.candidate_id] if intent.type == "candidate" else list(intent.candidate_ids)
        for cid in ids:
            cand = by_id.get(cid)
            if cand is None:
                continue
            cost = len(cand.shapes)
            costs.append((cid, cost))
            total += cost
    return total, costs


def fit_intents_to_shape_budget(
    catalog: CandidateCatalog,
    style: str,
    *,
    max_shapes: int = MAX_SHAPES,
    max_intents: int = MAX_DRAWING_INTENTS,
) -> list[DrawingIntent]:
    """Pick top-scoring candidates that fit entirely within the preview shape cap."""
    allowed = patterns_for_style(style)
    pool = sorted(
        [c for c in catalog.candidates if c.pattern_id in allowed],
        key=lambda c: c.score,
        reverse=True,
    )
    intents: list[DrawingIntent] = []
    shape_count = 0
    for cand in pool:
        cost = len(cand.shapes)
        if cost <= 0:
            continue
        if shape_count + cost > max_shapes:
            continue
        if len(intents) >= max_intents:
            break
        intents.append(CandidateDrawingIntent(candidate_id=cand.id))
        shape_count += cost
    return intents


def deterministic_top_intents(
    catalog: CandidateCatalog,
    style: str,
    *,
    limit: int = MAX_DRAWING_INTENTS,
) -> list[DrawingIntent]:
    return fit_intents_to_shape_budget(catalog, style, max_intents=limit)


def build_deterministic_fallback(
    catalog: CandidateCatalog,
    style: str,
) -> AnalyzeResultLlm:
    return AnalyzeResultLlm(
        pick_notes=[],
        drawing_intents=deterministic_top_intents(catalog, style),
        markers=[],
    )
