from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

INTERVALS = ("1m", "15m", "1h", "4h", "1d")
Interval = Literal["1m", "15m", "1h", "4h", "1d"]
Kind = Literal["trendline", "polyline", "zone"]
Status = Literal["preview", "committed"]
# Trading-order keys. PatternShape forbids `side` as an order field.
# AgentMarker.side is signal direction (buy|sell|neutral), not an order.
FORBIDDEN = {"order", "side", "quantity", "apiKey", "secret", "leverage"}


class Point(BaseModel):
    model_config = ConfigDict(extra="forbid")

    time: int
    price: float


class PatternShape(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    symbol: str
    interval: Interval
    kind: Kind
    name: str
    status: Status
    source: Literal["agent"]
    confidence: float = Field(ge=0, le=1)
    points: list[Point]
    priceLow: float | None
    priceHigh: float | None
    agentId: str | None = None

    @model_validator(mode="after")
    def check_geometry(self) -> "PatternShape":
        if self.kind == "trendline" and len(self.points) != 2:
            raise ValueError("trendline needs 2 points")
        if self.kind == "polyline" and len(self.points) < 3:
            raise ValueError("polyline needs >= 3 points")
        if self.kind == "zone":
            if self.priceLow is None or self.priceHigh is None or not (self.priceLow < self.priceHigh):
                raise ValueError("zone needs priceLow < priceHigh")
        return self


PatternShapeModel = PatternShape


def parse_pattern_shape(input_data: object) -> PatternShape:
    return PatternShape.model_validate(input_data)


class AgentMarker(BaseModel):
    """Point signal for LWC series markers. `side` is signal direction, not an order field."""

    model_config = ConfigDict(extra="forbid")

    id: str
    agentId: str | None = None
    symbol: str
    interval: Interval
    time: int
    side: Literal["buy", "sell", "neutral"]
    position: Literal["aboveBar", "belowBar", "inBar"]
    shape: Literal["arrowUp", "arrowDown", "circle", "square"]
    label: str | None = None
    confidence: float = Field(ge=0, le=1)
    source: Literal["agent"]


def parse_agent_marker(input_data: object) -> AgentMarker:
    return AgentMarker.model_validate(input_data)


def _dump_omit_unset_agent_id(model: PatternShape | AgentMarker) -> dict[str, Any]:
    data = model.model_dump()
    if data.get("agentId") is None:
        data.pop("agentId", None)
    if isinstance(model, AgentMarker) and data.get("label") is None:
        data.pop("label", None)
    return data


class Candle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    symbol: str
    interval: Interval
    from_: int = Field(alias="from")
    to: int
    closedCandles: list[Candle]
    existingShapes: list[PatternShape]
    existingMarkers: list[AgentMarker] = Field(default_factory=list)
    prompt: str


class AnalyzeResult(BaseModel):
    """Agent structured output. Shapes are raw dicts so invalid geometry can be dropped."""

    model_config = ConfigDict(extra="forbid")

    summary: str
    shapes: list[dict[str, Any]]
    markers: list[dict[str, Any]] = Field(default_factory=list)


def filter_preview_shapes(
    raw_shapes: list[Any],
    allowed_times: set[int] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Force preview status, keep valid shapes on closed candle times, return dropped ids."""
    valid: list[dict[str, Any]] = []
    dropped_ids: list[str] = []
    for raw in raw_shapes:
        if hasattr(raw, "model_dump"):
            data = raw.model_dump()
        elif isinstance(raw, dict):
            data = dict(raw)
        else:
            dropped_ids.append("?")
            continue
        data["status"] = "preview"
        try:
            validated = PatternShape.model_validate(data)
        except (ValidationError, ValueError):
            dropped_ids.append(str(data.get("id", "?")))
            continue
        if allowed_times is not None:
            if any(p.time not in allowed_times for p in validated.points):
                dropped_ids.append(validated.id)
                continue
        valid.append(_dump_omit_unset_agent_id(validated))
    return valid, dropped_ids


def filter_agent_markers(
    raw_markers: list[Any],
    allowed_times: set[int] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Keep valid AgentMarker rows on closed candle times, return dropped ids."""
    valid: list[dict[str, Any]] = []
    dropped_ids: list[str] = []
    for raw in raw_markers:
        if hasattr(raw, "model_dump"):
            data = raw.model_dump()
        elif isinstance(raw, dict):
            data = dict(raw)
        else:
            dropped_ids.append("?")
            continue
        try:
            validated = AgentMarker.model_validate(data)
        except (ValidationError, ValueError):
            dropped_ids.append(str(data.get("id", "?")))
            continue
        if allowed_times is not None and validated.time not in allowed_times:
            dropped_ids.append(validated.id)
            continue
        valid.append(_dump_omit_unset_agent_id(validated))
    return valid, dropped_ids


class ExtendRange(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_: int = Field(alias="from")
    to: int
