"""Strip internal fields before PatternShape hits the web client (strict Zod)."""

from __future__ import annotations

from typing import Any

# Mirrors apps/web/lib/pattern-shape.ts PatternShapeSchema (+ nested point/guardrail keys).
WIRE_SHAPE_TOP_KEYS = frozenset(
    {
        "id",
        "agentId",
        "symbol",
        "interval",
        "kind",
        "name",
        "status",
        "source",
        "confidence",
        "points",
        "priceLow",
        "priceHigh",
        "guardrail",
        # Chart-history flags (docs/CHART_HISTORY_SPEC.md); pinned = user || kept || edited.
        "origin",
        "kept",
        "edited",
        "drawing_id",
    }
)
WIRE_POINT_KEYS = frozenset({"time", "price"})
WIRE_GUARDRAIL_KEYS = frozenset(
    {"regime", "confidence", "evidence_against", "evidence_against_items", "invalidation"}
)
WIRE_INVALIDATION_KEYS = frozenset({"price", "condition", "code", "params", "text"})


def strip_internal_shape_fields(shape: dict[str, Any]) -> dict[str, Any]:
    """Remove underscore-prefixed keys and other non-wire fields."""
    return {key: value for key, value in shape.items() if not str(key).startswith("_")}


def guardrail_for_wire(guard: dict[str, Any]) -> dict[str, Any]:
    g_extra = set(guard.keys()) - WIRE_GUARDRAIL_KEYS
    if g_extra:
        raise ValueError(f"non-wire guardrail keys: {sorted(g_extra)}")
    inv = guard.get("invalidation")
    if isinstance(inv, dict):
        i_extra = set(inv.keys()) - WIRE_INVALIDATION_KEYS
        if i_extra:
            raise ValueError(f"non-wire invalidation keys: {sorted(i_extra)}")
    return guard


def shape_for_wire(shape: dict[str, Any]) -> dict[str, Any]:
    out = strip_internal_shape_fields(shape)
    guard = out.get("guardrail")
    if isinstance(guard, dict):
        out["guardrail"] = guardrail_for_wire(guard)
    _assert_wire_keys(out)
    return out


def shapes_for_wire(shapes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [shape_for_wire(s) for s in shapes]


def ai_shape_flags(shape: dict[str, Any]) -> dict[str, Any]:
    """A freshly analyzed shape: AI-made, not kept, not edited."""
    return {**shape, "origin": "ai", "kept": False, "edited": False}


def _assert_wire_keys(shape: dict[str, Any]) -> None:
    extra = set(shape.keys()) - WIRE_SHAPE_TOP_KEYS
    if extra:
        raise ValueError(f"non-wire shape keys: {sorted(extra)}")
    points = shape.get("points")
    if isinstance(points, list):
        for point in points:
            if isinstance(point, dict):
                pt_extra = set(point.keys()) - WIRE_POINT_KEYS
                if pt_extra:
                    raise ValueError(f"non-wire point keys: {sorted(pt_extra)}")
    guard = shape.get("guardrail")
    if isinstance(guard, dict):
        guardrail_for_wire(guard)
