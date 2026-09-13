import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from cryptosignal_copilot.schema import PatternShape

FIXTURE = Path(__file__).resolve().parents[3] / "packages" / "schema" / "pattern-shape.fixture.json"


def test_fixture_parses():
    data = json.loads(FIXTURE.read_text())
    shape = PatternShape.model_validate(data)
    assert shape.kind == "polyline"
    assert len(shape.points) == 3


def test_rejects_order_keys():
    data = json.loads(FIXTURE.read_text())
    data["side"] = "BUY"
    with pytest.raises(ValidationError):
        PatternShape.model_validate(data)
