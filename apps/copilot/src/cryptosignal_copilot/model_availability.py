from __future__ import annotations

import os
from typing import Any

from cryptosignal_copilot.env_parse import parse_csv_env
from cryptosignal_copilot.model_routes import collapse_variant_rows
from cryptosignal_copilot.model_visibility import (
    is_hidden_model,
    is_media_model_row,
    load_visibility_allowlist,
    normalize_upstream_model_id,
)


def load_model_providers() -> tuple[str, ...]:
    return tuple(parse_csv_env("COPILOT_MODEL_PROVIDERS"))


def load_include_combo_models() -> bool:
    raw = os.environ.get("COPILOT_MODEL_INCLUDE_COMBO", "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _normalize_row_id(row: dict[str, Any]) -> dict[str, Any]:
    model_id = str(row.get("id") or "")
    if not model_id:
        return row
    canonical = normalize_upstream_model_id(model_id)
    if canonical == model_id:
        return row
    out = dict(row)
    out["id"] = canonical
    return out


def filter_available_models(
    rows: list[dict[str, Any]],
    *,
    default_model_id: str,
    blocked_ids: frozenset[str] | None = None,
) -> list[dict[str, Any]]:
    """Provider filters, optional visibility allowlist, media filter, variant collapse."""
    providers = set(load_model_providers())
    visibility = set(load_visibility_allowlist())
    visibility.add(normalize_upstream_model_id(default_model_id))
    include_combo = load_include_combo_models()
    blocked = blocked_ids or frozenset()
    filter_by_provider = bool(providers)
    filter_by_visibility = bool(load_visibility_allowlist())

    scoped: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row.get("id"), str):
            continue
        row = _normalize_row_id(row)
        model_id = str(row["id"])
        if model_id in blocked:
            continue
        owned_by = str(row.get("owned_by") or "")
        if owned_by == "combo" or model_id.startswith("combo/"):
            if include_combo:
                scoped.append(row)
            continue
        if is_media_model_row(row):
            continue
        if is_hidden_model(model_id):
            continue
        if filter_by_provider:
            prefix = model_id.split("/", 1)[0] if "/" in model_id else ""
            if owned_by not in providers and prefix not in providers:
                continue
        scoped.append(row)

    collapsed = collapse_variant_rows(scoped)
    if filter_by_visibility:
        collapsed = [row for row in collapsed if row["id"] in visibility]

    out_ids = {row["id"] for row in collapsed}
    default_canonical = normalize_upstream_model_id(default_model_id)
    if default_canonical and default_canonical not in out_ids and default_canonical not in blocked:
        owned = default_canonical.split("/")[0] if "/" in default_canonical else "default"
        collapsed.append({"id": default_canonical, "owned_by": owned})
    return collapsed
