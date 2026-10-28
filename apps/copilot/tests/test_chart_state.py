"""Per-session chart history (docs/CHART_HISTORY_SPEC.md): CRUD, 404/409/413/422,
session cascade and the pinned-shape merge. Analyze auto-save: test_chart_autosave.py."""

from __future__ import annotations

import asyncio
import json
import subprocess
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, func, select, update

from cryptosignal_copilot.analyze_prep import AnalyzePlan
from cryptosignal_copilot.chart_state import (
    MAX_ANALYSIS_BYTES,
    MAX_MARKERS,
    MAX_SHAPES,
    ChartStateStore,
    merge_analysis_shapes,
)
from cryptosignal_copilot.config import sqlite_url_for_path
from cryptosignal_copilot.db.models import ChartStateRow, CopilotSessionRow
from tests.test_wire_schema import WEB_ROOT, _require_web_zod

WIRE = Path(__file__).parent / "fixtures" / "wire"
SYMBOL = "BTCUSDT"
INTERVAL = "4h"
T0 = 1_790_000_000  # a 4h boundary-ish unix second; only ordering matters here


class Clock:
    def __init__(self, now: float = 1_790_100_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        self.now += 1.0
        return self.now


def shape(
    sid: str,
    *,
    origin: str = "ai",
    kept: bool = False,
    edited: bool = False,
    name: str = "Support trendline",
    status: str = "committed",
    symbol: str = SYMBOL,
    interval: str = INTERVAL,
) -> dict[str, Any]:
    return {
        "id": sid,
        "symbol": symbol,
        "interval": interval,
        "kind": "trendline",
        "name": name,
        "status": status,
        "source": "human" if origin == "user" else "agent",
        "confidence": 0.7,
        "points": [{"time": T0, "price": 100.0}, {"time": T0 + 14400 * 10, "price": 110.0}],
        "priceLow": None,
        "priceHigh": None,
        "origin": origin,
        "kept": kept,
        "edited": edited,
    }


def anchor(drawing_id: str, t: int = T0) -> dict[str, Any]:
    return {
        "id": f"anchor-{drawing_id}",
        "symbol": SYMBOL,
        "interval": INTERVAL,
        "time": t,
        "side": "neutral",
        "position": "belowBar",
        "shape": "circle",
        "confidence": 0.7,
        "source": "agent",
        "drawing_id": drawing_id,
    }


MIXED_DOC = {
    "shapes": [
        shape("user-1", origin="user", name="Đường tôi vẽ"),
        shape("ai-kept", kept=True),
        shape("ai-edited", edited=True, name="Resistance trendline"),
        shape("ai-old", name="Double top neckline"),
    ],
    "markers": [anchor("ai-kept"), anchor("ai-old", T0 + 14400)],
    "analysis": {"bias": "neutral", "confidence": 0.55, "no_valid_pattern": False},
    "summary_text": "Phân tích cũ.",
    "view": {"from": T0 - 14400 * 50, "to": T0 + 14400 * 60},
}


class ScriptedRunner:
    """Two new AI shapes (one reusing an unpinned id), anchors, analysis, text."""

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail

    async def run(self, plan: AnalyzePlan):
        yield "text", {"delta": "Đang phân tích…"}
        if self.fail:
            yield "error", {"code": "provider_error", "message": "x"}
            yield "done", {}
            return
        new = [
            {k: v for k, v in shape("ai-new-1", status="preview").items() if k != "kept"},
            {**shape("ai-kept", status="preview"), "name": "Rerun of kept"},
        ]
        yield (
            "shapes",
            {"shapes": [{**s, "origin": "ai", "kept": False, "edited": False} for s in new]},
        )
        yield "analysis", {"bias": "bullish", "confidence": 0.7, "evidence_for": ["x"]}
        yield "text", {"delta": " Thiên hướng tăng."}
        yield "markers", {"markers": [anchor("ai-new-1"), anchor("ai-kept", T0 + 7 * 14400)]}
        yield "done", {}


@pytest.fixture
def chart_app(llm_env, tmp_path, monkeypatch, test_models_catalog):
    from cryptosignal_copilot.app import create_app
    from cryptosignal_copilot.model_probe import ModelProbeService
    from cryptosignal_copilot.sessions_store import reset_sessions_store_for_tests
    from tests.probe_fixtures import all_ok_transport

    db = tmp_path / "sessions.sqlite3"
    monkeypatch.setenv("DATABASE_URL", sqlite_url_for_path(db))
    store = reset_sessions_store_for_tests(db)
    clock = Clock()
    charts = ChartStateStore(database_url=store.database_url, clock=clock)

    def factory(runner=None):
        probe = ModelProbeService(test_models_catalog, transport=all_ok_transport())
        return create_app(
            runner=runner or ScriptedRunner(),
            models_catalog=test_models_catalog,
            sessions_store=store,
            model_probe=probe,
            chart_store=charts,
        )

    factory.db_url = store.database_url  # type: ignore[attr-defined]
    return factory


SESSION = {
    "title": "BTC",
    "model_id": "agentrouter/deepseek-v4-flash",
    "chart": {"symbol": SYMBOL, "interval": INTERVAL, "from": 1, "to": 2, "candle_count": 100},
}


async def _session(client: AsyncClient) -> str:
    res = await client.post("/v1/copilot/sessions", json=SESSION)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _url(sid: str, symbol: str = SYMBOL, interval: str = INTERVAL) -> str:
    return f"/v1/copilot/sessions/{sid}/charts/{symbol}/{interval}"


def _client(app) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


DOC_KEYS = {
    "symbol",
    "interval",
    "revision",
    "updated_at",
    "shapes",
    "markers",
    "analysis",
    "summary_text",
    "model",
    "analyzed_at",
    "view",
    "chart_state_revision",
}


@pytest.mark.asyncio
async def test_crud_round_trip(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        created = await client.put(_url(sid, "btcusdt"), json=MIXED_DOC)
        assert created.status_code == 200, created.text
        doc = created.json()
        assert set(doc) == DOC_KEYS
        assert doc["symbol"] == SYMBOL  # uppercased from the path
        assert doc["revision"] == doc["chart_state_revision"] == 1
        assert [s["id"] for s in doc["shapes"]] == ["user-1", "ai-kept", "ai-edited", "ai-old"]
        assert doc["view"] == MIXED_DOC["view"]
        assert doc["model"] is None and doc["analyzed_at"] is None

        got = await client.get(_url(sid))
        assert got.status_code == 200 and got.json() == doc

        updated = await client.put(_url(sid), json={"shapes": doc["shapes"][:2], "revision": 1})
        assert updated.status_code == 200, updated.text
        up = updated.json()
        assert up["revision"] == up["chart_state_revision"] == 2
        assert len(up["shapes"]) == 2
        # Omitted fields keep their stored value; explicit null clears.
        assert up["analysis"] == MIXED_DOC["analysis"] and up["view"] == MIXED_DOC["view"]
        cleared = await client.put(
            _url(sid), json={"shapes": [], "analysis": None, "view": None, "revision": 2}
        )
        assert cleared.json()["analysis"] is None and cleared.json()["view"] is None

        index = (await client.get(f"/v1/copilot/sessions/{sid}/charts")).json()
        assert index == {
            "charts": [
                {
                    "symbol": SYMBOL,
                    "interval": INTERVAL,
                    "updated_at": cleared.json()["updated_at"],
                    "revision": 3,
                    "analyzed_at": None,
                    "shape_count": 0,
                    "has_analysis": False,
                }
            ]
        }

        deleted = await client.delete(_url(sid))
        assert deleted.status_code == 200 and deleted.json() == {"ok": True}
        missing = await client.get(_url(sid))
        assert missing.status_code == 404
        assert missing.json()["code"] == "chart_state_not_found"
        assert (await client.delete(_url(sid))).status_code == 404
        # Recreate after delete starts over at revision 1.
        again = await client.put(_url(sid), json={"shapes": []})
        assert again.json()["revision"] == 1


@pytest.mark.asyncio
async def test_index_newest_first(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        for interval in ("1h", "30m", "4h"):
            res = await client.put(_url(sid, SYMBOL, interval), json={"shapes": []})
            assert res.status_code == 200, res.text
        await client.put(_url(sid, SYMBOL, "1h"), json={"shapes": [], "revision": 1})
        charts = (await client.get(f"/v1/copilot/sessions/{sid}/charts")).json()["charts"]
    assert [c["interval"] for c in charts] == ["1h", "4h", "30m"]
    assert charts[0]["revision"] == 2


@pytest.mark.asyncio
async def test_unknown_session_is_404_everywhere(chart_app):
    async with _client(chart_app()) as client:
        sid = "no-such-session"
        for res in (
            await client.get(f"/v1/copilot/sessions/{sid}/charts"),
            await client.get(_url(sid)),
            await client.put(_url(sid), json={"shapes": []}),
            await client.delete(_url(sid)),
        ):
            assert res.status_code == 404
            assert res.json() == {"error": "session not found"}


@pytest.mark.asyncio
async def test_get_with_nothing_saved_is_404(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        res = await client.get(_url(sid))
        index = await client.get(f"/v1/copilot/sessions/{sid}/charts")
    assert res.status_code == 404 and res.json()["code"] == "chart_state_not_found"
    assert index.json() == {"charts": []}


@pytest.mark.asyncio
async def test_conflict_on_mismatched_revision(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        first = (await client.put(_url(sid), json=MIXED_DOC)).json()
        stale = await client.put(_url(sid), json={"shapes": [], "revision": 7})
    assert stale.status_code == 409
    body = stale.json()
    assert body["code"] == "revision_conflict"
    assert body["current"] == first  # the stored doc, unchanged


@pytest.mark.asyncio
async def test_conflict_when_creating_over_an_existing_doc(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        first = (await client.put(_url(sid), json=MIXED_DOC)).json()
        again = await client.put(_url(sid), json={"shapes": []})  # no revision
    assert again.status_code == 409
    assert again.json()["code"] == "revision_conflict"
    assert again.json()["current"]["revision"] == first["revision"] == 1


@pytest.mark.asyncio
async def test_revision_on_a_missing_doc_is_404(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        res = await client.put(_url(sid), json={"shapes": [], "revision": 1})
    assert res.status_code == 404 and res.json()["code"] == "chart_state_not_found"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("body", "field", "limit"),
    [
        ({"shapes": [shape(f"s{i}") for i in range(MAX_SHAPES + 1)]}, "shapes", MAX_SHAPES),
        (
            {"shapes": [], "markers": [anchor(f"d{i}") for i in range(MAX_MARKERS + 1)]},
            "markers",
            MAX_MARKERS,
        ),
        (
            {"shapes": [], "analysis": {"blob": "x" * MAX_ANALYSIS_BYTES}},
            "analysis_bytes",
            MAX_ANALYSIS_BYTES,
        ),
    ],
    ids=["shapes", "markers", "analysis"],
)
async def test_too_large_is_413(chart_app, body, field, limit):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        res = await client.put(_url(sid), json=body)
        missing = await client.get(_url(sid))
    assert res.status_code == 413
    assert res.json()["code"] == "chart_state_too_large"
    assert (res.json()["field"], res.json()["limit"]) == (field, limit)
    assert missing.status_code == 404  # nothing written


@pytest.mark.asyncio
async def test_limits_are_inclusive(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        res = await client.put(
            _url(sid), json={"shapes": [shape(f"s{i}") for i in range(MAX_SHAPES)]}
        )
    assert res.status_code == 200, res.text


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["get", "put", "delete"])
async def test_unknown_interval_is_422(chart_app, method):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        kwargs = {"json": {"shapes": []}} if method == "put" else {}
        res = await getattr(client, method)(_url(sid, SYMBOL, "2h"), **kwargs)
    assert res.status_code == 422
    assert res.json()["code"] == "invalid_interval"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"markers": []}, "invalid_chart_state"),
        ({"shapes": [{"id": "x"}]}, "invalid_chart_state"),
        ({"shapes": [], "view": {"from": "a", "to": 1}}, "invalid_chart_state"),
        ({"shapes": [], "unknown": 1}, "invalid_chart_state"),
        ({"shapes": [shape("s1", symbol="ETHUSDT")]}, "chart_key_mismatch"),
        ({"shapes": [shape("s1", interval="1h")]}, "chart_key_mismatch"),
    ],
)
async def test_invalid_body_is_422(chart_app, body, code):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        res = await client.put(_url(sid), json=body)
    assert res.status_code == 422, res.text
    assert res.json()["code"] == code


@pytest.mark.asyncio
async def test_flags_default_from_source_for_older_clients(chart_app):
    legacy = [
        {
            k: v
            for k, v in shape("h1", origin="user").items()
            if k not in ("origin", "kept", "edited")
        },
        {k: v for k, v in shape("a1").items() if k not in ("origin", "kept", "edited")},
    ]
    async with _client(chart_app()) as client:
        sid = await _session(client)
        doc = (await client.put(_url(sid), json={"shapes": legacy})).json()
    assert [(s["origin"], s["kept"], s["edited"]) for s in doc["shapes"]] == [
        ("user", False, False),
        ("ai", False, False),
    ]


@pytest.mark.asyncio
async def test_session_delete_cascades_to_charts(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        other = await _session(client)
        for interval in ("1h", "4h"):
            await client.put(_url(sid, SYMBOL, interval), json={"shapes": []})
        await client.put(_url(other), json={"shapes": []})
        assert (await client.delete(f"/v1/copilot/sessions/{sid}")).status_code == 200
        after = await client.get(f"/v1/copilot/sessions/{sid}/charts")
        kept = await client.get(_url(other))
    assert after.status_code == 404
    assert kept.status_code == 200
    engine = create_engine(chart_app.db_url)
    with engine.connect() as conn:
        rows = conn.execute(
            select(func.count()).select_from(ChartStateRow).where(ChartStateRow.session_id == sid)
        ).scalar()
    assert rows == 0


@pytest.mark.asyncio
async def test_session_eviction_cascades_to_charts(chart_app, monkeypatch):
    import cryptosignal_copilot.sessions_store as sessions_store

    monkeypatch.setattr(sessions_store, "MAX_SESSIONS", 2)
    engine = create_engine(chart_app.db_url)
    async with _client(chart_app()) as client:
        first = await _session(client)
        await client.put(_url(first), json={"shapes": []})
        await _session(client)
        with engine.begin() as conn:  # make `first` the oldest (whole-second timestamps)
            conn.execute(
                update(CopilotSessionRow)
                .where(CopilotSessionRow.id == first)
                .values(updated_at=0.0)
            )
        await _session(client)  # evicts `first`
        gone = await client.get(f"/v1/copilot/sessions/{first}")
    assert gone.status_code == 404
    with engine.connect() as conn:
        assert conn.execute(select(func.count()).select_from(ChartStateRow)).scalar() == 0


def test_merge_is_pure_and_dedupes():
    cur = [shape("u", origin="user"), shape("a")]
    marks = [anchor("u"), anchor("a")]
    shapes, markers = merge_analysis_shapes(cur, marks, [shape("u"), shape("b")], [anchor("u")])
    assert [s["id"] for s in shapes] == ["u", "b"]
    assert [m["id"] for m in markers] == ["anchor-u"]
    assert [s["id"] for s in cur] == ["u", "a"]  # inputs untouched
