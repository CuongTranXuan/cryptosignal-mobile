"""Real `/v1/copilot/models` + `/models/probe` bodies match the committed wire fixtures.

Fixtures (shared with the web client):
- tests/fixtures/wire/models_response.json
- tests/fixtures/wire/models_probe_report.json
Each holds `healthy`, `default_fallback` and `upstream_down` cases.
Regenerate with: `python -m tests.test_models_wire` (from apps/copilot).
"""

from __future__ import annotations

import asyncio
import json
from functools import partial
from pathlib import Path
from typing import Any

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from cryptosignal_copilot.model_catalog import ModelsCatalog, default_fetch_models
from cryptosignal_copilot.model_probe import ModelProbeService, ProbeSettings
from tests.probe_fixtures import completion_ok, stub_transport

WIRE = Path(__file__).parent / "fixtures" / "wire"
CASES = ("healthy", "default_fallback", "upstream_down")

PROBE_STATUSES = {
    "ok",
    "auth_error",
    "quota_or_rate_limited",
    "not_found",
    "provider_unconfigured",
    "timeout",
    "upstream_error",
}

# Contract field -> allowed JSON types (None = null).
MODELS_FIELDS: dict[str, tuple[type | None, ...]] = {
    "models": (list,),
    "default_model": (str, None),
    "requested_default": (str,),
    "default_fallback": (bool,),
    "probed_at": (str, None),
    "ttl_s": (int,),
    "stale": (bool,),
    "probe_in_progress": (bool,),
    "upstream_reachable": (bool,),
    "upstream_error": (dict, None),
    "fetched_at": (int, None),
}
MODEL_ITEM_FIELDS: dict[str, tuple[type | None, ...]] = {
    "id": (str,),
    "latency_ms": (int,),
    "status": (str,),
    "label": (str,),
    "provider": (str,),
    "context_window": (int,),
    "max_output_tokens": (int,),
    "supports_reasoning": (bool,),
    "reasoning_efforts": (list,),
    "supports_json": (bool,),
    "source": (str,),
    "advanced": (bool,),
    "request_max_tokens": (int,),
    "recommended_candles": (int,),
    "recommended_max_candles": (int,),
    "presets": (list,),
    "structured_output_mode": (str,),
}
REPORT_FIELDS: dict[str, tuple[type | None, ...]] = {
    "probed_at": (str, None),
    "ttl_s": (int,),
    "provider": (str,),
    "upstream_reachable": (bool,),
    "upstream_error": (dict, None),
    "skipped_count": (int,),
    "skipped_ids": (list,),
    "complete": (bool,),
    "total": (int, None),
    "pending_count": (int, None),
    "probe_in_progress": (bool,),
    "results": (list,),
}
# Present on /models only while a probe runs (probe_in_progress=true).
MODELS_PROGRESS_FIELDS: dict[str, tuple[type | None, ...]] = {
    "total": (int, None),
    "pending_count": (int, None),
}
RESULT_FIELDS: dict[str, tuple[type | None, ...]] = {
    "id": (str,),
    "status": (str,),
    "latency_ms": (int, None),
    "http_status": (int, None),
    "error_code": (str, None),
    "message": (str, None),
}
UPSTREAM_ERROR_FIELDS: dict[str, tuple[type | None, ...]] = {"code": (str,), "message": (str,)}

ROWS = [
    {"id": "agentrouter/deepseek-v4-flash", "owned_by": "agentrouter", "context_length": 1_000_000},
    {"id": "cursor/composer-2.5", "owned_by": "cursor"},
    {"id": "cursor/auto", "owned_by": "cursor"},
    {"id": "auggie/claude-sonnet-4-5", "owned_by": "auggie"},
]
SECRET = "sk-wire-SECRET-0000000000000000"


def _check(obj: Any, fields: dict[str, tuple[type | None, ...]], where: str) -> None:
    assert isinstance(obj, dict), where
    assert set(obj) == set(fields), f"{where}: keys {sorted(set(obj) ^ set(fields))}"
    for key, allowed in fields.items():
        value = obj[key]
        ok = any(
            (t is None and value is None)
            or (t is int and isinstance(value, int) and not isinstance(value, bool))
            or (t not in (None, int) and isinstance(value, t))  # type: ignore[arg-type]
            for t in allowed
        )
        assert ok, f"{where}.{key}={value!r} not in {allowed}"


def check_models_body(body: dict[str, Any], where: str) -> None:
    fields = MODELS_FIELDS
    if body.get("probe_in_progress"):
        fields = {**MODELS_FIELDS, **MODELS_PROGRESS_FIELDS}
    _check(body, fields, where)
    for i, item in enumerate(body["models"]):
        _check(item, MODEL_ITEM_FIELDS, f"{where}.models[{i}]")
        assert item["status"] == "ok"
    if body["upstream_error"] is not None:
        _check(body["upstream_error"], UPSTREAM_ERROR_FIELDS, f"{where}.upstream_error")
        assert body["upstream_reachable"] is False and body["models"] == []


def check_report_body(body: dict[str, Any], where: str) -> None:
    _check(body, REPORT_FIELDS, where)
    assert body["provider"] in {"omniroute", "gemini", "openai_compat"}
    for i, item in enumerate(body["results"]):
        _check(item, RESULT_FIELDS, f"{where}.results[{i}]")
        assert item["status"] in PROBE_STATUSES
    if body["upstream_error"] is not None:
        _check(body["upstream_error"], UPSTREAM_ERROR_FIELDS, f"{where}.upstream_error")


def _chat(case: str):
    def chat(model: str, _body: dict[str, Any]) -> httpx.Response:
        if case == "default_fallback" and model == "agentrouter/deepseek-v4-flash":
            return httpx.Response(
                401, json={"error": {"message": "No active credentials for provider agentrouter"}}
            )
        if model == "cursor/auto":
            return httpx.Response(
                404, json={"error": {"message": "model not found", "code": "model_not_found"}}
            )
        if model == "auggie/claude-sonnet-4-5":
            return httpx.Response(
                502,
                json={"error": {"message": "Auggie CLI not found. Please install/login first."}},
            )
        return completion_ok(model)

    return chat


async def capture(case: str, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> tuple[dict, dict]:
    from cryptosignal_copilot.app import create_app
    from cryptosignal_copilot.config import sqlite_url_for_path
    from cryptosignal_copilot.sessions_store import reset_sessions_store_for_tests
    from tests.test_app import FakeRunner

    monkeypatch.setenv("LLM_API_STYLE", "openai")
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:20128/v1")
    monkeypatch.setenv("LLM_API_KEY", SECRET)
    monkeypatch.setenv("LLM_MODEL", "agentrouter/deepseek-v4-flash")
    monkeypatch.setenv(
        "COPILOT_MODEL_VISIBILITY_ALLOWLIST",
        "agentrouter/deepseek-v4-flash,cursor/composer-2.5,cursor/auto,auggie/claude-sonnet-4-5",
    )
    monkeypatch.setenv("DATABASE_URL", sqlite_url_for_path(tmp_path / "s.sqlite3"))
    models_error = (
        httpx.ConnectError("[Errno 61] Connection refused") if case == "upstream_down" else None
    )
    transport = stub_transport(models=ROWS, chat=_chat(case), models_error=models_error)
    catalog = ModelsCatalog(fetch_models=partial(default_fetch_models, transport=transport))
    service = ModelProbeService(
        catalog,
        transport=transport,
        settings_loader=ProbeSettings,
        clock=lambda: 1_793_000_000.0,
    )
    app = create_app(
        runner=FakeRunner(),
        models_catalog=catalog,
        sessions_store=reset_sessions_store_for_tests(tmp_path / "s.sqlite3"),
        model_probe=service,
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        models = (await client.get("/v1/copilot/models")).json()
        report = (await client.get("/v1/copilot/models/probe")).json()
    assert SECRET not in json.dumps(models) + json.dumps(report)
    return models, report


def _load(name: str) -> dict[str, Any]:
    return json.loads((WIRE / name).read_text())


def test_fixture_files_match_contract():
    models = _load("models_response.json")
    report = _load("models_probe_report.json")
    assert set(models) >= set(CASES) and set(report) >= set(CASES)
    for case in CASES:
        check_models_body(models[case], f"models_response.{case}")
        check_report_body(report[case], f"models_probe_report.{case}")
        assert report[case]["skipped_count"] == len(report[case]["skipped_ids"])
    assert models["healthy"]["default_fallback"] is False
    assert models["default_fallback"]["default_fallback"] is True
    assert models["upstream_down"]["upstream_reachable"] is False
    statuses = {r["id"]: r["status"] for r in report["default_fallback"]["results"]}
    assert statuses["agentrouter/deepseek-v4-flash"] == "auth_error"
    assert statuses["auggie/claude-sonnet-4-5"] == "provider_unconfigured"
    assert statuses["cursor/auto"] == "not_found"


@pytest.mark.parametrize("case", CASES)
async def test_real_responses_match_fixtures(case, monkeypatch, tmp_path):
    models, report = await capture(case, monkeypatch, tmp_path)
    check_models_body(models, f"live.models.{case}")
    check_report_body(report, f"live.report.{case}")
    fixture_models = _load("models_response.json")[case]
    fixture_report = _load("models_probe_report.json")[case]
    assert [m["id"] for m in models["models"]] == [m["id"] for m in fixture_models["models"]]
    for key in ("default_model", "requested_default", "default_fallback", "upstream_reachable"):
        assert models[key] == fixture_models[key], key
    assert [(r["id"], r["status"]) for r in report["results"]] == [
        (r["id"], r["status"]) for r in fixture_report["results"]
    ]
    assert (report["upstream_error"] or {}).get("code") == (
        fixture_report["upstream_error"] or {}
    ).get("code")


def _regenerate() -> None:  # pragma: no cover - dev helper
    import tempfile

    out_models: dict[str, Any] = {}
    out_report: dict[str, Any] = {}
    for case in CASES:
        mp = pytest.MonkeyPatch()
        try:
            models, report = asyncio.run(capture(case, mp, Path(tempfile.mkdtemp())))
        finally:
            mp.undo()
        for i, item in enumerate(models["models"]):
            item["latency_ms"] = 400 + 150 * i
        if models["fetched_at"] is not None:
            models["fetched_at"] = 1_793_000_000
        for i, item in enumerate(report["results"]):
            item["latency_ms"] = 400 + 150 * i
        out_models[case] = models
        out_report[case] = report
    WIRE.mkdir(parents=True, exist_ok=True)
    (WIRE / "models_response.json").write_text(json.dumps(out_models, indent=2) + "\n")
    (WIRE / "models_probe_report.json").write_text(json.dumps(out_report, indent=2) + "\n")


if __name__ == "__main__":  # pragma: no cover
    _regenerate()
