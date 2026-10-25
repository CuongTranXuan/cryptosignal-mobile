"""Drawing guardrail model shared by wire shapes, markers and stored session messages."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from cryptosignal_copilot.wire_shape import guardrail_for_wire


class Invalidation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    price: float
    condition: str | None = None


class Guardrail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    regime: Literal["trend_up", "trend_down", "range", "volatile"]
    confidence: float = Field(ge=0, le=1)
    evidence_against: list[str] = Field(default_factory=list)
    invalidation: Invalidation | None = None


def coerce_wire_guardrail(value: Any) -> Any:
    """Before-validator: reject non-wire keys with the same rule the SSE path uses."""
    if isinstance(value, dict):
        return guardrail_for_wire(value)
    return value
