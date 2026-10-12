"""OmniRoute 3.8.51-shaped `/v1/models` fixtures (no status/connection fields)."""

from __future__ import annotations

from typing import Any

from cryptosignal_copilot.model_visibility import load_visibility_allowlist

_AGENTROUTER_BASES = ("agentrouter/deepseek-v4-flash",)

_EFFORT_SUFFIXES = ("-low", "-medium", "-high", "-max")

_CURSOR_VISIBILITY = tuple(mid for mid in load_visibility_allowlist() if mid.startswith("cursor/"))


def _agentrouter_row(model_id: str) -> dict[str, Any]:
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


def _cursor_row(model_id: str) -> dict[str, Any]:
    return {
        "id": model_id,
        "object": "model",
        "owned_by": "cursor",
        "root": model_id.split("/", 1)[-1],
    }


def omniroute_models_payload() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for base in _AGENTROUTER_BASES:
        rows.append(_agentrouter_row(base))
        short = base.split("/", 1)[-1]
        rows.append(
            {
                **_agentrouter_row(f"agentrouter/no-think/{short}"),
                "id": f"agentrouter/no-think/{short}",
            }
        )
        for suffix in _EFFORT_SUFFIXES:
            rows.append({**_agentrouter_row(f"{base}{suffix}"), "id": f"{base}{suffix}"})

    for cursor_id in _CURSOR_VISIBILITY:
        rows.append(_cursor_row(cursor_id))
        rows.append(_cursor_row(cursor_id.replace("cursor/", "cu/", 1)))

    rows.append(_cursor_row("cursor/composer-2"))
    rows.append({"id": "aihorde/flux-schnell", "owned_by": "aihorde"})
    rows.append({"id": "cursor/veo-2", "owned_by": "cursor"})
    rows.extend({"id": f"cursor/noise-{i}", "owned_by": "cursor"} for i in range(200))
    rows.extend({"id": f"cursor/model-{i}", "owned_by": "cursor"} for i in range(1400))
    rows.extend({"id": f"combo/route-{i}", "owned_by": "combo"} for i in range(45))
    return rows
