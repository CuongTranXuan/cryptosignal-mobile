from __future__ import annotations

from anthropic import AsyncAnthropic
from openai import AsyncOpenAI
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.openai import OpenAIProvider

from cryptosignal_copilot.config import LlmConfig, LlmConfigError, health_payload

__all__ = ["build_model", "health_payload"]


def build_model(cfg: LlmConfig, model_id: str | None = None):
    model_name = (model_id or cfg.model).strip()
    if not model_name:
        raise LlmConfigError("model name is empty")
    if cfg.style == "openai":
        client = AsyncOpenAI(
            base_url=cfg.base_url,
            api_key=cfg.api_key,
            timeout=cfg.timeout_s,
        )
        return OpenAIChatModel(model_name, provider=OpenAIProvider(openai_client=client))
    if cfg.style == "anthropic":
        client = AsyncAnthropic(
            base_url=cfg.base_url,
            api_key=cfg.api_key,
            timeout=cfg.timeout_s,
        )
        return AnthropicModel(model_name, provider=AnthropicProvider(anthropic_client=client))
    raise LlmConfigError(f"unknown LLM_API_STYLE: {cfg.style}")
