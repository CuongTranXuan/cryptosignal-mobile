"""Size caps (docs/CHART_HISTORY_SPEC.md "Limits"): raw body 413 `request_too_large`,
doc/shape/point/string/chart-count 413 `chart_state_too_large` with `field` + `limit`."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlalchemy import create_engine, update

from cryptosignal_copilot import chart_state
from cryptosignal_copilot.db.models import ChartStateRow
from tests.test_chart_autosave import ANALYZE_BASE, _events
from tests.test_chart_state import _client, _session, _url, anchor, shape
from tests.test_chart_state import chart_app as _chart_app_fixture

chart_app = _chart_app_fixture


def _assert_413(res, code: str, field: str, limit: int) -> None:
    assert res.status_code == 413, res.text
    body = res.json()
    assert (body["code"], body["field"], body["limit"]) == (code, field, limit)
    assert body["message"]  # Vietnamese, from vi_text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("doc", "field", "limit"),
    [
        (
            {"shapes": [{**shape("p"), "points": [{"time": 1, "price": 1.0}] * 501}]},
            "points",
            chart_state.MAX_POINTS_PER_SHAPE,
        ),
        (
            {"shapes": [shape("s", name="x" * (chart_state.MAX_STRING_BYTES + 1))]},
            "string_bytes",
            chart_state.MAX_STRING_BYTES,
        ),
        (
            {"shapes": [], "markers": [{**anchor("a"), "text": "é" * 1025}]},
            "string_bytes",
            chart_state.MAX_STRING_BYTES,
        ),
        (
            {"shapes": [], "summary_text": "x" * (chart_state.MAX_SUMMARY_TEXT_BYTES + 1)},
            "summary_text_bytes",
            chart_state.MAX_SUMMARY_TEXT_BYTES,
        ),
    ],
    ids=["points", "shape-string", "marker-string-utf8", "summary_text"],
)
async def test_put_caps(chart_app, doc, field, limit):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        res = await client.put(_url(sid), json=doc)
        assert (await client.get(_url(sid))).status_code == 404
    _assert_413(res, "chart_state_too_large", field, limit)


@pytest.mark.asyncio
async def test_caps_are_inclusive(chart_app):
    doc = {
        "shapes": [
            {
                **shape("p", name="x" * chart_state.MAX_STRING_BYTES),
                "kind": "polyline",
                "points": [{"time": i, "price": 1.0} for i in range(500)],
            }
        ],
        "summary_text": "x" * chart_state.MAX_SUMMARY_TEXT_BYTES,
    }
    async with _client(chart_app()) as client:
        sid = await _session(client)
        res = await client.put(_url(sid), json=doc)
    assert res.status_code == 200, res.text


@pytest.mark.asyncio
async def test_total_doc_cap(chart_app, monkeypatch):
    monkeypatch.setattr(chart_state, "MAX_DOC_BYTES", 4000)
    async with _client(chart_app()) as client:
        sid = await _session(client)
        res = await client.put(_url(sid), json={"shapes": [shape(f"s{i}") for i in range(20)]})
    _assert_413(res, "chart_state_too_large", "doc_bytes", 4000)


@pytest.mark.asyncio
async def test_charts_per_session_cap(chart_app, monkeypatch):
    monkeypatch.setattr(chart_state, "MAX_CHARTS_PER_SESSION", 2)
    async with _client(chart_app()) as client:
        sid = await _session(client)
        for interval in ("1h", "4h"):
            body = {"shapes": [shape("a", interval=interval)]}
            assert (await client.put(_url(sid, interval=interval), json=body)).status_code == 200
        third = await client.put(_url(sid, interval="1d"), json={"shapes": []})
        # Updating an existing chart is still fine at the cap.
        again = await client.put(_url(sid, interval="1h"), json={"shapes": [], "revision": 1})
    _assert_413(third, "chart_state_too_large", "charts", 2)
    assert again.status_code == 200


@pytest.mark.asyncio
async def test_autosave_cap_reports_field_and_limit(chart_app, monkeypatch):
    monkeypatch.setattr(chart_state, "MAX_SUMMARY_TEXT_BYTES", 5)
    async with _client(chart_app()) as client:
        sid = await _session(client)
        res = await client.post("/v1/copilot/analyze", json={**ANALYZE_BASE, "session_id": sid})
    final = _events(res.text)[-2][1]
    assert final["chart_state_error"] == "chart_state_too_large"
    assert (final["field"], final["limit"]) == ("summary_text_bytes", 5)


@pytest.mark.asyncio
async def test_raw_body_cap(chart_app, monkeypatch):
    monkeypatch.setenv("COPILOT_MAX_BODY_BYTES", "2000")
    app = chart_app()
    big = json.dumps({"shapes": [], "summary_text": "x" * 3000}).encode()

    async def chunks():
        for i in range(0, len(big), 500):
            yield big[i : i + 500]

    async with _client(app) as client:
        sid = await _session(client)
        sized = await client.put(_url(sid), content=big)
        chunked = await client.put(_url(sid), content=chunks())
        analyze = await client.post("/v1/copilot/analyze", content=big)
        small = await client.put(_url(sid), json={"shapes": []})
    for res in (sized, chunked, analyze):
        _assert_413(res, "request_too_large", "body_bytes", 2000)
    assert small.status_code == 200


def test_body_cap_default_is_1_5_mib(monkeypatch):
    from cryptosignal_copilot.body_limit import max_body_bytes_from_env

    monkeypatch.delenv("COPILOT_MAX_BODY_BYTES", raising=False)
    assert max_body_bytes_from_env() == 1536 * 1024


@pytest.mark.asyncio
async def test_index_reads_metadata_columns_not_the_doc(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        doc = {"shapes": [shape("a"), shape("b")], "analysis": {"bias": "neutral"}}
        assert (await client.put(_url(sid), json=doc)).status_code == 200
        engine = create_engine(chart_app.db_url)
        with engine.begin() as conn:
            conn.execute(update(ChartStateRow).values(doc="not json"))
        engine.dispose()
        index = (await client.get(f"/v1/copilot/sessions/{sid}/charts")).json()["charts"]
    assert [(e["shape_count"], e["has_analysis"]) for e in index] == [(2, True)]


ERRORS_FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "api_errors.json"


@pytest.mark.asyncio
async def test_413_bodies_match_the_wire_fixture(chart_app, monkeypatch):
    monkeypatch.setenv("COPILOT_MAX_BODY_BYTES", "100000")
    async with _client(chart_app()) as client:
        sid = await _session(client)
        doc = await client.put(_url(sid), json={"shapes": [shape(f"s{i}") for i in range(201)]})
        raw = await client.put(_url(sid), content=b"x" * 100_001)
    fixture = json.loads(ERRORS_FIXTURE.read_text())
    assert fixture["chart_state_too_large"] == {"status": 413, "body": doc.json()}
    assert fixture["request_too_large"] == {"status": 413, "body": raw.json()}
