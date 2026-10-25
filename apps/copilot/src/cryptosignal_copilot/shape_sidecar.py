"""Non-wire fields carried alongside PatternShape through schema filter + gate."""

from __future__ import annotations

from typing import Any

SIDECAR_KEYS = ("guardrail", "_candidate_id")


def extract_sidecar(raw: dict[str, Any]) -> dict[str, Any]:
    return {key: raw[key] for key in SIDECAR_KEYS if key in raw}


def attach_sidecar(shape: dict[str, Any], sidecar: dict[str, Any]) -> dict[str, Any]:
    out = dict(shape)
    for key, value in sidecar.items():
        if value is not None:
            out[key] = value
    return out
