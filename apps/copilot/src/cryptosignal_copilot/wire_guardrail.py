"""Drawing guardrail model shared by wire shapes, markers and stored session messages."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SerializerFunctionWrapHandler, model_serializer

from cryptosignal_copilot.wire_shape import guardrail_for_wire


def _drop_none(data: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    return {k: v for k, v in data.items() if not (k in keys and v is None)}


class CodedText(BaseModel):
    """Stable machine `code` + `params`, with the Vietnamese `text` (C.16)."""

    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=64)
    params: dict[str, str | int | float] = Field(default_factory=dict)
    text: str = ""


class Invalidation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    price: float
    condition: str | None = None
    code: str | None = None
    params: dict[str, str | int | float] | None = None
    text: str | None = None

    @model_serializer(mode="wrap")
    def _omit_unset(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        return _drop_none(handler(self), ("code", "params", "text"))


class Guardrail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    regime: Literal["trend_up", "trend_down", "range", "volatile"]
    confidence: float = Field(ge=0, le=1)
    evidence_against: list[str] = Field(default_factory=list)
    evidence_against_items: list[CodedText] | None = None
    invalidation: Invalidation | None = None

    @model_serializer(mode="wrap")
    def _omit_unset(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        return _drop_none(handler(self), ("evidence_against_items",))


def coerce_wire_guardrail(value: Any) -> Any:
    """Before-validator: reject non-wire keys with the same rule the SSE path uses."""
    if isinstance(value, dict):
        return guardrail_for_wire(value)
    return value
