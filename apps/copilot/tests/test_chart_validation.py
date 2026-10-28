"""Chart PUT validation (docs/CHART_HISTORY_SPEC.md): 422 `invalid_number` (NaN/Infinity),
`invalid_view_range`, `duplicate_shape_id`, `invalid_interval`, Vietnamese messages."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from cryptosignal_copilot import vi_text
from tests.test_chart_state import T0, _client, _session, _url, shape
from tests.test_chart_state import chart_app as _chart_app_fixture

chart_app = _chart_app_fixture
ERRORS_FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "api_errors.json"


def _raw(doc_text: str) -> dict:
    return {"content": doc_text.encode(), "headers": {"content-type": "application/json"}}


SHAPE_JSON = json.dumps(shape("a"))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "doc_text",
    [
        SHAPE_JSON.replace("100.0", "NaN", 1),
        SHAPE_JSON.replace("100.0", "Infinity", 1),
        SHAPE_JSON.replace("100.0", "-Infinity", 1),
        SHAPE_JSON.replace("100.0", "1e999", 1),
    ],
    ids=["nan", "inf", "-inf", "overflow"],
)
async def test_non_finite_numbers_are_invalid_number(chart_app, doc_text):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        res = await client.put(_url(sid), **_raw('{"shapes": [' + doc_text + "]}"))
        assert (await client.get(_url(sid))).status_code == 404
    assert res.status_code == 422, res.text
    assert res.json()["code"] == "invalid_number"
    assert res.json()["message"] == vi_text.ERR_INVALID_NUMBER


@pytest.mark.asyncio
async def test_view_from_after_to_is_invalid_view_range(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        bad = await client.put(_url(sid), json={"shapes": [], "view": {"from": T0 + 1, "to": T0}})
        same = await client.put(_url(sid), json={"shapes": [], "view": {"from": T0, "to": T0}})
    assert bad.status_code == 422
    assert bad.json()["code"] == "invalid_view_range"
    assert bad.json()["message"] == vi_text.ERR_INVALID_VIEW_RANGE
    assert bad.json()["detail"] == {"from": T0 + 1, "to": T0}
    assert same.status_code == 200


@pytest.mark.asyncio
async def test_duplicate_shape_ids(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        res = await client.put(
            _url(sid), json={"shapes": [shape("a"), shape("b"), shape("a", origin="user")]}
        )
    assert res.status_code == 422
    assert res.json()["code"] == "duplicate_shape_id"
    assert res.json()["message"] == vi_text.ERR_DUPLICATE_SHAPE_ID
    assert res.json()["detail"] == {"ids": ["a"]}


@pytest.mark.asyncio
async def test_malformed_json_is_still_422_invalid_chart_state(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        res = await client.put(_url(sid), **_raw('{"shapes": ['))
    assert res.status_code == 422
    assert res.json()["code"] == "invalid_chart_state"


@pytest.mark.asyncio
async def test_422_bodies_match_the_wire_fixture(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        nan = await client.put(_url(sid), **_raw('{"shapes": [], "view": {"from": NaN, "to": 1}}'))
        view = await client.put(_url(sid), json={"shapes": [], "view": {"from": 2, "to": 1}})
        dup = await client.put(_url(sid), json={"shapes": [shape("a"), shape("a")]})
        interval = await client.put(_url(sid, interval="2h"), json={"shapes": []})
    fixture = json.loads(ERRORS_FIXTURE.read_text())
    for code, res in [
        ("invalid_number", nan),
        ("invalid_view_range", view),
        ("duplicate_shape_id", dup),
        ("invalid_interval", interval),
    ]:
        assert fixture[code] == {"status": 422, "body": res.json()}, code


def test_stored_docs_never_contain_nan():
    import math

    from cryptosignal_copilot.chart_state import _serialize

    with pytest.raises(ValueError):
        _serialize({"shapes": [], "analysis": {"x": math.nan}})
