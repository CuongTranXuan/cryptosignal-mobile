"""A model the provider marks non-reasoning exposes no reasoning tiers on /models.

Live OmniRoute (2026-10-26) lists gemini/gemini-3-flash-preview with
`capabilities.reasoning: false`; the table fallback still filled
`reasoning_efforts: ["low","medium","high"]`, a contradictory record.
"""

from __future__ import annotations

from cryptosignal_copilot.model_catalog import normalize_model_row

FLASH_PREVIEW_ROW = {
    "id": "gemini/gemini-3-flash-preview",
    "object": "model",
    "owned_by": "gemini",
    "root": "gemini-3-flash-preview",
    "capabilities": {
        "vision": True,
        "tool_calling": True,
        "reasoning": False,
        "thinking": False,
        "supportsThinking": False,
    },
    "context_length": 1048576,
    "max_output_tokens": 65536,
    "name": "Gemini 3 Flash Preview",
}


def test_provider_non_reasoning_model_has_no_efforts() -> None:
    model = normalize_model_row(dict(FLASH_PREVIEW_ROW))
    assert model.supports_reasoning is False
    assert model.reasoning_efforts == ()
    assert model.to_api_dict()["reasoning_efforts"] == []


def test_table_reasoning_model_keeps_table_efforts() -> None:
    row = {**FLASH_PREVIEW_ROW, "capabilities": {"vision": True}}
    model = normalize_model_row(row)
    assert model.supports_reasoning is True
    assert model.reasoning_efforts == ("low", "medium", "high")


def test_provider_tiers_on_reasoning_model_are_kept() -> None:
    row = {
        **FLASH_PREVIEW_ROW,
        "capabilities": {"reasoning": True, "effort_tiers": ["none", "low", "high"]},
    }
    model = normalize_model_row(row)
    assert model.reasoning_efforts == ("none", "low", "high")
