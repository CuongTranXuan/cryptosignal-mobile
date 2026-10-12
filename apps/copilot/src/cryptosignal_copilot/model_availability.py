from __future__ import annotations

import os
from typing import Any


def _parse_csv_env(name: str) -> list[str]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def load_model_allowlist() -> list[str]:
    return _parse_csv_env("COPILOT_MODEL_ALLOWLIST")


def load_model_prefixes(default_model_id: str) -> list[str]:
    explicit = _parse_csv_env("COPILOT_MODEL_PREFIXES")
    if explicit:
        return explicit
    if "/" in default_model_id:
        return [default_model_id.split("/", 1)[0] + "/"]
    return []


def provider_available_signal(row: dict[str, Any]) -> bool | None:
    for key in ("available", "is_available", "active", "enabled", "synced"):
        value = row.get(key)
        if isinstance(value, bool):
            return value
    status = row.get("status")
    if isinstance(status, str):
        lowered = status.lower()
        if lowered in {"active", "available", "connected", "synced", "ready"}:
            return True
        if lowered in {"inactive", "unavailable", "disabled", "error"}:
            return False
    connection = row.get("connection")
    if isinstance(connection, dict):
        for key in ("status", "state"):
            value = connection.get(key)
            if isinstance(value, str):
                lowered = value.lower()
                if lowered in {"active", "connected", "synced", "ready"}:
                    return True
                if lowered in {"inactive", "disconnected", "error"}:
                    return False
    return None


def _matches_prefix(model_id: str, prefixes: list[str]) -> bool:
    return any(model_id.startswith(prefix) for prefix in prefixes)


def filter_available_models(
    rows: list[dict[str, Any]],
    *,
    default_model_id: str,
) -> list[dict[str, Any]]:
    """Shrink provider `/models` to models that are actually callable."""
    by_id = {str(row["id"]): row for row in rows if isinstance(row.get("id"), str)}
    if not by_id:
        return rows

    signals = {provider_available_signal(row) for row in by_id.values()}
    allowlist = load_model_allowlist()
    prefixes = load_model_prefixes(default_model_id)

    if True in signals:
        filtered = [row for row in by_id.values() if provider_available_signal(row) is True]
    elif allowlist:
        allowed = set(allowlist)
        allowed.add(default_model_id)
        filtered = [row for row in by_id.values() if row["id"] in allowed]
    elif prefixes:
        filtered = [row for row in by_id.values() if _matches_prefix(row["id"], prefixes)]
    else:
        filtered = list(by_id.values())

    out_ids = {row["id"] for row in filtered}
    if default_model_id not in out_ids:
        filtered.append(by_id.get(default_model_id, {"id": default_model_id}))
    return filtered
