from __future__ import annotations

from anthropic import AsyncAnthropic
from openai import AsyncOpenAI
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.openai import OpenAIProvider

from cryptosignal_copilot.config import LlmConfig, LlmConfigError, health_payload
from cryptosignal_copilot.llm_provider import (
    build_openai_http_client,
    detect_llm_provider,
    provider_api_model_id,
)

__all__ = ["build_model", "health_payload"]


def build_model(cfg: LlmConfig, model_id: str | None = None):
    provider_id = detect_llm_provider(cfg)
    model_name = provider_api_model_id((model_id or cfg.model).strip(), provider_id)
    if not model_name:
        raise LlmConfigError("model name is empty")
    if cfg.style == "openai":
        http_client = build_openai_http_client(provider_id, cfg.timeout_s)
        client_kwargs: dict[str, object] = {
            "base_url": cfg.base_url,
            "api_key": cfg.api_key,
            "timeout": cfg.timeout_s,
        }
        if http_client is not None:
            client_kwargs["http_client"] = http_client
        client = AsyncOpenAI(**client_kwargs)
        return OpenAIChatModel(model_name, provider=OpenAIProvider(openai_client=client))
    if cfg.style == "anthropic":
        client = AsyncAnthropic(
            base_url=cfg.base_url,
            api_key=cfg.api_key,
            timeout=cfg.timeout_s,
        )
        return AnthropicModel(model_name, provider=AnthropicProvider(anthropic_client=client))
    raise LlmConfigError(f"unknown LLM_API_STYLE: {cfg.style}")
