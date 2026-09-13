from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

INTERVALS = ("1m", "15m", "1h", "4h", "1d")
Interval = Literal["1m", "15m", "1h", "4h", "1d"]
Kind = Literal["trendline", "polyline", "zone"]
Status = Literal["preview", "committed"]
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
    prompt: str


class AnalyzeResult(BaseModel):
    """Agent structured output. Shapes are raw dicts so invalid geometry can be dropped."""

    model_config = ConfigDict(extra="forbid")

    summary: str
    shapes: list[dict[str, Any]]


def filter_preview_shapes(
    raw_shapes: list[Any],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Force preview status, keep valid shapes, return dropped ids."""
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
        valid.append(validated.model_dump())
    return valid, dropped_ids


class ExtendRange(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_: int = Field(alias="from")
    to: int
