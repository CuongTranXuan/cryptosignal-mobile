import os
import pytest
from cryptosignal_copilot.config import LlmConfigError, load_llm_config
from cryptosignal_copilot.model_factory import build_model, health_payload


def test_unknown_style_raises(monkeypatch):
    monkeypatch.setenv("LLM_API_STYLE", "gemini")
    monkeypatch.setenv("LLM_BASE_URL", "https://example.com")
    monkeypatch.setenv("LLM_API_KEY", "k")
    monkeypatch.setenv("LLM_MODEL", "m")
    with pytest.raises(LlmConfigError, match="unknown"):
        load_llm_config()


def test_missing_key(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setenv("LLM_API_STYLE", "openai")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("LLM_MODEL", "deepseek-chat")
    with pytest.raises(LlmConfigError, match="missing"):
        load_llm_config()


def test_openai_factory_uses_base_url(monkeypatch):
    monkeypatch.setenv("LLM_API_STYLE", "openai")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("LLM_API_KEY", "sk-test")
    monkeypatch.setenv("LLM_MODEL", "deepseek-chat")
    cfg = load_llm_config()
    model = build_model(cfg)
    assert cfg.style == "openai"
    assert "deepseek" in cfg.base_url
    assert model is not None


def test_health_host_only(monkeypatch):
    monkeypatch.setenv("LLM_API_STYLE", "anthropic")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.anthropic.com")
    monkeypatch.setenv("LLM_API_KEY", "sk-ant")
    monkeypatch.setenv("LLM_MODEL", "claude-sonnet-4-5")
    payload = health_payload(load_llm_config())
    assert payload == {
        "ok": True,
        "style": "anthropic",
        "model": "claude-sonnet-4-5",
        "baseHost": "api.anthropic.com",
    }
    assert "sk-ant" not in str(payload)
