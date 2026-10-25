from __future__ import annotations

from typing import cast

from pydantic_ai.settings import ModelSettings, ThinkingLevel

from cryptosignal_copilot.llm_provider import gemini_table_reasoning_efforts
from cryptosignal_copilot.model_catalog import NormalizedModel


def build_run_model_settings(
    model: NormalizedModel,
    *,
    reasoning_effort: str | None = None,
    provider_id: str = "generic",
) -> tuple[ModelSettings, str | None]:
    """Map spec §2.3 to pydantic-ai `ModelSettings` (unified `thinking` field)."""
    max_tokens = model.request_max_tokens
    effort = reasoning_effort
    routes = dict(model.effort_routes)

    if provider_id == "gemini":
        gemini_efforts = gemini_table_reasoning_efforts(model.id)
        if not gemini_efforts:
            return {"max_tokens": max_tokens}, None
        effort = reasoning_effort or "low"
        if effort == "none" and "none" not in gemini_efforts:
            effort = "low"
        if effort not in gemini_efforts:
            effort = gemini_efforts[0]
        return (
            cast(
                ModelSettings,
                {"max_tokens": max_tokens, "openai_reasoning_effort": effort},
            ),
            effort,
        )

    if not model.supports_reasoning or not model.reasoning_efforts:
        return {"max_tokens": model.request_max_tokens}, None

    if effort is None:
        effort = "low" if model.reasoning_efforts else None

    if effort and effort in routes:
        return {"max_tokens": max_tokens}, effort

    settings: ModelSettings = {"max_tokens": max_tokens}
    if effort is None:
        settings["thinking"] = "low"
        return settings, None

    if effort == "none":
        if "none" in routes:
            return {"max_tokens": max_tokens}, "none"
        settings["thinking"] = False
        return settings, "none"

    if model.reasoning_efforts and effort not in model.reasoning_efforts:
        effort = "low" if "low" in model.reasoning_efforts else model.reasoning_efforts[0]

    settings["thinking"] = cast(ThinkingLevel, effort)
    return settings, effort


def lower_reasoning_effort(current: str | None, model: NormalizedModel) -> str | None:
    if not model.reasoning_efforts:
        return current
    if current == "low" and "none" in model.reasoning_efforts:
        return "none"
    if current == "medium" and "low" in model.reasoning_efforts:
        return "low"
    if current == "high" and "low" in model.reasoning_efforts:
        return "low"
    return current
