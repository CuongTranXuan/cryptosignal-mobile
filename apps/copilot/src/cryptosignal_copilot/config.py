from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse


class LlmConfigError(Exception):
    pass


@dataclass(frozen=True)
class LlmConfig:
    style: str
    base_url: str
    api_key: str
    model: str
    timeout_s: float


def load_llm_config() -> LlmConfig:
    style = os.environ.get("LLM_API_STYLE", "").strip().lower()
    base_url = os.environ.get("LLM_BASE_URL", "").strip().rstrip("/")
    api_key = os.environ.get("LLM_API_KEY", "").strip()
    model = os.environ.get("LLM_MODEL", "").strip()
    timeout_s = float(os.environ.get("LLM_TIMEOUT_S", "60"))
    missing = [
        n
        for n, v in [
            ("LLM_API_STYLE", style),
            ("LLM_BASE_URL", base_url),
            ("LLM_API_KEY", api_key),
            ("LLM_MODEL", model),
        ]
        if not v
    ]
    if missing:
        raise LlmConfigError(f"LLM config missing: {', '.join(missing)}")
    if style not in {"openai", "anthropic"}:
        raise LlmConfigError(f"unknown LLM_API_STYLE: {style}")
    return LlmConfig(
        style=style,
        base_url=base_url,
        api_key=api_key,
        model=model,
        timeout_s=timeout_s,
    )


def health_payload(cfg: LlmConfig) -> dict:
    host = urlparse(cfg.base_url).hostname or ""
    return {"ok": True, "style": cfg.style, "model": cfg.model, "baseHost": host}
