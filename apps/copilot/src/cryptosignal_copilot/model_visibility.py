from __future__ import annotations

import re
from typing import Any

from cryptosignal_copilot.env_parse import parse_csv_env
from cryptosignal_copilot.model_overrides import apply_id_prefix_aliases, match_model_override

# Re-export for availability layer
__all__ = [
    "load_visibility_allowlist",
    "normalize_upstream_model_id",
    "is_media_model_row",
    "is_hidden_model",
    "is_advanced_route",
    "should_keep_despite_media_row",
]

_MEDIA_MODALITIES = frozenset({"image", "video", "audio", "images", "videos"})
_MEDIA_TYPES = frozenset({"image", "video", "audio", "embedding", "moderation"})

_MEDIA_ID_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(^|/)(dall-?e|stable-?diffusion|midjourney|imagen|text-to-image)", re.I),
    re.compile(r"(^|/)veo", re.I),
)


def load_visibility_allowlist() -> tuple[str, ...]:
    explicit = parse_csv_env("COPILOT_MODEL_VISIBILITY_ALLOWLIST")
    if explicit:
        return tuple(explicit)
    legacy = parse_csv_env("COPILOT_MODEL_ALLOWLIST")
    if legacy:
        return tuple(legacy)
    return ()


def normalize_upstream_model_id(model_id: str) -> str:
    return apply_id_prefix_aliases(model_id)


def _row_modality(row: dict[str, Any]) -> str | None:
    for key in ("modality", "type"):
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().lower()
    return None


def is_media_model_row(row: dict[str, Any]) -> bool:
    """Drop image/video/audio models using provider metadata when available."""
    modality = _row_modality(row)
    if modality in _MEDIA_MODALITIES or modality in _MEDIA_TYPES:
        return True
    caps = row.get("capabilities")
    if isinstance(caps, dict):
        for key in ("image", "video", "audio", "image_generation", "video_generation"):
            if caps.get(key) is True:
                return True
        output_modalities = caps.get("output_modalities")
        if isinstance(output_modalities, list):
            if any(str(m).lower() in _MEDIA_MODALITIES for m in output_modalities):
                return True
    architecture = row.get("architecture")
    if isinstance(architecture, dict):
        modality = architecture.get("modality")
        if isinstance(modality, str) and modality.lower() in _MEDIA_MODALITIES:
            return True
    model_id = str(row.get("id") or "")
    lower = model_id.lower()
    for pattern in _MEDIA_ID_PATTERNS:
        if pattern.search(lower):
            return True
    if "image" in lower and "composer" not in lower:
        return True
    return False


def should_keep_despite_media_row(
    model_id: str,
    *,
    default_model_id: str,
) -> bool:
    """Allowlist / overrides win over provider media mislabels (e.g. OmniRoute type=image)."""
    canonical = normalize_upstream_model_id(model_id)
    allowlist = set(load_visibility_allowlist())
    if canonical in allowlist:
        return True
    if canonical == normalize_upstream_model_id(default_model_id):
        return True
    override = match_model_override(canonical)
    return bool(override and override.force_include)


def is_hidden_model(model_id: str) -> bool:
    override = match_model_override(model_id)
    return bool(override and override.hide)


def is_advanced_route(model_id: str, owned_by: str) -> bool:
    override = match_model_override(model_id)
    if override and override.advanced is not None:
        return override.advanced
    if owned_by == "combo":
        return True
    lower = model_id.lower()
    from cryptosignal_copilot.model_overrides import load_advanced_substrings

    return any(part in lower for part in load_advanced_substrings())
