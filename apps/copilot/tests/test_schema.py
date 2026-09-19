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
