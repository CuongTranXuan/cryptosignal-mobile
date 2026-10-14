from __future__ import annotations

import fnmatch
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from cryptosignal_copilot.env_parse import parse_csv_env

StructuredOutputMode = Literal["prompted", "text_json"]


@dataclass(frozen=True)
class ModelOverride:
    hide: bool = False
    advanced: bool | None = None
    structured_output_mode: StructuredOutputMode | None = None
    supports_reasoning: bool | None = None
    reasoning_efforts: tuple[str, ...] | None = None
    context_window: int | None = None
    max_output_tokens: int | None = None
    request_max_tokens: int | None = None


def load_id_prefix_aliases() -> tuple[tuple[str, str], ...]:
    """Map upstream id prefixes, e.g. `cu/:cursor/` via COPILOT_MODEL_ID_PREFIX_ALIASES."""
    pairs: list[tuple[str, str]] = []
    for entry in parse_csv_env("COPILOT_MODEL_ID_PREFIX_ALIASES"):
        if ":" not in entry:
            continue
        src, dst = entry.split(":", 1)
        if src and dst:
            pairs.append((src, dst))
    raw = _load_overrides_root().get("id_prefix_aliases")
    if isinstance(raw, dict):
        for src, dst in raw.items():
            if isinstance(src, str) and isinstance(dst, str) and src and dst:
                pairs.append((src, dst))
    return tuple(pairs)


def apply_id_prefix_aliases(model_id: str) -> str:
    out = model_id
    for src, dst in load_id_prefix_aliases():
        if out.startswith(src):
            out = dst + out[len(src) :]
    return out


def _load_overrides_root() -> dict[str, Any]:
    path_raw = os.environ.get("COPILOT_MODEL_OVERRIDES_FILE", "").strip()
    if path_raw:
        path = Path(path_raw).expanduser()
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    json_raw = os.environ.get("COPILOT_MODEL_OVERRIDES_JSON", "").strip()
    if json_raw:
        parsed = json.loads(json_raw)
        if isinstance(parsed, dict):
            return parsed
    return {}


def _parse_override(raw: dict[str, Any]) -> ModelOverride:
    efforts = raw.get("reasoning_efforts")
    effort_tuple: tuple[str, ...] | None = None
    if isinstance(efforts, list):
        effort_tuple = tuple(str(e) for e in efforts)
    mode = raw.get("structured_output_mode")
    structured: StructuredOutputMode | None = None
    if mode in ("prompted", "text_json"):
        structured = mode
    return ModelOverride(
        hide=bool(raw.get("hide")),
        advanced=raw.get("advanced") if isinstance(raw.get("advanced"), bool) else None,
        structured_output_mode=structured,
        supports_reasoning=raw.get("supports_reasoning")
        if isinstance(raw.get("supports_reasoning"), bool)
        else None,
        reasoning_efforts=effort_tuple,
        context_window=_coerce_int(raw.get("context_window")),
        max_output_tokens=_coerce_int(raw.get("max_output_tokens")),
        request_max_tokens=_coerce_int(raw.get("request_max_tokens")),
    )


def _coerce_int(value: Any) -> int | None:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


@dataclass(frozen=True)
class _OverrideRule:
    pattern: str
    override: ModelOverride


def load_override_rules() -> tuple[_OverrideRule, ...]:
    root = _load_overrides_root()
    models = root.get("models")
    if not isinstance(models, dict):
        return ()
    rules: list[_OverrideRule] = []
    for pattern, spec in models.items():
        if not isinstance(pattern, str) or not isinstance(spec, dict):
            continue
        rules.append(_OverrideRule(pattern=pattern, override=_parse_override(spec)))
    return tuple(rules)


def match_model_override(model_id: str) -> ModelOverride | None:
    merged = ModelOverride()
    matched = False
    for rule in load_override_rules():
        if not fnmatch.fnmatchcase(model_id, rule.pattern):
            continue
        matched = True
        merged = _merge_overrides(merged, rule.override)
    return merged if matched else None


def _merge_overrides(base: ModelOverride, patch: ModelOverride) -> ModelOverride:
    return ModelOverride(
        hide=patch.hide or base.hide,
        advanced=patch.advanced if patch.advanced is not None else base.advanced,
        structured_output_mode=patch.structured_output_mode or base.structured_output_mode,
        supports_reasoning=patch.supports_reasoning
        if patch.supports_reasoning is not None
        else base.supports_reasoning,
        reasoning_efforts=patch.reasoning_efforts or base.reasoning_efforts,
        context_window=patch.context_window or base.context_window,
        max_output_tokens=patch.max_output_tokens or base.max_output_tokens,
        request_max_tokens=patch.request_max_tokens or base.request_max_tokens,
    )


def load_advanced_substrings() -> tuple[str, ...]:
    explicit = tuple(parse_csv_env("COPILOT_MODEL_ADVANCED_SUBSTRINGS"))
    if explicit:
        return explicit
    root = _load_overrides_root()
    raw = root.get("advanced_substrings")
    if isinstance(raw, list):
        return tuple(str(item) for item in raw if str(item))
    return ("/no-think/", "/auto/", "auto/")
