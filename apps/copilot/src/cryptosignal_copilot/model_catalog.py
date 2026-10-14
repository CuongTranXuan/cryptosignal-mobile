from __future__ import annotations

import asyncio
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from cryptosignal_copilot.candle_budget import (
    BINANCE_CANDLE_LIMIT,
    model_candle_limits,
)
from cryptosignal_copilot.config import (
    LlmConfig,
    load_models_cache_ttl_s,
    load_models_fetch_timeout_s,
)
from cryptosignal_copilot.model_availability import filter_available_models
from cryptosignal_copilot.model_negative_cache import get_model_negative_cache
from cryptosignal_copilot.model_overrides import match_model_override
from cryptosignal_copilot.model_visibility import (
    is_advanced_route,
    normalize_upstream_model_id,
)

SourceTier = Literal["provider", "table", "default"]
StructuredOutputMode = Literal["prompted", "text_json"]
FetchModelsFn = Callable[[LlmConfig], Awaitable[list[dict[str, Any]]]]

_TIER_RANK = {"provider": 0, "table": 1, "default": 2}

_TABLE: list[tuple[re.Pattern[str], int, int, bool, list[str] | None]] = [
    (
        re.compile(r"deepseek-v4-(flash|pro)", re.I),
        1_000_000,
        384_000,
        True,
        ["none", "low", "medium", "high", "xhigh", "max"],
    ),
    (re.compile(r"deepseek-r1|deepseek-reasoner", re.I), 128_000, 32_000, True, None),
    (re.compile(r"gpt-4o|gpt-4\.1", re.I), 128_000, 16_384, False, None),
    (re.compile(r"o[134]|gpt-5", re.I), 200_000, 100_000, True, ["low", "medium", "high"]),
    (re.compile(r"claude-", re.I), 200_000, 64_000, True, None),
    (re.compile(r"gemini-2\.5", re.I), 1_000_000, 65_536, True, None),
]

_DEFAULT_CONTEXT = 32_000
_DEFAULT_MAX_OUT = 4_096
_REASONING_CAP = 16_384
_DEEPSEEK_FLASH_REASONING_CAP = 32_768
_NON_REASONING_CAP = 4_096


@dataclass(frozen=True)
class NormalizedModel:
    id: str
    label: str
    provider: str
    context_window: int
    max_output_tokens: int
    supports_reasoning: bool
    reasoning_efforts: tuple[str, ...]
    supports_json: bool
    source: SourceTier
    advanced: bool
    request_max_tokens: int
    recommended_candles: int
    recommended_max_candles: int
    presets: tuple[int, ...]
    effort_routes: tuple[tuple[str, str], ...] = ()
    structured_output_mode: StructuredOutputMode = "prompted"

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "provider": self.provider,
            "context_window": self.context_window,
            "max_output_tokens": self.max_output_tokens,
            "supports_reasoning": self.supports_reasoning,
            "reasoning_efforts": list(self.reasoning_efforts),
            "supports_json": self.supports_json,
            "source": self.source,
            "advanced": self.advanced,
            "request_max_tokens": self.request_max_tokens,
            "recommended_candles": self.recommended_candles,
            "recommended_max_candles": self.recommended_max_candles,
            "presets": list(self.presets),
            "structured_output_mode": self.structured_output_mode,
        }


@dataclass
class _FieldSources:
    context_window: SourceTier = "default"
    max_output_tokens: SourceTier = "default"
    supports_reasoning: SourceTier = "default"
    reasoning_efforts: SourceTier = "default"

    def worst(self) -> SourceTier:
        return max(
            (
                self.context_window,
                self.max_output_tokens,
                self.supports_reasoning,
                self.reasoning_efforts,
            ),
            key=lambda tier: _TIER_RANK[tier],
        )


def _match_table(model_id: str, root: str | None) -> tuple[int, int, bool, list[str] | None] | None:
    for pattern, ctx, out, reasoning, efforts in _TABLE:
        if pattern.search(model_id) or (root and pattern.search(root)):
            return ctx, out, reasoning, efforts
    return None


def _coerce_int(value: Any) -> int | None:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _read_context(raw: dict[str, Any]) -> int | None:
    for key in ("context_length", "max_input_tokens"):
        if key in raw:
            n = _coerce_int(raw[key])
            if n is not None:
                return n
    top = raw.get("top_provider")
    if isinstance(top, dict):
        n = _coerce_int(top.get("context_length"))
        if n is not None:
            return n
    return None


def _read_max_output(raw: dict[str, Any]) -> int | None:
    n = _coerce_int(raw.get("max_output_tokens"))
    if n is not None:
        return n
    top = raw.get("top_provider")
    if isinstance(top, dict):
        return _coerce_int(top.get("max_completion_tokens"))
    return None


def _read_reasoning(raw: dict[str, Any]) -> bool | None:
    caps = raw.get("capabilities")
    if isinstance(caps, dict):
        for key in ("reasoning", "thinking", "supportsThinking"):
            if isinstance(caps.get(key), bool):
                return caps[key]
    if isinstance(raw.get("thinking"), bool):
        return raw["thinking"]
    if isinstance(raw.get("supportsThinking"), bool):
        return raw["supportsThinking"]
    supported = raw.get("supported_parameters")
    if isinstance(supported, list) and "reasoning" in supported:
        return True
    return None


def _read_efforts(raw: dict[str, Any]) -> list[str] | None:
    caps = raw.get("capabilities")
    if isinstance(caps, dict):
        tiers = caps.get("effort_tiers")
        if isinstance(tiers, list):
            return [str(t) for t in tiers]
    return None


def _read_structured_output_mode(raw: dict[str, Any]) -> StructuredOutputMode | None:
    caps = raw.get("capabilities")
    if isinstance(caps, dict):
        for key in ("structured_output_mode", "copilot_structured_output"):
            mode = caps.get(key)
            if mode in ("prompted", "text_json"):
                return mode
    mode = raw.get("structured_output_mode")
    if mode in ("prompted", "text_json"):
        return mode
    return None


def _read_json_support(raw: dict[str, Any]) -> bool | None:
    caps = raw.get("capabilities")
    if isinstance(caps, dict) and isinstance(caps.get("tool_calling"), bool):
        return caps["tool_calling"]
    supported = raw.get("supported_parameters")
    if isinstance(supported, list):
        if any(p in supported for p in ("tools", "response_format", "structured_outputs")):
            return True
    return None


def _request_max_tokens(
    supports_reasoning: bool,
    max_output_tokens: int,
    *,
    model_id: str,
    effort_routes: tuple[tuple[str, str], ...],
) -> int:
    cap = _REASONING_CAP if supports_reasoning else _NON_REASONING_CAP
    if supports_reasoning and re.search(r"deepseek-v4-flash", model_id, re.I):
        cap = _DEEPSEEK_FLASH_REASONING_CAP
    elif supports_reasoning and effort_routes:
        cap = max(cap, 24_576)
    return min(cap, max_output_tokens)


def normalize_model_row(
    raw: dict[str, Any], *, window_bars: int = BINANCE_CANDLE_LIMIT
) -> NormalizedModel:
    raw = dict(raw)
    effort_routes_raw = raw.pop("_effort_routes", None)
    effort_routes: tuple[tuple[str, str], ...] = ()
    if isinstance(effort_routes_raw, dict):
        effort_routes = tuple(sorted((str(k), str(v)) for k, v in effort_routes_raw.items()))

    model_id = normalize_upstream_model_id(str(raw.get("id") or ""))
    raw["id"] = model_id
    root = raw.get("root")
    root_str = str(root) if root else None
    owned_by = str(raw.get("owned_by") or "")
    label = str(raw.get("name") or raw.get("label") or model_id.split("/")[-1])
    provider = owned_by or (model_id.split("/")[0] if "/" in model_id else "unknown")

    sources = _FieldSources()
    ctx = _read_context(raw)
    if ctx is not None:
        sources.context_window = "provider"
    out = _read_max_output(raw)
    if out is not None:
        sources.max_output_tokens = "provider"
    reasoning = _read_reasoning(raw)
    if reasoning is not None:
        sources.supports_reasoning = "provider"
    efforts = _read_efforts(raw)
    if efforts is not None:
        sources.reasoning_efforts = "provider"
    json_support = _read_json_support(raw)
    if json_support is not None:
        pass

    table = _match_table(model_id, root_str)
    if ctx is None:
        if table is not None:
            ctx = table[0]
            sources.context_window = "table"
        else:
            ctx = _DEFAULT_CONTEXT
            sources.context_window = "default"
    if out is None:
        if table is not None:
            out = table[1]
            sources.max_output_tokens = "table"
        else:
            out = _DEFAULT_MAX_OUT
            sources.max_output_tokens = "default"
    if reasoning is None:
        if table is not None:
            reasoning = table[2]
            sources.supports_reasoning = "table"
        else:
            reasoning = True
            sources.supports_reasoning = "default"
    if efforts is None:
        if table is not None and table[3] is not None:
            efforts = list(table[3])
            sources.reasoning_efforts = "table"
        else:
            efforts = []
            sources.reasoning_efforts = "default"

    if json_support is None:
        json_support = True

    structured_mode = _read_structured_output_mode(raw) or "prompted"

    override = match_model_override(model_id)
    if override:
        if override.supports_reasoning is not None:
            reasoning = override.supports_reasoning
            sources.supports_reasoning = "provider"
        if override.reasoning_efforts is not None:
            efforts = list(override.reasoning_efforts)
            sources.reasoning_efforts = "provider"
        if override.structured_output_mode is not None:
            structured_mode = override.structured_output_mode
        if override.context_window is not None:
            ctx = override.context_window
            sources.context_window = "provider"
        if override.max_output_tokens is not None:
            out = override.max_output_tokens
            sources.max_output_tokens = "provider"

    if override and override.request_max_tokens is not None:
        request_max = override.request_max_tokens
    elif structured_mode == "text_json":
        request_max = min(out, max(out, _NON_REASONING_CAP))
    else:
        request_max = _request_max_tokens(
            reasoning,
            out,
            model_id=model_id,
            effort_routes=effort_routes,
        )
    rec, rec_max, presets = model_candle_limits(
        ctx,
        request_max,
        window_bars=window_bars,
    )
    if not presets:
        rec, rec_max, presets = 50, 50, [50]

    return NormalizedModel(
        id=model_id,
        label=label,
        provider=provider,
        context_window=ctx,
        max_output_tokens=out,
        supports_reasoning=reasoning,
        reasoning_efforts=tuple(efforts),
        supports_json=json_support,
        source=sources.worst(),
        advanced=is_advanced_route(model_id, owned_by),
        request_max_tokens=request_max,
        recommended_candles=rec,
        recommended_max_candles=rec_max,
        presets=tuple(presets),
        effort_routes=effort_routes,
        structured_output_mode=structured_mode,
    )


class ModelNotFoundError(Exception):
    def __init__(self, model_id: str) -> None:
        self.model_id = model_id
        super().__init__(model_id)


@dataclass(frozen=True)
class ModelsSnapshot:
    default_model: str
    models: tuple[NormalizedModel, ...]
    fetched_at: int
    expires_at: float
    cache_ttl_s: float

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "default_model": self.default_model,
            "fetched_at": self.fetched_at,
            "models": [m.to_api_dict() for m in self.models],
        }

    def by_id(self) -> dict[str, NormalizedModel]:
        return {m.id: m for m in self.models}


async def default_fetch_models(cfg: LlmConfig) -> list[dict[str, Any]]:
    url = f"{cfg.base_url}/models"
    headers = {"Authorization": f"Bearer {cfg.api_key}"}
    timeout = load_models_fetch_timeout_s()
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.get(url, headers=headers)
        res.raise_for_status()
        body = res.json()
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict) and isinstance(item.get("id"), str)]


def snapshot_from_rows(
    cfg: LlmConfig, rows: list[dict[str, Any]], *, fetched_at: float, ttl_s: float
) -> ModelsSnapshot:
    negative = get_model_negative_cache()
    blocked = frozenset(
        normalize_upstream_model_id(str(row["id"]))
        for row in rows
        if isinstance(row.get("id"), str)
        and negative.is_blocked(normalize_upstream_model_id(str(row["id"])))
    )
    filtered = filter_available_models(
        rows,
        default_model_id=cfg.model,
        blocked_ids=blocked,
    )
    by_id: dict[str, dict[str, Any]] = {row["id"]: row for row in filtered}
    default_id = normalize_upstream_model_id(cfg.model)
    if default_id and default_id not in by_id:
        by_id[default_id] = {
            "id": default_id,
            "owned_by": default_id.split("/")[0] if "/" in default_id else "default",
        }
    models = tuple(
        sorted(
            (
                m
                for m in (normalize_model_row(raw) for raw in by_id.values())
                if not negative.is_blocked(m.id)
            ),
            key=lambda m: m.id,
        )
    )
    return ModelsSnapshot(
        default_model=cfg.model,
        models=models,
        fetched_at=int(fetched_at),
        expires_at=fetched_at + ttl_s,
        cache_ttl_s=ttl_s,
    )


class ModelsCatalog:
    def __init__(self, fetch_models: FetchModelsFn | None = None) -> None:
        self._fetch_models = fetch_models or default_fetch_models
        self._lock = asyncio.Lock()
        self._snapshot: ModelsSnapshot | None = None
        self._last_error: bool = False

    def clear_cache(self) -> None:
        self._snapshot = None
        self._last_error = False

    @property
    def has_stale_cache(self) -> bool:
        return self._snapshot is not None

    def stale_snapshot(self) -> ModelsSnapshot | None:
        return self._snapshot

    async def get_snapshot(self, cfg: LlmConfig) -> ModelsSnapshot:
        ttl_s = load_models_cache_ttl_s()
        now = time.time()
        cached = self._snapshot
        if cached is not None and now < cached.expires_at:
            return cached
        async with self._lock:
            cached = self._snapshot
            now = time.time()
            if cached is not None and now < cached.expires_at:
                return cached
            try:
                rows = await self._fetch_models(cfg)
                snap = snapshot_from_rows(cfg, rows, fetched_at=now, ttl_s=ttl_s)
                self._snapshot = snap
                self._last_error = False
                return snap
            except Exception:
                self._last_error = True
                if self._snapshot is not None:
                    return self._snapshot
                raise

    async def resolve_model(self, cfg: LlmConfig, model_id: str) -> NormalizedModel:
        snap = await self.get_snapshot(cfg)
        info = snap.by_id().get(model_id)
        if info is None:
            raise ModelNotFoundError(model_id)
        return info


_default_catalog = ModelsCatalog()


def get_models_catalog() -> ModelsCatalog:
    return _default_catalog
