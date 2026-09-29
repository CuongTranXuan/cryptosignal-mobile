import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from cryptosignal_copilot.schema import AgentMarker, PatternShape, filter_agent_markers

FIXTURE = Path(__file__).resolve().parents[3] / "packages" / "schema" / "pattern-shape.fixture.json"
MARKER_FIXTURE = Path(__file__).resolve().parents[3] / "packages" / "schema" / "agent-marker.fixture.json"


def test_fixture_parses():
    data = json.loads(FIXTURE.read_text())
    shape = PatternShape.model_validate(data)
    assert shape.kind == "polyline"
    assert len(shape.points) == 3
    assert shape.agentId is None


def test_accepts_optional_agent_id():
    data = json.loads(FIXTURE.read_text())
    data["agentId"] = "agent-alpha"
    shape = PatternShape.model_validate(data)
    assert shape.agentId == "agent-alpha"


def test_rejects_order_keys():
    data = json.loads(FIXTURE.read_text())
    data["side"] = "BUY"
    with pytest.raises(ValidationError):
        PatternShape.model_validate(data)


def test_agent_marker_fixture_parses():
    data = json.loads(MARKER_FIXTURE.read_text())
    marker = AgentMarker.model_validate(data)
    assert marker.side == "buy"
    assert marker.position == "belowBar"
    assert marker.shape == "arrowUp"
    assert marker.agentId is None


def test_agent_marker_accepts_signal_side_not_order_keys():
    data = json.loads(MARKER_FIXTURE.read_text())
    marker = AgentMarker.model_validate({**data, "side": "sell", "agentId": "agent-beta"})
    assert marker.side == "sell"
    assert marker.agentId == "agent-beta"
    with pytest.raises(ValidationError):
        AgentMarker.model_validate({**data, "quantity": 1})
    with pytest.raises(ValidationError):
        AgentMarker.model_validate({**data, "side": "BUY"})


def test_filter_agent_markers_drops_invalid_and_out_of_window():
    data = json.loads(MARKER_FIXTURE.read_text())
    valid, dropped = filter_agent_markers(
        [
            {**data, "id": "ok", "time": 1},
            {**data, "id": "bad-side", "side": "BUY"},
            {**data, "id": "off-window", "time": 99},
        ],
        allowed_times={1, 2},
    )
    assert [m["id"] for m in valid] == ["ok"]
    assert dropped == ["bad-side", "off-window"]
    assert "agentId" not in valid[0]


def test_coerce_llm_sloppy_polyline_into_pattern_shape():
    from cryptosignal_copilot.schema import coerce_agent_shape, filter_preview_shapes
    raw = {
        "type": "polyline",
        "label": "Sym triangle upper",
        "color": "#ef5350",
        "points": [
            {"time": 100, "price": 1},
            {"time": 200, "price": 2},
            {"time": 300, "price": 3},
        ],
    }
    valid, dropped = filter_preview_shapes(
        [raw], {100, 200, 300}, symbol="BTCUSDT", interval="1h"
    )
    assert dropped == []
    assert len(valid) == 1
    assert valid[0]["kind"] == "polyline"
    assert valid[0]["name"] == "Sym triangle upper"
    assert valid[0]["source"] == "agent"


def test_coerce_maps_aliases_and_future_float_time():
    from cryptosignal_copilot.schema import coerce_agent_shape

    shape = coerce_agent_shape(
        {
            "type": "polyline",
            "label": "Ascending triangle upper",
            "color": "#ff0000",
            "description": "extra field that used to fail extra=forbid",
            "confidence": 80,
            "source": "llm",
            "points": [
                [1_700_000_000, 140],
                {"time": 1_700_000_000 + 6 * 900.0, "price": "136.5"},
            ],
        },
        symbol="BTCUSDT",
        interval="15m",
    )
    assert shape["kind"] == "trendline"
    assert shape["name"] == "Ascending triangle upper"
    assert shape["confidence"] == 0.8
    assert shape["source"] == "agent"
    assert "description" not in shape
    assert shape["points"] == [
        {"time": 1_700_000_000, "price": 140.0},
        {"time": 1_700_000_000 + 6 * 900, "price": 136.5},
    ]


def test_schema_reason_names_the_field():
    from cryptosignal_copilot.schema import filter_preview_details

    _valid, dropped = filter_preview_details(
        [
            {
                "id": "one-point",
                "type": "trendline",
                "label": "Broken",
                "points": [{"time": 1, "price": 1}],
            },
            {"id": "bad-kind", "kind": "not-a-shape", "name": "X", "points": [[1, 1], [2, 2]]},
        ],
        symbol="BTCUSDT",
        interval="15m",
    )
    assert dropped == [("one-point", "schema:points"), ("bad-kind", "schema:kind")]


def test_smoke_ascending_triangle_rails_are_not_schema_dropped():
    """Payloads shaped like the live smoke must clear coerce. A future k=6 endpoint stays."""
    from cryptosignal_copilot.drawing_gate import DrawingWindow
    from cryptosignal_copilot.schema import Candle, filter_preview_details

    bar = 900
    start = 1_700_000_000
    n = 40

    def ts(index: int) -> int:
        return start + index * bar

    def on_line(index: int, i1: int, p1: float, i2: int, p2: float) -> float:
        return p1 + (p2 - p1) * (index - i1) / (i2 - i1)

    rows: list[Candle] = []
    wicks = {10: (100.0, 140.0), 30: (102.0, 138.0)}
    for index in range(n):
        low, high = wicks.get(index, (110.0, 120.0))
        mid = (low + high) / 2
        rows.append(Candle(time=ts(index), open=mid, high=high, low=low, close=mid, volume=1.0))
    forward = n - 1 + 6
    rails = [
        {
            "id": "tri-asc-lower-btcusdt-15m",
            "type": "trendline",
            "label": "Ascending triangle lower",
            "description": "rising lows",
            "color": "#26a69a",
            "confidence": "0.72",
            "points": [
                {"time": float(ts(10)), "price": 100},
                {"t": ts(forward) + 0.2, "p": on_line(forward, 10, 100.0, 30, 102.0)},
            ],
        },
        {
            "id": "tri-asc-upper-btcusdt-15m",
            "kind": "Trendline",
            "name": "Ascending triangle upper",
            "note": "flat-ish highs",
            "source": "model",
            "points": [
                [ts(10), 140],
                {"timestamp": (ts(forward)) * 1000, "value": on_line(forward, 10, 140.0, 30, 138.0)},
            ],
        },
    ]
    valid, dropped = filter_preview_details(
        rails,
        {row.time for row in rows},
        symbol="BTCUSDT",
        interval="15m",
        window=DrawingWindow(
            candles=rows,
            interval="15m",
            allowed_times={row.time for row in rows},
        ),
    )
    assert not any(reason.startswith("schema") for _shape_id, reason in dropped), dropped
    assert {shape["id"] for shape in valid} == {
        "tri-asc-lower-btcusdt-15m",
        "tri-asc-upper-btcusdt-15m",
    }
    for shape in valid:
        assert shape["kind"] == "trendline"
        assert len(shape["points"]) == 2
        assert max(point["time"] for point in shape["points"]) == ts(forward)
