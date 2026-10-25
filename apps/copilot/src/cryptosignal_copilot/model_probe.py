"""Live model probe: only list models the upstream can actually serve right now.

`/models` says what a gateway *knows*; it does not say which accounts are active,
which have quota left, or which routes 404 at call time. Each candidate gets one
minimal chat completion and is classified. Results are cached in-process (TTL),
shared between concurrent callers (single flight) and never contain credentials.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import urlparse

import httpx

from cryptosignal_copilot.config import LlmConfig
from cryptosignal_copilot.env_parse import env_flag
from cryptosignal_copilot.llm_provider import detect_llm_provider, sanitize_chat_completion_body
from cryptosignal_copilot.model_catalog import ModelsCatalog, ModelsSnapshot, NormalizedModel
from cryptosignal_copilot.model_negative_cache import get_model_negative_cache
from cryptosignal_copilot.model_routes import resolve_provider_model_id
from cryptosignal_copilot.model_visibility import (
    load_visibility_allowlist,
    normalize_upstream_model_id,
)

logger = logging.getLogger(__name__)

ProbeStatus = Literal[
    "ok", "auth_error", "quota_or_rate_limited", "not_found", "timeout", "upstream_error"
]
ProbeProvider = Literal["omniroute", "gemini", "openai_compat"]

OMNIROUTE_DEFAULT_PORT = 20128
_PROBE_PROMPT = "Reply OK"
_MESSAGE_MAX_CHARS = 200


@dataclass(frozen=True)
class ProbeSettings:
    ttl_s: float = 600.0
    down_ttl_s: float = 15.0
    timeout_s: float = 10.0
    concurrency: int = 4
    max_tokens: int = 1
    max_models: int = 60
    refresh_min_interval_s: float = 30.0
    enabled: bool = True


def _env_float(name: str, default: float, minimum: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(minimum, float(raw))
    except ValueError:
        return default


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return min(maximum, max(minimum, int(raw)))
    except ValueError:
        return default


def load_probe_settings() -> ProbeSettings:
    return ProbeSettings(
        ttl_s=_env_float("COPILOT_MODEL_PROBE_TTL_S", 600.0, 1.0),
        down_ttl_s=_env_float("COPILOT_MODEL_PROBE_DOWN_TTL_S", 15.0, 1.0),
        timeout_s=_env_float("COPILOT_MODEL_PROBE_TIMEOUT_S", 10.0, 0.5),
        concurrency=_env_int("COPILOT_MODEL_PROBE_CONCURRENCY", 4, 1, 32),
        max_tokens=_env_int("COPILOT_MODEL_PROBE_MAX_TOKENS", 1, 1, 4),
        max_models=_env_int("COPILOT_MODEL_PROBE_MAX_MODELS", 60, 1, 1000),
        refresh_min_interval_s=_env_float("COPILOT_MODEL_PROBE_REFRESH_MIN_INTERVAL_S", 30.0, 0.0),
        enabled=env_flag("COPILOT_MODEL_PROBE_ENABLED", default=True),
    )


# --------------------------------------------------------------------------- redaction

_REDACTED = "[redacted]"
_REDACT_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)\bbearer\s+[^\s\"',;]+"),
    re.compile(r"(?i)\b(x-api-key|x-goog-api-key|api[_-]?key|authorization)\b(\s*[:=]\s*)\S+"),
    re.compile(r"(?i)([?&](?:key|api_key|apikey|token|access_token|sig)=)[^&\s\"']+"),
    re.compile(r"(?i)(://)[^/\s:@]+:[^/\s@]+@"),
    re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_\-]{6,}"),
    re.compile(r"\bAIza[0-9A-Za-z_\-]{20,}"),
    re.compile(r"\b(?:gh[pousr]|xox[abpr])[-_][A-Za-z0-9_\-]{10,}"),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]*"),
    re.compile(r"\b[A-Za-z0-9_\-]{32,}\b"),
)


def redact_secrets(text: str, *, secrets: tuple[str, ...] = ()) -> str:
    out = text
    for secret in secrets:
        if secret and len(secret) >= 4:
            out = out.replace(secret, _REDACTED)
    for pattern in _REDACT_PATTERNS:
        if pattern.groups == 2:
            out = pattern.sub(lambda m: f"{m.group(1)}{m.group(2)}{_REDACTED}", out)
        elif pattern.groups == 1:
            out = pattern.sub(lambda m: f"{m.group(1)}{_REDACTED}", out)
        else:
            out = pattern.sub(_REDACTED, out)
    return out


def sanitize_message(text: str | None, *, secrets: tuple[str, ...] = ()) -> str | None:
    if not text:
        return None
    cleaned = " ".join(redact_secrets(str(text), secrets=secrets).split())
    if len(cleaned) > _MESSAGE_MAX_CHARS:
        cleaned = cleaned[: _MESSAGE_MAX_CHARS - 1] + "…"
    return cleaned or None


# --------------------------------------------------------------------------- classification

_NOT_FOUND_MARKERS = (
    "model_not_found",
    "model not found",
    "not_found",
    "not found",
    "does not exist",
    "unknown model",
    "no such model",
    "invalid model",
    "model is not supported",
    "unsupported model",
    "model_not_supported",
    "no provider",
    "no route",
)
_QUOTA_MARKERS = (
    "insufficient_quota",
    "quota",
    "rate limit",
    "rate_limit",
    "ratelimit",
    "too many requests",
    "resource_exhausted",
    "credits",
    "credit balance",
    "billing",
    "budget",
    "exhausted",
    "all accounts",
    "no available account",
    "cooldown",
)
_AUTH_MARKERS = (
    "invalid_api_key",
    "invalid api key",
    "incorrect api key",
    "unauthorized",
    "unauthenticated",
    "authentication",
    "permission_denied",
    "permission denied",
    "forbidden",
    "no credentials",
    "invalid_token",
    "token expired",
)
_TIMEOUT_MARKERS = ("timeout", "timed out", "deadline_exceeded", "deadline exceeded")
_MAX_TOKENS_PARAM_MARKERS = ("max_tokens", "max_completion_tokens")


def _first_error_obj(body: Any) -> dict[str, Any] | None:
    """OpenAI `{error:{...}}`, Gemini `[{error:{...}}]`, OmniRoute `{error:"..."}`/`{message}`."""
    if isinstance(body, list) and body:
        body = body[0]
    if not isinstance(body, dict):
        return None
    err = body.get("error")
    if isinstance(err, dict):
        return err
    if isinstance(err, str):
        return {"message": err, "code": body.get("code"), "type": body.get("type")}
    if any(k in body for k in ("message", "detail")) and "choices" not in body:
        return {
            "message": body.get("message") or body.get("detail"),
            "code": body.get("code"),
            "type": body.get("type"),
        }
    return None


def _error_code(err: dict[str, Any] | None) -> str | None:
    if not err:
        return None
    for key in ("code", "type", "status"):
        value = err.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:64]
    value = err.get("code")
    if isinstance(value, int):
        return str(value)
    return None


def _error_text(err: dict[str, Any] | None, raw: str) -> str:
    parts: list[str] = []
    if err:
        for key in ("code", "type", "status", "message"):
            value = err.get(key)
            if value is not None:
                parts.append(str(value))
    if not parts and raw:
        parts.append(raw[:500])
    return " ".join(parts).lower()


def _has(text: str, markers: tuple[str, ...]) -> bool:
    return any(m in text for m in markers)


def classify_http_failure(status: int, err: dict[str, Any] | None, raw: str) -> ProbeStatus:
    text = _error_text(err, raw)
    if status in (401, 403):
        return "not_found" if _has(text, _NOT_FOUND_MARKERS) else "auth_error"
    if status in (402, 429):
        return "quota_or_rate_limited"
    if status == 404:
        return "not_found"
    if status in (408, 504):
        return "timeout"
    # 200-with-error, 400/422 and 5xx: the body decides (gateways overload codes).
    if _has(text, _QUOTA_MARKERS):
        return "quota_or_rate_limited"
    if _has(text, _AUTH_MARKERS):
        return "auth_error"
    if _has(text, _NOT_FOUND_MARKERS):
        return "not_found"
    if _has(text, _TIMEOUT_MARKERS):
        return "timeout"
    return "upstream_error"


def detect_probe_provider(cfg: LlmConfig) -> ProbeProvider:
    if detect_llm_provider(cfg) == "gemini":
        return "gemini"
    if os.environ.get("LLM_PROVIDER", "").strip().lower() == "omniroute":
        return "omniroute"
    parsed = urlparse(cfg.base_url)
    if "omniroute" in (parsed.hostname or "").lower() or parsed.port == OMNIROUTE_DEFAULT_PORT:
        return "omniroute"
    return "openai_compat"


# --------------------------------------------------------------------------- report types


@dataclass(frozen=True)
class ProbeResult:
    id: str
    status: ProbeStatus
    latency_ms: int | None
    http_status: int | None = None
    error_code: str | None = None
    message: str | None = None

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "status": self.status,
            "latency_ms": self.latency_ms,
            "http_status": self.http_status,
            "error_code": self.error_code,
            "message": self.message,
        }


@dataclass(frozen=True)
class UpstreamError:
    code: str
    message: str

    def to_api_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


@dataclass(frozen=True)
class ProbeReport:
    probed_at: float
    provider: ProbeProvider
    upstream_error: UpstreamError | None
    results: tuple[ProbeResult, ...]
    requested_default: str
    snapshot: ModelsSnapshot | None = None
    skipped_count: int = 0
    allowlist: tuple[str, ...] = field(default_factory=tuple)

    @property
    def upstream_reachable(self) -> bool:
        return self.upstream_error is None

    def status_of(self, model_id: str) -> ProbeStatus | None:
        for result in self.results:
            if result.id == model_id:
                return result.status
        return None

    def healthy(self) -> list[ProbeResult]:
        """Healthy results in pick order: allowlist order first, then latency."""
        ok = [r for r in self.results if r.status == "ok"]
        rank = {mid: i for i, mid in enumerate(self.allowlist)}
        return sorted(
            ok,
            key=lambda r: (
                rank.get(r.id, len(rank)),
                r.latency_ms if r.latency_ms is not None else math.inf,
                r.id,
            ),
        )

    def effective_default(self) -> tuple[str | None, bool]:
        """`(default_model, default_fallback)`; fallback only when a healthy substitute exists."""
        if self.status_of(self.requested_default) == "ok":
            return self.requested_default, False
        healthy = self.healthy()
        if not healthy:
            return None, False
        return healthy[0].id, True

    def to_api_dict(self, ttl_s: float) -> dict[str, Any]:
        return {
            "probed_at": iso_utc(self.probed_at),
            "ttl_s": int(ttl_s),
            "provider": self.provider,
            "upstream_reachable": self.upstream_reachable,
            "upstream_error": self.upstream_error.to_api_dict() if self.upstream_error else None,
            "skipped_count": self.skipped_count,
            "results": [r.to_api_dict() for r in self.results],
        }


def iso_utc(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=UTC).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class ModelHealth:
    """What the analyze path needs from the last probe (never triggers one)."""

    default_model: str | None
    report: ProbeReport | None

    def unhealthy_status(self, model_id: str) -> ProbeStatus | None:
        if self.report is None:
            return None
        status = self.report.status_of(model_id)
        return status if status not in (None, "ok") else None


class ProbeRateLimited(Exception):
    def __init__(self, retry_after_s: int) -> None:
        self.retry_after_s = retry_after_s
        super().__init__(retry_after_s)


# --------------------------------------------------------------------------- probing


def _upstream_error_from_exception(
    exc: BaseException, *, secrets: tuple[str, ...]
) -> UpstreamError:
    if isinstance(exc, httpx.TimeoutException):
        return UpstreamError("timeout", "Upstream /models timed out")
    if isinstance(exc, httpx.ConnectError):
        return UpstreamError("connect_error", "Upstream unreachable (connection failed)")
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status in (401, 403):
            return UpstreamError("auth_error", f"Upstream /models rejected credentials ({status})")
        if status in (402, 429):
            return UpstreamError("quota_or_rate_limited", f"Upstream /models limited ({status})")
        return UpstreamError("http_error", f"Upstream /models returned HTTP {status}")
    if isinstance(exc, httpx.TransportError):
        return UpstreamError("network_error", f"Upstream network error ({type(exc).__name__})")
    if isinstance(exc, ValueError):
        return UpstreamError("invalid_response", "Upstream /models returned invalid JSON")
    message = sanitize_message(f"{type(exc).__name__}: {exc}", secrets=secrets) or "error"
    return UpstreamError("upstream_error", message)


def order_candidates(
    models: tuple[NormalizedModel, ...], requested_default: str, allowlist: tuple[str, ...]
) -> list[NormalizedModel]:
    by_id = {m.id: m for m in models}
    ordered: list[NormalizedModel] = []
    seen: set[str] = set()
    for mid in (requested_default, *allowlist):
        model = by_id.get(mid)
        if model is not None and mid not in seen:
            ordered.append(model)
            seen.add(mid)
    ordered.extend(m for m in sorted(models, key=lambda m: m.id) if m.id not in seen)
    return ordered


async def probe_one(
    client: httpx.AsyncClient,
    cfg: LlmConfig,
    model: NormalizedModel,
    *,
    max_tokens: int,
    timeout_s: float,
) -> ProbeResult:
    provider_id = detect_llm_provider(cfg)
    api_model = resolve_provider_model_id(model, None, cfg=cfg)
    secrets = (cfg.api_key,)
    body: dict[str, Any] = {
        "model": api_model,
        "messages": [{"role": "user", "content": _PROBE_PROMPT}],
        "max_tokens": max_tokens,
        "stream": False,
    }
    url = f"{cfg.base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {cfg.api_key}"}
    started = time.perf_counter()

    def elapsed() -> int:
        return int((time.perf_counter() - started) * 1000)

    try:
        res = await _post_completion(client, url, headers, body, provider_id, timeout_s)
        err_body: Any = None
        raw = res.text
        try:
            err_body = res.json()
        except ValueError:
            err_body = None
        err = _first_error_obj(err_body)
        if res.status_code == 400 and _has(_error_text(err, raw), _MAX_TOKENS_PARAM_MARKERS):
            # Newer OpenAI reasoning routes reject `max_tokens`; retry once with the new name.
            retry_body = {k: v for k, v in body.items() if k != "max_tokens"}
            retry_body["max_completion_tokens"] = max_tokens
            res = await _post_completion(client, url, headers, retry_body, provider_id, timeout_s)
            raw = res.text
            try:
                err_body = res.json()
            except ValueError:
                err_body = None
            err = _first_error_obj(err_body)
        latency = elapsed()
        if res.status_code == 200 and err is None:
            if isinstance(err_body, dict) and isinstance(err_body.get("choices"), list):
                return ProbeResult(model.id, "ok", latency, 200)
            return ProbeResult(
                model.id,
                "upstream_error",
                latency,
                200,
                "invalid_response",
                "Completion response had no choices",
            )
        status = classify_http_failure(res.status_code, err, raw)
        message = (err or {}).get("message") if err else raw
        return ProbeResult(
            model.id,
            status,
            latency,
            res.status_code,
            _error_code(err),
            sanitize_message(str(message) if message else None, secrets=secrets),
        )
    except httpx.TimeoutException:
        return ProbeResult(model.id, "timeout", elapsed(), None, "timeout", "Probe timed out")
    except httpx.TransportError as exc:
        return ProbeResult(
            model.id,
            "upstream_error",
            elapsed(),
            None,
            "connect_error" if isinstance(exc, httpx.ConnectError) else "network_error",
            sanitize_message(type(exc).__name__, secrets=secrets),
        )


async def _post_completion(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
    provider_id: str,
    timeout_s: float,
) -> httpx.Response:
    payload = sanitize_chat_completion_body(body, provider_id)
    return await client.post(url, headers=headers, json=payload, timeout=timeout_s)


class ModelProbeService:
    """Cached, single-flight, rate-limited live probe of the configured upstream."""

    def __init__(
        self,
        catalog: ModelsCatalog,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        settings_loader: Callable[[], ProbeSettings] = load_probe_settings,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._catalog = catalog
        self._transport = transport
        self._settings_loader = settings_loader
        self._clock = clock
        self._report: ProbeReport | None = None
        self._task: asyncio.Task[ProbeReport] | None = None
        self._last_started: float | None = None
        self.probe_runs = 0

    @property
    def settings(self) -> ProbeSettings:
        return self._settings_loader()

    @property
    def in_progress(self) -> bool:
        return self._task is not None and not self._task.done()

    def cached_report(self) -> ProbeReport | None:
        return self._report

    def is_stale(self, report: ProbeReport | None = None) -> bool:
        report = report or self._report
        if report is None:
            return True
        settings = self.settings
        ttl = (
            settings.ttl_s
            if report.upstream_reachable
            else min(settings.ttl_s, settings.down_ttl_s)
        )
        return self._clock() >= report.probed_at + ttl

    def config_missing_report(self, reason: str) -> ProbeReport:
        """Contract-shaped, uncached report when LLM env is incomplete (names only, no values)."""
        cfg = LlmConfig(
            style="openai",
            base_url=os.environ.get("LLM_BASE_URL", "").strip().rstrip("/"),
            api_key="",
            model=os.environ.get("LLM_MODEL", "").strip(),
            timeout_s=0,
        )
        return ProbeReport(
            probed_at=self._clock(),
            provider=detect_probe_provider(cfg),
            upstream_error=UpstreamError(
                "config_missing", sanitize_message(reason) or "LLM config missing"
            ),
            results=(),
            requested_default=normalize_upstream_model_id(cfg.model) if cfg.model else "",
        )

    def model_health(self) -> ModelHealth:
        report = self._report
        if report is None:
            return ModelHealth(default_model=None, report=None)
        default_model, _ = report.effective_default()
        return ModelHealth(default_model=default_model, report=report)

    def check_refresh_allowed(self) -> None:
        """Raise `ProbeRateLimited` when a forced refresh comes too soon after the last probe."""
        if self.in_progress or self._last_started is None:
            return
        interval = self.settings.refresh_min_interval_s
        remaining = self._last_started + interval - self._clock()
        if remaining > 0:
            raise ProbeRateLimited(max(1, math.ceil(remaining)))

    async def get_report(self, cfg: LlmConfig, *, force: bool = False) -> ProbeReport:
        """Fresh report; stale-while-revalidate when a previous report exists."""
        if force:
            self.check_refresh_allowed()
            return await self._join_or_start(cfg)
        report = self._report
        if report is not None and not self.is_stale(report):
            return report
        if report is not None and report.upstream_reachable:
            self._ensure_started(cfg)
            return report
        return await self._join_or_start(cfg)

    def start_background(self, cfg: LlmConfig) -> None:
        self._ensure_started(cfg)

    def _ensure_started(self, cfg: LlmConfig) -> asyncio.Task[ProbeReport]:
        if self._task is None or self._task.done():
            self._last_started = self._clock()
            self._task = asyncio.create_task(self._run(cfg))
        return self._task

    async def _join_or_start(self, cfg: LlmConfig) -> ProbeReport:
        task = self._ensure_started(cfg)
        return await asyncio.shield(task)

    async def _run(self, cfg: LlmConfig) -> ProbeReport:
        try:
            report = await self.run_probe(cfg)
        except Exception as exc:  # noqa: BLE001 - a probe bug must not take the API down
            logger.warning("model probe crashed: %s", type(exc).__name__)
            report = ProbeReport(
                probed_at=self._clock(),
                provider=detect_probe_provider(cfg),
                upstream_error=UpstreamError("probe_error", "Model probe failed internally"),
                results=(),
                requested_default=normalize_upstream_model_id(cfg.model),
            )
        self._report = report
        return report

    async def run_probe(self, cfg: LlmConfig) -> ProbeReport:
        settings = self.settings
        self.probe_runs += 1
        secrets = (cfg.api_key,)
        provider = detect_probe_provider(cfg)
        requested_default = normalize_upstream_model_id(cfg.model)
        allowlist = tuple(normalize_upstream_model_id(m) for m in load_visibility_allowlist())
        started_at = self._clock()
        try:
            snapshot = await self._catalog.refresh(cfg)
        except Exception as exc:  # noqa: BLE001
            upstream_error = _upstream_error_from_exception(exc, secrets=secrets)
            logger.warning(
                "model probe: upstream /models failed (%s, provider=%s)",
                upstream_error.code,
                provider,
            )
            return ProbeReport(
                probed_at=started_at,
                provider=provider,
                upstream_error=upstream_error,
                results=(),
                requested_default=requested_default,
                allowlist=allowlist,
            )

        candidates = order_candidates(snapshot.models, requested_default, allowlist)
        skipped = max(0, len(candidates) - settings.max_models)
        candidates = candidates[: settings.max_models]
        semaphore = asyncio.Semaphore(settings.concurrency)

        async with httpx.AsyncClient(
            transport=self._transport, timeout=settings.timeout_s
        ) as client:

            async def run(model: NormalizedModel) -> ProbeResult:
                async with semaphore:
                    return await probe_one(
                        client,
                        cfg,
                        model,
                        max_tokens=settings.max_tokens,
                        timeout_s=settings.timeout_s,
                    )

            results = await asyncio.gather(*(run(m) for m in candidates))

        for result in results:
            logger.info(
                "model probe: %s -> %s (http=%s code=%s %sms)",
                result.id,
                result.status,
                result.http_status,
                result.error_code,
                result.latency_ms,
            )
        ok = sum(1 for r in results if r.status == "ok")
        logger.info(
            "model probe done: provider=%s ok=%d/%d skipped=%d", provider, ok, len(results), skipped
        )
        return ProbeReport(
            probed_at=started_at,
            provider=provider,
            upstream_error=None,
            results=tuple(results),
            requested_default=requested_default,
            snapshot=snapshot,
            skipped_count=skipped,
            allowlist=allowlist,
        )

    # ------------------------------------------------------------------ API bodies

    def models_body(self, report: ProbeReport | None, *, q: str | None = None) -> dict[str, Any]:
        settings = self.settings
        requested_default = report.requested_default if report else ""
        models: list[dict[str, Any]] = []
        default_model: str | None = None
        default_fallback = False
        fetched_at: int | None = None
        if report is not None:
            default_model, default_fallback = report.effective_default()
            negative = get_model_negative_cache()
            by_id = report.snapshot.by_id() if report.snapshot else {}
            fetched_at = report.snapshot.fetched_at if report.snapshot else None
            for result in report.healthy():
                info = by_id.get(result.id)
                if info is None or negative.is_blocked(result.id):
                    continue
                row = info.to_api_dict()
                row["latency_ms"] = result.latency_ms
                row["status"] = "ok"
                models.append(row)
        if q and q.strip():
            needle = q.strip().lower()
            models = [
                m for m in models if needle in m["id"].lower() or needle in m["label"].lower()
            ]
        return {
            "default_model": default_model,
            "fetched_at": fetched_at,
            "models": models,
            "requested_default": requested_default,
            "default_fallback": default_fallback,
            "probed_at": iso_utc(report.probed_at) if report else None,
            "ttl_s": int(settings.ttl_s),
            "stale": self.is_stale(report),
            "probe_in_progress": self.in_progress,
            "upstream_reachable": report.upstream_reachable if report else False,
            "upstream_error": (
                report.upstream_error.to_api_dict() if report and report.upstream_error else None
            ),
        }

    def report_body(self, report: ProbeReport) -> dict[str, Any]:
        return report.to_api_dict(self.settings.ttl_s)
