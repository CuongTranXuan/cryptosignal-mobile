import json

import httpx
import pytest

from cryptosignal_copilot.config import LlmConfig
from cryptosignal_copilot.llm_provider import (
    detect_llm_provider,
    normalize_gemini_catalog_id,
    provider_api_model_id,
    sanitize_chat_completion_body,
)
from cryptosignal_copilot.model_catalog import normalize_model_row
from cryptosignal_copilot.model_visibility import normalize_upstream_model_id
from cryptosignal_copilot.model_routes import resolve_provider_model_id
from cryptosignal_copilot.run_settings import build_run_model_settings


def _gemini_cfg() -> LlmConfig:
    return LlmConfig(
        style="openai",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        api_key="test-gemini-key",
        model="gemini-2.5-flash",
        timeout_s=60.0,
    )


def test_detect_gemini_from_base_url():
    assert detect_llm_provider(_gemini_cfg()) == "gemini"


def test_normalize_models_prefix():
    assert normalize_gemini_catalog_id("models/gemini-2.5-flash") == "gemini-2.5-flash"
    assert normalize_gemini_catalog_id("gemini-2.5-flash") == "gemini-2.5-flash"


def test_provider_api_model_id_bare():
    assert provider_api_model_id("models/gemini-2.5-flash", "gemini") == "gemini-2.5-flash"
    assert provider_api_model_id("agentrouter/deepseek-v4-flash", "generic") == (
        "agentrouter/deepseek-v4-flash"
    )


def test_resolve_provider_model_id_gemini():
    cfg = _gemini_cfg()
    model = normalize_model_row({"id": "gemini-2.5-flash", "owned_by": "google"})
    assert resolve_provider_model_id(model, "low", cfg=cfg) == "gemini-2.5-flash"
    assert (
        resolve_provider_model_id(
            normalize_model_row({"id": "models/gemini-2.5-flash", "owned_by": "google"}),
            None,
            cfg=cfg,
        )
        == "gemini-2.5-flash"
    )


def test_gemini_limits_table():
    model = normalize_model_row({"id": "gemini-2.5-pro", "owned_by": "google"})
    assert model.context_window == 1_048_576
    assert model.max_output_tokens == 65_536
    assert model.reasoning_efforts == ("low", "medium", "high")


def test_gemini_reasoning_pro_disallows_none():
    model = normalize_model_row({"id": "gemini-2.5-pro", "owned_by": "google"})
    settings, effort = build_run_model_settings(
        model, reasoning_effort="none", provider_id="gemini"
    )
    assert effort == "low"
    assert settings.get("openai_reasoning_effort") == "low"


def test_gemini_flash_allows_none():
    model = normalize_model_row({"id": "gemini-2.5-flash", "owned_by": "google"})
    settings, effort = build_run_model_settings(
        model, reasoning_effort="none", provider_id="gemini"
    )
    assert effort == "none"
    assert settings.get("openai_reasoning_effort") == "none"


def test_sanitize_strips_unsupported_params():
    body = {
        "model": "models/gemini-2.5-flash",
        "messages": [{"role": "user", "content": "hi"}],
        "seed": 1,
        "parallel_tool_calls": False,
        "logprobs": True,
        "stream_options": {},
    }
    cleaned = sanitize_chat_completion_body(body, "gemini")
    assert cleaned["model"] == "gemini-2.5-flash"
    assert "seed" not in cleaned
    assert "parallel_tool_calls" not in cleaned
    assert "logprobs" not in cleaned
    assert "stream_options" not in cleaned


def test_normalize_upstream_model_id_gemini_base(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", _gemini_cfg().base_url)
    assert normalize_upstream_model_id("models/gemini-2.5-flash") == "gemini-2.5-flash"


@pytest.mark.asyncio
async def test_default_fetch_models_normalizes_gemini_ids(monkeypatch):
    import cryptosignal_copilot.model_catalog as mc

    cfg = _gemini_cfg()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"data": [{"id": "models/gemini-2.5-flash"}, {"id": "models/gemini-2.5-pro"}]},
        )

    class _PatchedAsyncClient(httpx.AsyncClient):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(handler)
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(mc.httpx, "AsyncClient", _PatchedAsyncClient)
    rows = await mc.default_fetch_models(cfg)
    assert {row["id"] for row in rows} == {"gemini-2.5-flash", "gemini-2.5-pro"}


def test_streaming_body_keeps_stream_flag():
    body = sanitize_chat_completion_body(
        {
            "model": "models/gemini-2.5-flash",
            "messages": [],
            "seed": 9,
            "stream": True,
        },
        "gemini",
    )
    assert body["stream"] is True
    assert "seed" not in body


def test_structured_output_retry_path_uses_openai_reasoning_effort():
    """Gemini OpenAI compat: reasoning via openai_reasoning_effort (not thinking)."""
    model = normalize_model_row({"id": "gemini-2.5-flash", "owned_by": "google"})
    settings, _ = build_run_model_settings(model, reasoning_effort="medium", provider_id="gemini")
    assert settings.get("openai_reasoning_effort") == "medium"
    assert "thinking" not in settings
