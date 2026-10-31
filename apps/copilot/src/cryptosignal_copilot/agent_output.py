from __future__ import annotations

from typing import Any

from pydantic_ai.output import PromptedOutput, TextOutput

from cryptosignal_copilot.drawing_intent import AnalyzeResultLlm
from cryptosignal_copilot.model_catalog import NormalizedModel, StructuredOutputMode
from cryptosignal_copilot.output_parsing import (
    parse_analyze_result_llm_text,
)


def build_agent_output_type(model: NormalizedModel) -> Any:
    if model.structured_output_mode == "text_json":
        return TextOutput(parse_analyze_result_llm_text)
    return PromptedOutput(AnalyzeResultLlm)


def output_retries_for_model(model: NormalizedModel) -> int:
    if model.structured_output_mode == "text_json":
        return 3
    return 2


def coerce_structured_output_mode(value: object) -> StructuredOutputMode | None:
    if value in ("text_json", "prompted"):
        return value  # type: ignore[return-value]
    return None
