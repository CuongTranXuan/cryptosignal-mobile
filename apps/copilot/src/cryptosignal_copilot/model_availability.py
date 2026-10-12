from __future__ import annotations

import os
from typing import Any

from cryptosignal_copilot.model_routes import collapse_variant_rows

_DEFAULT_PROVIDERS = ("agentrouter",)


def _parse_csv_env(name: str) -> list[str]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def load_model_providers() -> tuple[str, ...]:
    values = _parse_csv_env("COPILOT_MODEL_PROVIDERS")
    return tuple(values) if values else _DEFAULT_PROVIDERS


def load_model_allowlist() -> list[str]:
    return _parse_csv_env("COPILOT_MODEL_ALLOWLIST")


def load_include_combo_models() -> bool:
    raw = os.environ.get("COPILOT_MODEL_INCLUDE_COMBO", "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def filter_available_models(
    rows: list[dict[str, Any]],
    *,
    default_model_id: str,
) -> list[dict[str, Any]]:
    """OmniRoute safety net: filter by `owned_by`, optional allowlist, collapse variants."""
    providers = set(load_model_providers())
    allowlist = load_model_allowlist()
    include_combo = load_include_combo_models()

    scoped: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row.get("id"), str):
            continue
        owned_by = str(row.get("owned_by") or "")
        if owned_by == "combo":
            if include_combo:
                scoped.append(row)
            continue
        if owned_by not in providers:
            continue
        scoped.append(row)

    collapsed = collapse_variant_rows(scoped)

    if allowlist:
        allowed = set(allowlist)
        allowed.add(default_model_id)
        collapsed = [row for row in collapsed if row["id"] in allowed]

    out_ids = {row["id"] for row in collapsed}
    if default_model_id and default_model_id not in out_ids:
        collapsed.append(
            {
                "id": default_model_id,
                "owned_by": default_model_id.split("/")[0] if "/" in default_model_id else "agentrouter",
            }
        )
    return collapsed
