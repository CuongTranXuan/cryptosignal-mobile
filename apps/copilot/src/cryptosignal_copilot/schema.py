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
    source: Literal["agent", "human"]
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


def coerce_agent_shape(raw: dict[str, Any], *, symbol: str, interval: str) -> dict[str, Any]:
    """Map common LLM sloppy overlays into PatternShape fields."""
    data = dict(raw)
    if data.get("kind") is None and isinstance(data.get("type"), str):
        data["kind"] = data.pop("type")
    else:
        data.pop("type", None)
    if data.get("name") is None and isinstance(data.get("label"), str):
        data["name"] = data["label"]
    data.pop("label", None)
    for key in ("color", "lineWidth", "role", "style", "stroke", "fill"):
        data.pop(key, None)
    if not data.get("id"):
        data["id"] = f"agent_{id(data) & 0xFFFFFF:x}"
    data.setdefault("symbol", symbol)
    data.setdefault("interval", interval)
    data.setdefault("status", "preview")
    data.setdefault("source", "agent")
    data.setdefault("confidence", 0.7)
    if "priceLow" not in data:
        data["priceLow"] = None
    if "priceHigh" not in data:
        data["priceHigh"] = None
    points = data.get("points")
    if data.get("kind") == "polyline" and isinstance(points, list) and len(points) == 2:
        data["kind"] = "trendline"
    if data.get("kind") == "zone" and isinstance(points, list) and len(points) >= 2:
        prices = []
        for pt in points:
            if isinstance(pt, dict) and pt.get("price") is not None:
                try:
                    prices.append(float(pt["price"]))
                except (TypeError, ValueError):
                    pass
        if len(prices) >= 2 and (data.get("priceLow") is None or data.get("priceHigh") is None):
            data["priceLow"] = min(prices)
            data["priceHigh"] = max(prices)
    if isinstance(points, list):
        fixed = []
        for pt in points:
            if not isinstance(pt, dict):
                continue
            try:
                fixed.append({"time": int(round(float(pt["time"]))), "price": float(pt["price"])})
            except (KeyError, TypeError, ValueError):
                continue
        data["points"] = fixed
    return data


def coerce_agent_marker(raw: dict[str, Any], *, symbol: str, interval: str) -> dict[str, Any]:
    data = dict(raw)
    if not data.get("id"):
        data["id"] = f"marker_{id(data) & 0xFFFFFF:x}"
    data.setdefault("symbol", symbol)
    data.setdefault("interval", interval)
    data.setdefault("source", "agent")
    data.setdefault("confidence", 0.7)
    if data.get("time") is not None:
        try:
            data["time"] = int(round(float(data["time"])))
        except (TypeError, ValueError):
            pass
    if data.get("position") is None and isinstance(data.get("placement"), str):
        data["position"] = data["placement"]
    if data.get("shape") is None and isinstance(data.get("marker"), str):
        data["shape"] = data["marker"]
    if data.get("side") is None and isinstance(data.get("direction"), str):
        data["side"] = data["direction"]
    if data.get("side") == "long":
        data["side"] = "buy"
    if data.get("side") == "short":
        data["side"] = "sell"
    if data.get("position") is None:
        data["position"] = "aboveBar" if data.get("side") == "sell" else "belowBar"
    if data.get("shape") is None:
        side = data.get("side")
        data["shape"] = "arrowDown" if side == "sell" else "arrowUp" if side == "buy" else "circle"
    for key in ("color", "placement", "marker", "direction"):
        data.pop(key, None)
    return data


def filter_preview_shapes(
    raw_shapes: list[Any],
    allowed_times: set[int] | None = None,
    *,
    symbol: str | None = None,
    interval: str | None = None,
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
        if symbol and interval:
            data = coerce_agent_shape(data, symbol=symbol, interval=interval)
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
