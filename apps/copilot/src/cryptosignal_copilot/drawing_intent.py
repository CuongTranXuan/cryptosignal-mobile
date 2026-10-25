"""Id-based drawing intents and resolution to PatternShape wire dicts."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from cryptosignal_copilot.candidates import CandidateCatalog, DrawingCandidate


class CandidateDrawingIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["candidate"] = "candidate"
    candidate_id: str


class PairDrawingIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["pair"] = "pair"
    candidate_ids: list[str] = Field(min_length=2, max_length=2)


DrawingIntent = Annotated[
    CandidateDrawingIntent | PairDrawingIntent,
    Field(discriminator="type"),
]


class AnalyzeResultLlm(BaseModel):
    """Structured LLM output — references candidates by id."""

    model_config = ConfigDict(extra="forbid")

    summary: str
    drawing_intents: list[DrawingIntent] = Field(default_factory=list)
    markers: list[dict[str, Any]] = Field(default_factory=list)


def resolve_drawing_intents(
    intents: list[DrawingIntent],
    catalog: CandidateCatalog,
    *,
    max_shapes: int = 6,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Map intents to shape dicts; return (shapes, unknown_ids)."""
    by_id = catalog.by_id()
    shapes: list[dict[str, Any]] = []
    unknown: list[str] = []
    for intent in intents:
        if intent.type == "candidate":
            cand = by_id.get(intent.candidate_id)
            if cand is None:
                unknown.append(intent.candidate_id)
                continue
            shapes.extend(cand.shapes)
        else:
            pair_shapes: list[dict[str, Any]] = []
            missing = False
            for cid in intent.candidate_ids:
                cand = by_id.get(cid)
                if cand is None:
                    unknown.append(cid)
                    missing = True
                    break
                pair_shapes.extend(cand.shapes)
            if not missing:
                shapes.extend(pair_shapes)
        if len(shapes) >= max_shapes:
            shapes = shapes[:max_shapes]
            break
    return shapes, unknown


def guardrail_for_candidate(cand: DrawingCandidate, regime: str) -> dict[str, Any]:
    from cryptosignal_copilot.chart_response import Guardrail, Invalidation

    inv = (
        Invalidation(price=cand.invalidation_price, condition="close beyond")
        if cand.invalidation_price is not None
        else None
    )
    g = Guardrail(
        regime=regime,  # type: ignore[arg-type]
        confidence=max(0.55, min(1.0, cand.score)),
        evidence_against=list(cand.evidence_against),
        invalidation=inv,
    )
    return g.model_dump()


def enrich_resolved_shapes(
    shapes: list[dict[str, Any]],
    catalog: CandidateCatalog,
) -> list[dict[str, Any]]:
    """Attach detector-based guardrails using candidate scores."""
    from cryptosignal_copilot.chart_response import stable_drawing_id

    regime = catalog.regime
    by_pattern: dict[str, DrawingCandidate] = {}
    for cand in catalog.candidates:
        by_pattern.setdefault(cand.pattern_id, cand)
    enriched: list[dict[str, Any]] = []
    for shape in shapes:
        name = str(shape.get("name", "")).lower()
        match = next(
            (c for c in catalog.candidates if c.name.lower() in name or c.pattern_id in name),
            None,
        )
        out = dict(shape)
        conf = float(out.get("confidence", match.score if match else 0.55))
        if match:
            conf = max(conf, match.score)
            out["guardrail"] = guardrail_for_candidate(match, regime)
        else:
            out["guardrail"] = guardrail_for_candidate(
                DrawingCandidate(
                    id="fallback",
                    pattern_id="trendline",
                    style="classic",
                    score=conf,
                    swing_ids=[],
                    shapes=[shape],
                ),
                regime,
            )
        out["confidence"] = conf
        stable = stable_drawing_id(str(shape.get("id", "")), fallback_key=name)
        out["id"] = stable
        enriched.append(out)
    return enriched
