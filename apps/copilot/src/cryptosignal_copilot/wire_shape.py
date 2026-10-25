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
    }
)
WIRE_POINT_KEYS = frozenset({"time", "price"})
WIRE_GUARDRAIL_KEYS = frozenset({"regime", "confidence", "evidence_against", "invalidation"})
WIRE_INVALIDATION_KEYS = frozenset({"price", "condition"})


def strip_internal_shape_fields(shape: dict[str, Any]) -> dict[str, Any]:
    """Remove underscore-prefixed keys and other non-wire fields."""
    return {key: value for key, value in shape.items() if not str(key).startswith("_")}


def shape_for_wire(shape: dict[str, Any]) -> dict[str, Any]:
    out = strip_internal_shape_fields(shape)
    _assert_wire_keys(out)
    return out


def shapes_for_wire(shapes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [shape_for_wire(s) for s in shapes]


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
        g_extra = set(guard.keys()) - WIRE_GUARDRAIL_KEYS
        if g_extra:
            raise ValueError(f"non-wire guardrail keys: {sorted(g_extra)}")
        inv = guard.get("invalidation")
        if isinstance(inv, dict):
            i_extra = set(inv.keys()) - WIRE_INVALIDATION_KEYS
            if i_extra:
                raise ValueError(f"non-wire invalidation keys: {sorted(i_extra)}")
