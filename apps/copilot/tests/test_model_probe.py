"""Live model probe: classification, cache, single flight, rate limit, fallback, redaction."""

from __future__ import annotations

import asyncio
import json
import logging
from functools import partial
from typing import Any

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from cryptosignal_copilot.analyze_prep import AnalyzePrepError, prepare_analyze
from cryptosignal_copilot.config import LlmConfig, load_llm_config
from cryptosignal_copilot.model_catalog import ModelsCatalog, default_fetch_models
from cryptosignal_copilot.model_probe import (
    ModelProbeService,
    ProbeRateLimited,
    ProbeSettings,
    detect_probe_provider,
    redact_secrets,
    sanitize_message,
)
from cryptosignal_copilot.schema import AnalyzeRequest
from tests.probe_fixtures import completion_ok, stub_transport
from tests.test_app import ANALYZE, FakeRunner

SECRET = "sk-live-SECRETKEY1234567890abcdef"

ALLOWLIST = ["m/fast", "m/slow", "m/auth", "m/quota", "m/missing", "m/timeout", "m/broken"]
ROWS = [{"id": mid, "owned_by": "m"} for mid in ALLOWLIST]


class Clock:
    def __init__(self, now: float = 1_800_000_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


def _err(status: int, message: str, code: Any = None, type_: str | None = None) -> httpx.Response:
    err: dict[str, Any] = {"message": message}
    if code is not None:
        err["code"] = code
    if type_ is not None:
        err["type"] = type_
    return httpx.Response(status, json={"error": err})


def mixed_chat(model: str, _body: dict[str, Any]) -> httpx.Response:
    if model == "m/fast":
        return completion_ok(model)
    if model == "m/slow":
        return completion_ok(model)
    if model == "m/auth":
        return _err(401, f"Invalid API key: {SECRET}", "invalid_api_key")
    if model == "m/quota":
        return _err(429, "Rate limit reached", "rate_limit_exceeded")
    if model == "m/missing":
        return _err(404, "The model `m/missing` does not exist", "model_not_found")
    if model == "m/timeout":
        raise httpx.ReadTimeout("read timed out")
    return _err(500, "Internal error", "internal_error")


@pytest.fixture
def probe_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_API_STYLE", "openai")
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:20128/v1")
    monkeypatch.setenv("LLM_API_KEY", SECRET)
    monkeypatch.setenv("LLM_MODEL", "m/auth")
    monkeypatch.setenv("COPILOT_MODEL_VISIBILITY_ALLOWLIST", ",".join(ALLOWLIST))
    monkeypatch.setenv("COPILOT_SKIP_HTF", "1")


def make_service(
    transport: httpx.MockTransport,
    *,
    clock: Clock | None = None,
    settings: ProbeSettings | None = None,
) -> ModelProbeService:
    catalog = ModelsCatalog(fetch_models=partial(default_fetch_models, transport=transport))
    use = settings or ProbeSettings(refresh_min_interval_s=30.0)
    return ModelProbeService(
        catalog,
        transport=transport,
        settings_loader=lambda: use,
        clock=clock or Clock(),
    )


def make_app(service: ModelProbeService, tmp_path, monkeypatch):
    from cryptosignal_copilot.app import create_app
    from cryptosignal_copilot.config import sqlite_url_for_path
    from cryptosignal_copilot.sessions_store import reset_sessions_store_for_tests

    monkeypatch.setenv("DATABASE_URL", sqlite_url_for_path(tmp_path / "s.sqlite3"))
    store = reset_sessions_store_for_tests(tmp_path / "s.sqlite3")
    return create_app(
        runner=FakeRunner(),
        models_catalog=service._catalog,
        sessions_store=store,
        model_probe=service,
    )


# --------------------------------------------------------------------------- classification


@pytest.mark.parametrize(
    ("response", "status", "error_code"),
    [
        (lambda m: completion_ok(m), "ok", None),
        (lambda m: _err(401, "bad key", "invalid_api_key"), "auth_error", "invalid_api_key"),
        (lambda m: _err(403, "forbidden"), "auth_error", None),
        (lambda m: _err(402, "Insufficient credits"), "quota_or_rate_limited", None),
        (
            lambda m: _err(429, "slow down", "rate_limit_exceeded"),
            "quota_or_rate_limited",
            "rate_limit_exceeded",
        ),
        (lambda m: _err(404, "nope"), "not_found", None),
        (lambda m: _err(400, "Model not found", "model_not_found"), "not_found", "model_not_found"),
        (
            lambda m: _err(400, "x", type_="insufficient_quota"),
            "quota_or_rate_limited",
            "insufficient_quota",
        ),
        (
            lambda m: _err(503, "All accounts rate limited, retry later"),
            "quota_or_rate_limited",
            None,
        ),
        (lambda m: _err(503, "No credentials for provider cursor"), "auth_error", None),
        (lambda m: _err(500, "boom", "internal_error"), "upstream_error", "internal_error"),
        (lambda m: _err(502, "upstream connect error"), "upstream_error", None),
        (lambda m: _err(504, "gateway"), "timeout", None),
        (lambda m: _err(408, "request timeout"), "timeout", None),
        # OmniRoute variants: flat string error / 200-with-error.
        (lambda m: httpx.Response(400, json={"error": "Unknown model: m/x"}), "not_found", None),
        (
            lambda m: httpx.Response(200, json={"error": {"message": "quota exhausted"}}),
            "quota_or_rate_limited",
            None,
        ),
        # Gemini list-wrapped error body.
        (
            lambda m: httpx.Response(
                429, json=[{"error": {"code": 429, "message": "x", "status": "RESOURCE_EXHAUSTED"}}]
            ),
            "quota_or_rate_limited",
            "RESOURCE_EXHAUSTED",
        ),
        (lambda m: httpx.Response(200, json={"object": "x"}), "upstream_error", "invalid_response"),
        (lambda m: httpx.Response(500, text="<html>oops</html>"), "upstream_error", None),
    ],
)
async def test_probe_classification(probe_env, response, status, error_code):
    service = make_service(stub_transport(models=[ROWS[0]], chat=lambda m, b: response(m)))
    service_cfg = load_llm_config()
    report = await service.run_probe(service_cfg)
    result = {r.id: r for r in report.results}["m/fast"]
    assert result.status == status
    assert result.error_code == error_code
    assert result.latency_ms is not None and result.latency_ms >= 0


async def test_probe_exceptions_and_full_matrix(probe_env):
    service = make_service(stub_transport(models=ROWS, chat=mixed_chat))
    report = await service.run_probe(load_llm_config())
    statuses = {r.id: r.status for r in report.results}
    assert statuses == {
        "m/fast": "ok",
        "m/slow": "ok",
        "m/auth": "auth_error",
        "m/quota": "quota_or_rate_limited",
        "m/missing": "not_found",
        "m/timeout": "timeout",
        "m/broken": "upstream_error",
    }
    by_id = {r.id: r for r in report.results}
    assert by_id["m/auth"].http_status == 401
    assert by_id["m/timeout"].http_status is None
    assert by_id["m/timeout"].error_code == "timeout"


async def test_probe_connect_error_per_model(probe_env):
    def chat(model, body):
        raise httpx.ConnectError("refused")

    service = make_service(stub_transport(models=[ROWS[0]], chat=chat))
    report = await service.run_probe(load_llm_config())
    result = {r.id: r for r in report.results}["m/fast"]
    assert result.status == "upstream_error"
    assert result.error_code == "connect_error"


async def test_probe_request_is_minimal_and_retries_max_completion_tokens(probe_env):
    seen: list[dict[str, Any]] = []

    def chat(model, body):
        seen.append(body)
        if "max_tokens" in body:
            return _err(400, "Unsupported parameter: 'max_tokens'", "unsupported_parameter")
        return completion_ok(model)

    service = make_service(stub_transport(models=[ROWS[0]], chat=chat))
    report = await service.run_probe(load_llm_config())
    assert report.results[0].status == "ok"
    assert seen[0]["max_tokens"] == 1
    assert seen[0]["stream"] is False
    assert len(seen[0]["messages"]) == 1
    assert seen[1]["max_completion_tokens"] == 1
    assert "max_tokens" not in seen[1]


async def test_probe_bounded_concurrency(probe_env, monkeypatch):
    monkeypatch.delenv("COPILOT_MODEL_VISIBILITY_ALLOWLIST")
    active = 0
    peak = 0
    rows = [{"id": f"m/c{i}", "owned_by": "m"} for i in range(12)]

    class SlowTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            nonlocal active, peak
            if request.method == "GET":
                return httpx.Response(200, json={"data": rows})
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.01)
            active -= 1
            return completion_ok("x")

    transport = SlowTransport()
    catalog = ModelsCatalog(fetch_models=partial(default_fetch_models, transport=transport))
    settings = ProbeSettings(concurrency=3)
    service = ModelProbeService(catalog, transport=transport, settings_loader=lambda: settings)
    report = await service.run_probe(load_llm_config())
    assert sum(r.status == "ok" for r in report.results) >= 12
    assert peak <= 3


async def test_probe_max_models_cap_keeps_default_first(probe_env, monkeypatch):
    monkeypatch.delenv("COPILOT_MODEL_VISIBILITY_ALLOWLIST")
    monkeypatch.setenv("LLM_MODEL", "m/z-default")
    rows = [{"id": f"m/a{i:02d}", "owned_by": "m"} for i in range(10)]
    rows.append({"id": "m/z-default", "owned_by": "m"})
    service = make_service(stub_transport(models=rows), settings=ProbeSettings(max_models=4))
    report = await service.run_probe(load_llm_config())
    assert [r.id for r in report.results][0] == "m/z-default"
    assert len(report.results) == 4
    assert report.skipped_count == 7


async def test_gemini_path_uses_bare_ids_and_strips_params(monkeypatch):
    monkeypatch.setenv("LLM_API_STYLE", "openai")
    monkeypatch.setenv("LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")
    monkeypatch.setenv("LLM_API_KEY", "AIzaSyTESTKEY000000000000000000000000")
    monkeypatch.setenv("LLM_MODEL", "gemini-2.5-flash")
    seen: list[str] = []

    def chat(model, body):
        seen.append(model)
        return completion_ok(model)

    rows = [{"id": "models/gemini-2.5-flash"}, {"id": "models/gemini-2.5-pro"}]
    service = make_service(stub_transport(models=rows, chat=chat))
    cfg = load_llm_config()
    assert detect_probe_provider(cfg) == "gemini"
    report = await service.run_probe(cfg)
    assert sorted(seen) == ["gemini-2.5-flash", "gemini-2.5-pro"]
    assert report.provider == "gemini"
    assert {r.id for r in report.results} == {"gemini-2.5-flash", "gemini-2.5-pro"}


def test_provider_detection(monkeypatch):
    def cfg(url: str) -> LlmConfig:
        return LlmConfig(style="openai", base_url=url, api_key="k", model="m", timeout_s=1)

    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert detect_probe_provider(cfg("http://127.0.0.1:20128/v1")) == "omniroute"
    assert detect_probe_provider(cfg("https://omniroute.example.com/v1")) == "omniroute"
    assert detect_probe_provider(cfg("https://api.openai.com/v1")) == "openai_compat"
    monkeypatch.setenv("LLM_PROVIDER", "omniroute")
    assert detect_probe_provider(cfg("https://gw.internal/v1")) == "omniroute"


# --------------------------------------------------------------------------- cache / single flight


async def test_ttl_cache_and_stale_while_revalidate(probe_env):
    calls: dict[str, int] = {}
    clock = Clock()
    service = make_service(stub_transport(models=ROWS, chat=mixed_chat, calls=calls), clock=clock)
    cfg = load_llm_config()
    first = await service.get_report(cfg)
    second = await service.get_report(cfg)
    assert first is second
    assert service.probe_runs == 1
    assert calls["models"] == 1

    clock.now += 601
    stale = await service.get_report(cfg)
    assert stale is first  # served immediately, refresh runs in the background
    assert service.in_progress
    body = service.models_body(stale)
    assert body["stale"] is True
    assert body["probe_in_progress"] is True
    await service._task  # type: ignore[misc]
    assert service.probe_runs == 2
    assert service.cached_report() is not first
    assert service.models_body(service.cached_report())["stale"] is False


async def test_single_flight_concurrent_callers(probe_env):
    calls: dict[str, int] = {}
    gate = asyncio.Event()

    class GatedTransport(httpx.AsyncBaseTransport):
        def __init__(self) -> None:
            self.inner = stub_transport(models=ROWS, calls=calls)

        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            if request.method == "GET":
                await gate.wait()
            return await self.inner.handle_async_request(request)

    transport = GatedTransport()
    catalog = ModelsCatalog(fetch_models=partial(default_fetch_models, transport=transport))
    service = ModelProbeService(catalog, transport=transport, settings_loader=ProbeSettings)
    cfg = load_llm_config()
    waiters = [asyncio.create_task(service.get_report(cfg)) for _ in range(5)]
    await asyncio.sleep(0)
    forced = asyncio.create_task(service.get_report(cfg, force=True))
    await asyncio.sleep(0.01)
    gate.set()
    reports = await asyncio.gather(*waiters, forced)
    assert all(r is reports[0] for r in reports)
    assert service.probe_runs == 1
    assert calls["models"] == 1
    assert calls["chat"] == len(ROWS)


async def test_cancelled_caller_does_not_cancel_shared_probe(probe_env):
    gate = asyncio.Event()

    class GatedTransport(httpx.AsyncBaseTransport):
        inner = stub_transport(models=ROWS)

        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            await gate.wait()
            return await self.inner.handle_async_request(request)

    transport = GatedTransport()
    catalog = ModelsCatalog(fetch_models=partial(default_fetch_models, transport=transport))
    service = ModelProbeService(catalog, transport=transport, settings_loader=ProbeSettings)
    cfg = load_llm_config()
    caller = asyncio.create_task(service.get_report(cfg))
    await asyncio.sleep(0.01)
    caller.cancel()
    gate.set()
    report = await service._task  # type: ignore[misc]
    assert report.upstream_reachable


# --------------------------------------------------------------------------- rate limit


async def test_refresh_rate_limit_and_retry_after(probe_env, tmp_path, monkeypatch):
    clock = Clock()
    service = make_service(stub_transport(models=ROWS, chat=mixed_chat), clock=clock)
    app = make_app(service, tmp_path, monkeypatch)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        first = await client.post("/v1/copilot/models/probe")
        clock.now += 10
        limited = await client.post("/v1/copilot/models/probe")
        limited_get = await client.get("/v1/copilot/models?refresh=1")
        cached = await client.get("/v1/copilot/models/probe")
        clock.now += 21
        again = await client.post("/v1/copilot/models/probe")
    assert first.status_code == 200
    assert limited.status_code == 429
    assert limited.headers["Retry-After"] == "20"
    assert limited.json()["retry_after_s"] == 20
    assert limited.json()["code"] == "probe_rate_limited"
    assert limited_get.status_code == 429
    assert cached.status_code == 200
    assert again.status_code == 200
    assert service.probe_runs == 2


async def test_refresh_joins_in_flight_probe_instead_of_429(probe_env):
    gate = asyncio.Event()

    class GatedTransport(httpx.AsyncBaseTransport):
        inner = stub_transport(models=ROWS)

        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            await gate.wait()
            return await self.inner.handle_async_request(request)

    transport = GatedTransport()
    catalog = ModelsCatalog(fetch_models=partial(default_fetch_models, transport=transport))
    service = ModelProbeService(
        catalog,
        transport=transport,
        settings_loader=lambda: ProbeSettings(refresh_min_interval_s=300),
    )
    cfg = load_llm_config()
    one = asyncio.create_task(service.get_report(cfg, force=True))
    await asyncio.sleep(0.01)
    two = asyncio.create_task(service.get_report(cfg, force=True))
    await asyncio.sleep(0.01)
    gate.set()
    a, b = await asyncio.gather(one, two)
    assert a is b
    with pytest.raises(ProbeRateLimited) as exc:
        await service.get_report(cfg, force=True)
    assert 299 <= exc.value.retry_after_s <= 300


# --------------------------------------------------------------------------- default fallback


async def test_default_fallback_listing_and_analyze(probe_env, tmp_path, monkeypatch):
    # Configured default m/auth fails; allowlist order puts m/fast first.
    service = make_service(stub_transport(models=ROWS, chat=mixed_chat))
    app = make_app(service, tmp_path, monkeypatch)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/v1/copilot/models")
        body = res.json()
        assert res.status_code == 200
        assert [m["id"] for m in body["models"]] == ["m/fast", "m/slow"]
        assert all(m["status"] == "ok" for m in body["models"])
        assert body["default_model"] == "m/fast"
        assert body["requested_default"] == "m/auth"
        assert body["default_fallback"] is True
        assert body["upstream_reachable"] is True

        unhealthy = await client.post("/v1/copilot/analyze", json={**ANALYZE, "model": "m/quota"})
        assert unhealthy.status_code == 422
        assert unhealthy.json()["code"] == "model_unavailable"
        assert "quota_or_rate_limited" in unhealthy.json()["detail"]

        ok = await client.post("/v1/copilot/analyze", json=ANALYZE)
        assert ok.status_code == 200
        meta_line = next(
            line for line in ok.text.splitlines() if line.startswith("data:") and '"model"' in line
        )
        assert json.loads(meta_line[5:])["model"] == "m/fast"


async def test_default_fallback_uses_latency_when_no_allowlist(probe_env, monkeypatch):
    monkeypatch.delenv("COPILOT_MODEL_VISIBILITY_ALLOWLIST")
    service = make_service(stub_transport(models=ROWS, chat=mixed_chat))
    report = await service.run_probe(load_llm_config())
    from dataclasses import replace

    results = tuple(
        replace(r, latency_ms={"m/fast": 50, "m/slow": 5}.get(r.id, r.latency_ms))
        for r in report.results
    )
    report = replace(report, results=results)
    assert report.effective_default() == ("m/slow", True)


async def test_prepare_analyze_uses_effective_default(probe_env):
    service = make_service(stub_transport(models=ROWS, chat=mixed_chat))
    cfg = load_llm_config()
    await service.get_report(cfg)
    req = AnalyzeRequest.model_validate(ANALYZE)
    plan = await prepare_analyze(service._catalog, cfg, req, model_health=service.model_health())
    assert plan.model_id == "m/fast"
    with pytest.raises(AnalyzePrepError) as exc:
        await prepare_analyze(
            service._catalog,
            cfg,
            req.model_copy(update={"model": "m/missing"}),
            model_health=service.model_health(),
        )
    assert exc.value.status_code == 422


async def test_healthy_default_is_kept(probe_env, monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "m/slow")
    service = make_service(stub_transport(models=ROWS, chat=mixed_chat))
    report = await service.get_report(load_llm_config())
    body = service.models_body(report)
    assert body["default_model"] == "m/slow"
    assert body["default_fallback"] is False


async def test_no_healthy_model_gives_null_default(probe_env):
    service = make_service(
        stub_transport(models=ROWS, chat=lambda m, b: _err(401, "bad key", "invalid_api_key"))
    )
    body = service.models_body(await service.get_report(load_llm_config()))
    assert body["models"] == []
    assert body["default_model"] is None
    assert body["default_fallback"] is False
    assert body["upstream_reachable"] is True


# --------------------------------------------------------------------------- upstream down


@pytest.mark.parametrize(
    ("models_error", "code"),
    [
        (httpx.ConnectError("[Errno 61] Connection refused"), "connect_error"),
        (httpx.ConnectError("nodename nor servname provided"), "connect_error"),
        (httpx.ConnectTimeout("timed out"), "timeout"),
        (httpx.Response(503, text="down"), "http_error"),
        (httpx.Response(401, json={"error": {"message": "bad"}}), "auth_error"),
    ],
)
async def test_upstream_down(probe_env, tmp_path, monkeypatch, models_error, code):
    calls: dict[str, int] = {}
    clock = Clock()
    service = make_service(
        stub_transport(models=ROWS, models_error=models_error, calls=calls), clock=clock
    )
    app = make_app(service, tmp_path, monkeypatch)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        models = (await client.get("/v1/copilot/models")).json()
        report = (await client.get("/v1/copilot/models/probe")).json()
    assert models["models"] == []
    assert models["upstream_reachable"] is False
    assert models["upstream_error"]["code"] == code
    assert models["default_model"] is None
    assert report["upstream_reachable"] is False
    assert report["upstream_error"]["code"] == code
    assert report["results"] == []
    assert calls.get("chat", 0) == 0
    assert SECRET not in json.dumps(models) + json.dumps(report)
    assert "127.0.0.1" not in models["upstream_error"]["message"]

    # Down reports expire fast so a freshly started upstream shows up quickly.
    clock.now += 16
    await service.get_report(load_llm_config())
    assert service.probe_runs == 2


# --------------------------------------------------------------------------- redaction


def test_redact_secrets_patterns():
    text = (
        f"key {SECRET} Authorization: Bearer abc.def-ghi "
        "url https://x.test/v1?key=AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345&alt=json "
        "https://user:pa55@host/v1 api_key=plainvalue "
        "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123"
    )
    out = redact_secrets(text, secrets=(SECRET,))
    for leaked in (SECRET, "abc.def-ghi", "AIzaSyABCDEFGHIJ", "pa55", "plainvalue", "eyJhbGci"):
        assert leaked not in out
    assert "[redacted]" in out
    long = sanitize_message("x" * 1000)
    assert long is not None and len(long) <= 200


async def test_key_never_in_responses_or_logs(probe_env, tmp_path, monkeypatch, caplog):
    def chat(model, body):
        return _err(
            401,
            f"Incorrect API key provided: {SECRET}. Header was 'Bearer {SECRET}'. "
            "See https://gw.test/v1?api_key=sk-otherkey123456789",
            "invalid_api_key",
        )

    service = make_service(stub_transport(models=ROWS, chat=chat))
    app = make_app(service, tmp_path, monkeypatch)
    caplog.set_level(logging.DEBUG, logger="cryptosignal_copilot")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        models = await client.get("/v1/copilot/models")
        report = await client.get("/v1/copilot/models/probe")
    dumped = models.text + report.text + caplog.text
    assert SECRET not in dumped
    assert "sk-otherkey" not in dumped
    messages = [r["message"] for r in report.json()["results"]]
    assert messages and all("[redacted]" in (m or "") for m in messages)


async def test_probe_disabled_keeps_catalog_listing(probe_env, tmp_path, monkeypatch):
    service = make_service(
        stub_transport(models=ROWS, chat=mixed_chat), settings=ProbeSettings(enabled=False)
    )
    app = make_app(service, tmp_path, monkeypatch)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        models = await client.get("/v1/copilot/models")
        report = await client.get("/v1/copilot/models/probe")
    assert models.status_code == 200
    assert {m["status"] for m in models.json()["models"]} == {"unverified"}
    assert report.status_code == 409
    assert service.probe_runs == 0


async def test_config_missing_returns_contract_shape(tmp_path, monkeypatch):
    from tests.test_models_wire import check_models_body, check_report_body

    monkeypatch.setenv("LLM_API_STYLE", "openai")
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:20128/v1")
    monkeypatch.setenv("LLM_API_KEY", "")
    monkeypatch.setenv("LLM_MODEL", "m/fast")
    service = make_service(stub_transport(models=ROWS))
    app = make_app(service, tmp_path, monkeypatch)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        models = await client.get("/v1/copilot/models")
        report = await client.post("/v1/copilot/models/probe")
    assert models.status_code == 200 and report.status_code == 200
    check_models_body(models.json(), "models")
    check_report_body(report.json(), "report")
    assert models.json()["upstream_error"]["code"] == "config_missing"
    assert "LLM_API_KEY" in models.json()["upstream_error"]["message"]
    assert models.json()["requested_default"] == "m/fast"
    assert report.json()["provider"] == "omniroute"
    assert service.probe_runs == 0
