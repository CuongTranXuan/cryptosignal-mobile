import logging
from dataclasses import replace
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from cryptosignal_copilot.drawing_gate import DrawingWindow, Drop, apply_preview_gate

logger = logging.getLogger(__name__)

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


_SHAPE_FIELDS = (
    "id",
    "symbol",
    "interval",
    "kind",
    "name",
    "status",
    "source",
    "confidence",
    "points",
    "priceLow",
    "priceHigh",
    "agentId",
)
_KIND_ALIASES = {
    "trendline": "trendline",
    "trend-line": "trendline",
    "trend": "trendline",
    "line": "trendline",
    "ray": "trendline",
    "polyline": "polyline",
    "polygon": "polyline",
    "path": "polyline",
    "zone": "zone",
    "band": "zone",
    "box": "zone",
    "rectangle": "zone",
}
_INTERVAL_ALIASES = {
    "1m": "1m",
    "1min": "1m",
    "15m": "15m",
    "15min": "15m",
    "1h": "1h",
    "60m": "1h",
    "4h": "4h",
    "1d": "1d",
    "1day": "1d",
    "d": "1d",
}


def _schema_reason(exc: Exception) -> str:
    """Stable `schema:<field>` token plus a log line with the validator message."""
    if isinstance(exc, ValidationError) and exc.errors():
        err = exc.errors()[0]
        loc = [str(part) for part in err.get("loc", ()) if not isinstance(part, int)]
        field = loc[0] if loc else ""
        msg = str(err.get("msg", ""))
        if not field and "point" in msg.lower():
            field = "points"
        if not field:
            field = "shape"
        logger.info("schema reject field=%s msg=%s", field, msg[:240])
        return f"schema:{field}"
    text = str(exc)
    logger.info("schema reject msg=%s", text[:240])
    if "point" in text.lower():
        return "schema:points"
    return "schema:shape"


def _finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _coerce_point(raw: Any) -> dict[str, Any] | None:
    """Normalize one anchor to `{time, price}`. Unix seconds may be int or float."""
    time_val: Any
    price_val: Any
    if isinstance(raw, (list, tuple)) and len(raw) >= 2:
        time_val, price_val = raw[0], raw[1]
    elif isinstance(raw, dict):
        time_val = raw.get("time", raw.get("t", raw.get("timestamp", raw.get("ts"))))
        price_val = raw.get("price", raw.get("p", raw.get("value", raw.get("y"))))
    else:
        return None
    time_num = _finite_float(time_val)
    price_num = _finite_float(price_val)
    if time_num is None or price_num is None:
        return None
    # Binance-style milliseconds. Second timestamps stay below this.
    if time_num > 10_000_000_000:
        time_num = time_num / 1000.0
    return {"time": int(round(time_num)), "price": price_num}


def _coerce_points(raw: dict[str, Any]) -> list[dict[str, Any]]:
    points = raw.get("points")
    if points is None:
        for key in ("anchors", "coords", "coordinates"):
            if key in raw:
                points = raw[key]
                break
    items: list[Any]
    if isinstance(points, dict):
        ordered: list[Any] = []
        for key in ("start", "end", "a", "b", "p1", "p2", "from", "to"):
            if key in points:
                ordered.append(points[key])
        items = ordered or list(points.values())
    elif isinstance(points, list):
        items = list(points)
    else:
        items = []
    if len(items) < 2:
        for key in ("start", "end"):
            if isinstance(raw.get(key), (dict, list, tuple)):
                items.append(raw[key])
    fixed: list[dict[str, Any]] = []
    for item in items:
        point = _coerce_point(item)
        if point is not None:
            fixed.append(point)
    return fixed


def _coerce_kind(raw_kind: Any, point_count: int) -> str | None:
    if not isinstance(raw_kind, str) or not raw_kind.strip():
        return None
    kind = raw_kind.strip().lower().replace("_", "-").replace(" ", "-")
    if kind in _KIND_ALIASES:
        return _KIND_ALIASES[kind]
    if kind in {"triangle", "ascending-triangle", "descending-triangle", "symmetrical-triangle"}:
        return "trendline" if point_count == 2 else "polyline"
    return kind


def _coerce_interval(value: Any, fallback: str) -> str:
    if isinstance(value, str):
        key = value.strip().lower().replace(" ", "")
        if key in _INTERVAL_ALIASES:
            return _INTERVAL_ALIASES[key]
    if fallback in _INTERVAL_ALIASES:
        return _INTERVAL_ALIASES[fallback]
    return fallback


def _coerce_confidence(value: Any) -> float:
    number = _finite_float(value)
    if number is None:
        return 0.7
    if number > 1 and number <= 100:
        number = number / 100.0
    if number < 0 or number > 1:
        return 0.7
    return number


def coerce_agent_shape(raw: dict[str, Any], *, symbol: str, interval: str) -> dict[str, Any]:
    """Map common LLM sloppy overlays into PatternShape fields.

    Unknown keys are dropped so `extra=forbid` does not reject an otherwise
    drawable trendline. A future endpoint is just another `{time, price}`.
    """
    data = dict(raw)
    if data.get("kind") is None and isinstance(data.get("type"), str):
        data["kind"] = data["type"]
    if data.get("name") is None and isinstance(data.get("label"), str):
        data["name"] = data["label"]
    if data.get("priceLow") is None and data.get("price_low") is not None:
        data["priceLow"] = data["price_low"]
    if data.get("priceHigh") is None and data.get("price_high") is not None:
        data["priceHigh"] = data["price_high"]
    if data.get("agentId") is None and isinstance(data.get("agent_id"), str):
        data["agentId"] = data["agent_id"]

    points = _coerce_points(data)
    kind = _coerce_kind(data.get("kind"), len(points))
    if kind == "polyline" and len(points) == 2:
        kind = "trendline"
    if kind == "zone" and len(points) >= 2 and (data.get("priceLow") is None or data.get("priceHigh") is None):
        prices = [point["price"] for point in points]
        data["priceLow"] = min(prices)
        data["priceHigh"] = max(prices)

    if not data.get("id"):
        data["id"] = f"agent_{id(data) & 0xFFFFFF:x}"
    else:
        data["id"] = str(data["id"])
    if not isinstance(data.get("name"), str) or not str(data.get("name")).strip():
        data["name"] = data["id"]
    if not data.get("symbol"):
        data["symbol"] = symbol
    data["symbol"] = str(data.get("symbol") or symbol)
    data["interval"] = _coerce_interval(data.get("interval"), interval)
    if data.get("status") not in ("preview", "committed"):
        data["status"] = "preview"
    if data.get("source") not in ("agent", "human"):
        data["source"] = "agent"
    data["confidence"] = _coerce_confidence(data.get("confidence", 0.7))
    low = _finite_float(data.get("priceLow"))
    high = _finite_float(data.get("priceHigh"))
    data["priceLow"] = low
    data["priceHigh"] = high
    if kind is not None:
        data["kind"] = kind
    data["points"] = points
    if data.get("agentId") is not None:
        data["agentId"] = str(data["agentId"])
    return {key: data[key] for key in _SHAPE_FIELDS if key in data}


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
    window: DrawingWindow | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Force preview status and return dropped ids. See `filter_preview_details` for reason codes."""
    valid, detailed = filter_preview_details(
        raw_shapes,
        allowed_times,
        symbol=symbol,
        interval=interval,
        window=window,
    )
    return valid, [shape_id for shape_id, _reason in detailed]


def filter_preview_details(
    raw_shapes: list[Any],
    allowed_times: set[int] | None = None,
    *,
    symbol: str | None = None,
    interval: str | None = None,
    window: DrawingWindow | None = None,
) -> tuple[list[dict[str, Any]], list[Drop]]:
    """Force preview status and return `(id, reason)` skips.

    Without `window`, every point must sit on `allowed_times` when that set is given.
    With `window`, one forward agent endpoint may extend past the last closed candle
    inside the interval k cap. Converging rails are dropped when that endpoint is later
    than their intersection plus 3 bars. Invalid shapes are skipped.
    """
    staged: list[dict[str, Any]] = []
    dropped: list[Drop] = []
    for raw in raw_shapes:
        if hasattr(raw, "model_dump"):
            data = raw.model_dump()
        elif isinstance(raw, dict):
            data = dict(raw)
        else:
            logger.info("schema reject field=shape msg=not an object")
            dropped.append(("?", "schema:shape"))
            continue
        data = coerce_agent_shape(
            data,
            symbol=symbol or str(data.get("symbol") or ""),
            interval=interval or str(data.get("interval") or ""),
        )
        data["status"] = "preview"
        try:
            validated = PatternShape.model_validate(data)
        except (ValidationError, ValueError) as exc:
            dropped.append((str(data.get("id", "?")), _schema_reason(exc)))
            continue
        dumped = _dump_omit_unset_agent_id(validated)
        if window is None and allowed_times is not None:
            if any(point.time not in allowed_times for point in validated.points):
                dropped.append((validated.id, "off-candle"))
                continue
        staged.append(dumped)
    if window is None:
        return staged, dropped
    if allowed_times is not None and window.allowed_times is None:
        window = replace(window, allowed_times=set(allowed_times))
    gated, gate_dropped = apply_preview_gate(staged, window)
    return gated, dropped + gate_dropped


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
