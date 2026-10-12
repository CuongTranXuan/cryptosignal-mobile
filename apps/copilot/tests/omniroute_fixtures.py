"""OmniRoute 3.8.51-shaped `/v1/models` fixtures (no status/connection fields)."""

from __future__ import annotations

from typing import Any

_WORKING_BASES = (
    "agentrouter/claude-opus-4-8",
    "agentrouter/claude-opus-5",
    "agentrouter/deepseek-v4-flash",
    "agentrouter/gpt-6-astra",
)

_EFFORT_SUFFIXES = ("-low", "-medium", "-high", "-max")


def _base_row(model_id: str) -> dict[str, Any]:
    name = model_id.split("/", 1)[-1]
    return {
        "id": model_id,
        "object": "model",
        "owned_by": "agentrouter",
        "root": name,
        "parent": None,
        "capabilities": {
            "reasoning": True,
            "thinking": True,
            "tool_calling": True,
            "vision": False,
            "effort_tiers": ["none", "low", "medium", "high", "xhigh", "max"],
        },
        "context_length": 1_000_000,
        "max_input_tokens": 1_000_000,
        "max_output_tokens": 384_000,
        "supportsThinking": True,
    }


def omniroute_models_payload() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for base in _WORKING_BASES:
        rows.append(_base_row(base))
        short = base.split("/", 1)[-1]
        rows.append({**_base_row(f"agentrouter/no-think/{short}"), "id": f"agentrouter/no-think/{short}"})
        for suffix in _EFFORT_SUFFIXES:
            rows.append({**_base_row(f"{base}{suffix}"), "id": f"{base}{suffix}"})

    rows.extend({"id": f"cursor/model-{i}", "owned_by": "cursor"} for i in range(1400))
    rows.extend({"id": f"aihorde/model-{i}", "owned_by": "aihorde"} for i in range(164))
    rows.extend({"id": f"combo/route-{i}", "owned_by": "combo"} for i in range(45))
    # 4 bases + 1 no-think + 4 effort each = 4 * 6 = 24 agentrouter rows (matches ~26 with extras)
    return rows
