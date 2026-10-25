"""Provider detection, Gemini OpenAI-compat quirks, and request sanitization."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from cryptosignal_copilot.config import LlmConfig

GEMINI_OPENAI_BASE_HOST = "generativelanguage.googleapis.com"

# Params commonly sent by OpenAI clients / pydantic-ai that Gemini's OpenAI layer
# does not document for chat completions (see ai.google.dev/gemini-api/docs/openai).
_GEMINI_STRIP_CHAT_PARAMS: frozenset[str] = frozenset(
    {
        "parallel_tool_calls",
        "seed",
        "logprobs",
        "top_logprobs",
        "frequency_penalty",
        "presence_penalty",
        "logit_bias",
        "user",
        "service_tier",
        "store",
        "metadata",
        "prediction",
        "audio",
        "modalities",
        "web_search_options",
    }
)

# stream_options is only used when explicitly needed; pydantic-ai may send empty objects.
_GEMINI_STRIP_WHEN_EMPTY: frozenset[str] = frozenset({"stream_options"})


@dataclass(frozen=True)
class ProviderCapabilities:
    id: str
    strip_chat_params: frozenset[str]
    strip_when_empty: frozenset[str]
    normalize_models_prefix: bool
    api_model_bare_id: bool
    reasoning_effort_openai_field: bool


_CAPABILITIES: dict[str, ProviderCapabilities] = {
    "generic": ProviderCapabilities(
        id="generic",
        strip_chat_params=frozenset(),
        strip_when_empty=frozenset(),
        normalize_models_prefix=False,
        api_model_bare_id=False,
        reasoning_effort_openai_field=False,
    ),
    "gemini": ProviderCapabilities(
        id="gemini",
        strip_chat_params=_GEMINI_STRIP_CHAT_PARAMS,
        strip_when_empty=_GEMINI_STRIP_WHEN_EMPTY,
        normalize_models_prefix=True,
        api_model_bare_id=True,
        reasoning_effort_openai_field=True,
    ),
}


def detect_llm_provider(cfg: LlmConfig) -> str:
    explicit = os.environ.get("LLM_PROVIDER", "").strip().lower()
    if explicit in _CAPABILITIES:
        return explicit
    host = urlparse(cfg.base_url).netloc.lower()
    if GEMINI_OPENAI_BASE_HOST in host:
        return "gemini"
    return "generic"


def provider_capabilities(provider_id: str) -> ProviderCapabilities:
    return _CAPABILITIES.get(provider_id, _CAPABILITIES["generic"])


def normalize_gemini_catalog_id(model_id: str) -> str:
    """`models/gemini-2.5-flash` → `gemini-2.5-flash` for catalog + allowlists."""
    mid = model_id.strip()
    if mid.startswith("models/"):
        mid = mid[len("models/") :]
    return mid


def normalize_provider_model_id(model_id: str, provider_id: str) -> str:
    if provider_id == "gemini":
        return normalize_gemini_catalog_id(model_id)
    return model_id


def provider_api_model_id(model_id: str, provider_id: str) -> str:
    """Id sent on chat completion requests."""
    caps = provider_capabilities(provider_id)
    bare = model_id.rsplit("/", 1)[-1]
    if caps.api_model_bare_id:
        return normalize_gemini_catalog_id(bare)
    return model_id


def gemini_table_reasoning_efforts(model_id: str) -> tuple[str, ...] | None:
    """Reasoning tiers per Gemini OpenAI compatibility thinking table."""
    bare = normalize_gemini_catalog_id(model_id.rsplit("/", 1)[-1]).lower()
    if re.search(r"gemini-2\.5-pro", bare):
        return ("low", "medium", "high")
    if re.search(r"gemini-2\.5-flash-lite", bare):
        return ("none", "low", "medium", "high")
    if re.search(r"gemini-2\.5-flash", bare):
        return ("none", "low", "medium", "high")
    if re.search(r"gemini-2\.5", bare):
        return ("none", "low", "medium", "high")
    if re.search(r"gemini-3", bare):
        return ("low", "medium", "high")
    if re.search(r"gemini-2\.0", bare):
        return ()
    return None


def gemini_supports_reasoning(model_id: str) -> bool:
    efforts = gemini_table_reasoning_efforts(model_id)
    return efforts is not None and len(efforts) > 0


def sanitize_chat_completion_body(body: dict[str, Any], provider_id: str) -> dict[str, Any]:
    caps = provider_capabilities(provider_id)
    if caps.id == "generic":
        return body
    out = dict(body)
    if "model" in out and isinstance(out["model"], str):
        out["model"] = provider_api_model_id(out["model"], provider_id)
    for key in caps.strip_chat_params:
        out.pop(key, None)
    for key in caps.strip_when_empty:
        val = out.get(key)
        if val in (None, {}, []):
            out.pop(key, None)
    # pydantic-ai may send `thinking` in extra_body; Gemini OpenAI layer uses reasoning_effort.
    if "thinking" in out:
        out.pop("thinking", None)
    return out


async def _httpx_sanitize_request_hook(request: Any, provider_id: str) -> None:
    if provider_id != "gemini":
        return
    path = str(getattr(request, "url", ""))
    if "/chat/completions" not in path:
        return
    content = getattr(request, "content", None)
    if not content:
        return
    try:
        raw = content.decode() if isinstance(content, bytes) else str(content)
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return
    if not isinstance(payload, dict):
        return
    cleaned = sanitize_chat_completion_body(payload, provider_id)
    request.content = json.dumps(cleaned, separators=(",", ":")).encode()


def build_openai_http_client(provider_id: str, timeout: float) -> Any:
    import httpx

    if provider_id != "gemini":
        return None

    async def hook(request: httpx.Request) -> None:
        await _httpx_sanitize_request_hook(request, provider_id)

    return httpx.AsyncClient(timeout=timeout, event_hooks={"request": [hook]})
