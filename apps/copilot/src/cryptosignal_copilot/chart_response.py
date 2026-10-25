from __future__ import annotations

import hashlib
import json
from collections import Counter
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

SkipReasonCode = Literal[
    "low_confidence",
    "out_of_window",
    "invalid_geometry",
    "no_candidate",
    "unsupported_pattern",
    "cap",
]

_GATE_REASON_TO_SKIP: dict[str, SkipReasonCode] = {
    "low-conf": "low_confidence",
    "ancient": "out_of_window",
    "beyond-k": "out_of_window",
    "apex+3": "out_of_window",
    "no-candles": "out_of_window",
    "min-span": "invalid_geometry",
    "near-vertical": "invalid_geometry",
    "non-wick": "invalid_geometry",
    "not-swing": "invalid_geometry",
    "single-touch": "invalid_geometry",
    "triangle-polyline": "invalid_geometry",
    "unpaired-triangle": "invalid_geometry",
    "triangle-structure": "invalid_geometry",
    "fib-no-C": "invalid_geometry",
    "cap": "cap",
}


class Invalidation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    price: float
    condition: str | None = None


class Guardrail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    regime: Literal["trend_up", "trend_down", "range", "volatile"]
    confidence: float = Field(ge=0, le=1)
    evidence_against: list[str] = Field(default_factory=list)
    invalidation: Invalidation | None = None


class IntentCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detected_regime: Literal["trend_up", "trend_down", "range", "volatile"]
    bias_conflict: bool
    message: str | None = None


def stable_drawing_id(*candidate_ids: str, fallback_key: str = "") -> str:
    parts = sorted({part for part in candidate_ids if part})
    if not parts and fallback_key:
        parts = [fallback_key]
    digest = hashlib.sha256("|".join(parts).encode()).hexdigest()
    return f"drw_{digest[:16]}"


def gate_reason_to_skip_code(reason: str) -> SkipReasonCode:
    if reason in _GATE_REASON_TO_SKIP:
        return _GATE_REASON_TO_SKIP[reason]
    if reason.startswith("schema"):
        return "invalid_geometry"
    return "invalid_geometry"


def aggregate_skipped(
    dropped: list[tuple[str, str]],
    *,
    extra: list[SkipReasonCode] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    counter: Counter[SkipReasonCode] = Counter()
    for _shape_id, reason in dropped:
        counter[gate_reason_to_skip_code(reason)] += 1
    if extra:
        counter.update(extra)
    skipped = [{"reason_code": code, "count": count} for code, count in sorted(counter.items())]
    skipped_count = sum(counter.values())
    return skipped, skipped_count


def default_guardrail(
    regime: str,
    confidence: float,
    *,
    evidence_against: list[str] | None = None,
    invalidation_price: float | None = None,
) -> dict[str, Any]:
    g = Guardrail(
        regime=regime,  # type: ignore[arg-type]
        confidence=max(0.0, min(1.0, confidence)),
        evidence_against=evidence_against or [],
        invalidation=Invalidation(price=invalidation_price, condition=None)
        if invalidation_price is not None
        else None,
    )
    return g.model_dump()


def enrich_shapes_with_guardrails(
    shapes: list[dict[str, Any]],
    *,
    regime: str,
    symbol: str,
    interval: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Attach stable ids + guardrail; return drawing-anchor markers for session storage."""
    enriched: list[dict[str, Any]] = []
    anchors: list[dict[str, Any]] = []
    for shape in shapes:
        candidate = str(shape.get("id") or "")
        stable_id = stable_drawing_id(candidate, fallback_key=fingerprint_shape(shape))
        confidence = float(shape.get("confidence", 0.55))
        existing = shape.get("guardrail")
        if isinstance(existing, dict) and (
            existing.get("evidence_against") or existing.get("invalidation")
        ):
            guardrail = existing
            confidence = float(existing.get("confidence", confidence))
        else:
            guardrail = default_guardrail(
                regime,
                confidence,
                evidence_against=[],
                invalidation_price=None,
            )
        out = dict(shape)
        out["id"] = stable_id
        out["guardrail"] = guardrail
        out["confidence"] = confidence
        enriched.append(out)
        points = out.get("points") or []
        time_val = int(points[0]["time"]) if points else 0
        anchors.append(
            {
                "id": f"anchor-{stable_id}",
                "symbol": symbol,
                "interval": interval,
                "time": time_val,
                "side": "neutral",
                "position": "inBar",
                "shape": "circle",
                "label": "Neo",
                "confidence": confidence,
                "source": "agent",
                "drawing_id": stable_id,
                "guardrail": guardrail,
            }
        )
    return enriched, anchors


def fingerprint_shape(shape: dict[str, Any]) -> str:
    payload = {
        "kind": shape.get("kind"),
        "name": shape.get("name"),
        "points": shape.get("points"),
        "priceLow": shape.get("priceLow"),
        "priceHigh": shape.get("priceHigh"),
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))
