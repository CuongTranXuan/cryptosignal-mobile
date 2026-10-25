"""Strip internal marker fields; keep drawing_id + guardrail (same shape as shapes)."""

from __future__ import annotations

from typing import Any

from cryptosignal_copilot.wire_shape import guardrail_for_wire

WIRE_MARKER_TOP_KEYS = frozenset(
    {
        "id",
        "agentId",
        "symbol",
        "interval",
        "time",
        "side",
        "position",
        "shape",
        "label",
        "confidence",
        "source",
        "drawing_id",
        "guardrail",
    }
)


def marker_for_wire(marker: dict[str, Any]) -> dict[str, Any]:
    out = {key: value for key, value in marker.items() if not str(key).startswith("_")}
    extra = set(out.keys()) - WIRE_MARKER_TOP_KEYS
    if extra:
        raise ValueError(f"non-wire marker keys: {sorted(extra)}")
    guard = out.get("guardrail")
    if isinstance(guard, dict):
        out["guardrail"] = guardrail_for_wire(guard)
    if out.get("agentId") is None:
        out.pop("agentId", None)
    if out.get("label") is None:
        out.pop("label", None)
    if out.get("drawing_id") is None:
        out.pop("drawing_id", None)
    if out.get("guardrail") is None:
        out.pop("guardrail", None)
    return out


def markers_for_wire(markers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [marker_for_wire(m) for m in markers]
