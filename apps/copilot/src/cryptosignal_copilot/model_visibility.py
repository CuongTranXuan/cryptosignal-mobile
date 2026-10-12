from __future__ import annotations

import os
import re

_DEFAULT_VISIBILITY_ALLOWLIST: tuple[str, ...] = (
    "agentrouter/deepseek-v4-flash",
    "cursor/auto",
    "cursor/auto-balance",
    "cursor/auto-cost",
    "cursor/auto-intelligence",
    "cursor/composer-2.5",
    "cursor/composer-2.5-fast",
)

_MEDIA_ID_RE = re.compile(
    r"(^|/)(veo|flux|dall-?e|stable-?diffusion|midjourney|imagen|image-gen|text-to-image)",
    re.I,
)
_VIDEO_ID_RE = re.compile(r"(^|/)veo", re.I)


def _parse_csv_env(name: str) -> list[str]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def load_visibility_allowlist() -> tuple[str, ...]:
    explicit = _parse_csv_env("COPILOT_MODEL_VISIBILITY_ALLOWLIST")
    if explicit:
        return tuple(explicit)
    legacy = _parse_csv_env("COPILOT_MODEL_ALLOWLIST")
    if legacy:
        return tuple(legacy)
    return _DEFAULT_VISIBILITY_ALLOWLIST


def normalize_upstream_model_id(model_id: str) -> str:
    """Dedupe OmniRoute `cu/` aliases to `cursor/`."""
    if model_id.startswith("cu/"):
        return f"cursor/{model_id[3:]}"
    return model_id


def is_leaked_media_model(model_id: str, owned_by: str) -> bool:
    """Drop image/video models that leak past OmniRoute visibility."""
    if owned_by == "aihorde":
        return True
    lower = model_id.lower()
    if _VIDEO_ID_RE.search(lower):
        return True
    if _MEDIA_ID_RE.search(lower):
        return True
    if "image" in lower and "composer" not in lower:
        return True
    return False


def is_hidden_cursor_legacy(model_id: str) -> bool:
    """Hide `cursor/composer-2` and other pre-2.5 composer ids."""
    canonical = normalize_upstream_model_id(model_id)
    base = canonical.rsplit("/", 1)[-1]
    if base == "composer-2":
        return True
    if base.startswith("composer-2") and not base.startswith("composer-2.5"):
        return True
    return False


def is_no_think_route(model_id: str) -> bool:
    return "/no-think/" in model_id or model_id.startswith("no-think/")


def is_cursor_auto_router(model_id: str) -> bool:
    canonical = normalize_upstream_model_id(model_id)
    name = canonical.split("/", 1)[-1] if "/" in canonical else canonical
    return name == "auto" or name.startswith("auto-")


def is_cursor_provider_model(model_id: str, owned_by: str) -> bool:
    canonical = normalize_upstream_model_id(model_id)
    return owned_by == "cursor" or canonical.startswith("cursor/")
