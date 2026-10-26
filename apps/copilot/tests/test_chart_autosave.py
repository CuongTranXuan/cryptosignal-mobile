"""Analyze with a session_id saves the chart doc (docs/CHART_HISTORY_SPEC.md §Analyze):
pinned shapes and the view survive, unpinned AI shapes and markers are replaced, the
revision bumps and the final `meta` carries `chart_state_revision`.

Wire fixtures (shared with the web client), regenerated with
`python -m tests.test_chart_autosave` from apps/copilot:
- tests/fixtures/wire/chart_state.json        a doc with pinned and AI shapes
- tests/fixtures/wire/chart_index.json        GET .../charts
- tests/fixtures/wire/chart_conflict_409.json PUT with a stale revision
"""

from __future__ import annotations

import asyncio
import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from cryptosignal_copilot.chart_state import ChartStateStore
from cryptosignal_copilot.config import sqlite_url_for_path
from tests.test_chart_state import (
    INTERVAL,
    MIXED_DOC,
    SYMBOL,
    T0,
    Clock,
    ScriptedRunner,
    _client,
    _session,
    _url,
    shape,
)
from tests.test_chart_state import chart_app as _chart_app_fixture
from tests.test_wire_schema import WEB_ROOT, _require_web_zod

chart_app = _chart_app_fixture  # same pytest fixture as the CRUD tests

WIRE = Path(__file__).parent / "fixtures" / "wire"

ANALYZE_BASE = {
    "symbol": SYMBOL,
    "interval": INTERVAL,
    "from": T0,
    "to": T0 + 14400 * 10,
    "closedCandles": [
        {"time": T0 + i * 14400, "open": 1, "high": 2, "low": 1, "close": 2, "volume": 1}
        for i in range(11)
    ],
    "existingShapes": [],
    "prompt": "Phân tích",
}


def _events(text: str) -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = []
    for block in text.split("\n\n"):
        lines = block.strip().splitlines()
        if len(lines) >= 2 and lines[0].startswith("event: "):
            out.append((lines[0][7:], json.loads(lines[1][6:])))
    return out


@pytest.mark.asyncio
async def test_analyze_autosave_keeps_pinned_and_replaces_unpinned_ai(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        before = (await client.put(_url(sid), json=MIXED_DOC)).json()
        res = await client.post("/v1/copilot/analyze", json={**ANALYZE_BASE, "session_id": sid})
        assert res.status_code == 200
        events = _events(res.text)
        doc = (await client.get(_url(sid))).json()

    kinds = [k for k, _ in events]
    assert kinds[-2:] == ["meta", "done"]
    final_meta = events[-2][1]
    assert final_meta["chart_state_revision"] == before["revision"] + 1 == doc["revision"]
    assert final_meta["model"] == doc["model"] == "agentrouter/deepseek-v4-flash"

    # Pinned shapes survive untouched (the kept one wins over the rerun's same id);
    # the unpinned AI shape is replaced by the new run's shape.
    ids = [s["id"] for s in doc["shapes"]]
    assert ids == ["user-1", "ai-kept", "ai-edited", "ai-new-1"]
    kept = doc["shapes"][1]
    assert kept["kept"] is True and kept["name"] == "Support trendline"
    new = doc["shapes"][3]
    assert (new["origin"], new["kept"], new["edited"]) == ("ai", False, False)
    # Anchors: the pinned shape keeps its own; the dropped shape's anchor goes.
    assert [m["id"] for m in doc["markers"]] == ["anchor-ai-kept", "anchor-ai-new-1"]
    assert doc["markers"][0]["time"] == T0
    assert doc["view"] == MIXED_DOC["view"]
    assert doc["analysis"]["bias"] == "bullish"
    assert doc["summary_text"] == "Đang phân tích… Thiên hướng tăng."
    assert doc["analyzed_at"] is not None


@pytest.mark.asyncio
async def test_analyze_autosave_creates_the_doc(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        res = await client.post("/v1/copilot/analyze", json={**ANALYZE_BASE, "session_id": sid})
        doc = (await client.get(_url(sid))).json()
    assert _events(res.text)[-2][1]["chart_state_revision"] == 1 == doc["revision"]
    assert [s["id"] for s in doc["shapes"]] == ["ai-new-1", "ai-kept"]
    assert doc["view"] is None


@pytest.mark.asyncio
async def test_analyze_shapes_event_carries_flags(chart_app):
    async with _client(chart_app()) as client:
        sid = await _session(client)
        res = await client.post("/v1/copilot/analyze", json={**ANALYZE_BASE, "session_id": sid})
    shapes = next(d for k, d in _events(res.text) if k == "shapes")["shapes"]
    assert all((s["origin"], s["kept"], s["edited"]) == ("ai", False, False) for s in shapes)


@pytest.mark.asyncio
async def test_analyze_without_session_saves_nothing(chart_app):
    app = chart_app()
    async with _client(app) as client:
        sid = await _session(client)
        res = await client.post("/v1/copilot/analyze", json=ANALYZE_BASE)
        index = (await client.get(f"/v1/copilot/sessions/{sid}/charts")).json()
    assert all("chart_state_revision" not in d for k, d in _events(res.text) if k == "meta")
    assert index == {"charts": []}


@pytest.mark.asyncio
async def test_failed_analyze_saves_nothing(chart_app):
    async with _client(chart_app(ScriptedRunner(fail=True))) as client:
        sid = await _session(client)
        before = (await client.put(_url(sid), json=MIXED_DOC)).json()
        res = await client.post("/v1/copilot/analyze", json={**ANALYZE_BASE, "session_id": sid})
        doc = (await client.get(_url(sid))).json()
    assert all("chart_state_revision" not in d for k, d in _events(res.text) if k == "meta")
    assert doc == before


def test_real_runner_shapes_event_has_ai_flags(llm_env, monkeypatch):
    from tests.test_vi_leftovers import _run

    events = asyncio.run(_run("btcusdt_4h_200.json", "classic", monkeypatch))
    shapes = next(d for k, d in events if k == "shapes")["shapes"]
    assert shapes
    assert all((s["origin"], s["kept"], s["edited"]) == ("ai", False, False) for s in shapes)


# --------------------------------------------------------------------------- fixtures


async def _fixture_bodies(factory) -> dict[str, Any]:
    async with _client(factory()) as client:
        sid = await _session(client)
        await client.put(_url(sid), json=MIXED_DOC)
        await client.post("/v1/copilot/analyze", json={**ANALYZE_BASE, "session_id": sid})
        doc = (await client.get(_url(sid))).json()
        await client.put(_url(sid, SYMBOL, "30m"), json={"shapes": [shape("x", interval="30m")]})
        index = (await client.get(f"/v1/copilot/sessions/{sid}/charts")).json()
        conflict = await client.put(_url(sid), json={"shapes": [], "revision": 1})
    assert conflict.status_code == 409
    return {
        "chart_state.json": doc,
        "chart_index.json": index,
        "chart_conflict_409.json": conflict.json(),
    }


def _stable(value: Any) -> Any:
    """Timestamps vary per run; the wall-clock analyzed_at is normalised."""
    text = json.dumps(value, ensure_ascii=False)
    data = json.loads(text)

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            return {
                k: (0 if k in ("analyzed_at", "updated_at") and v is not None else walk(v))
                for k, v in node.items()
            }
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    return walk(data)


@pytest.mark.asyncio
async def test_real_bodies_match_wire_fixtures(chart_app):
    bodies = await _fixture_bodies(chart_app)
    for name, body in bodies.items():
        fixture = json.loads((WIRE / name).read_text())
        assert _stable(body) == _stable(fixture), name


ZOD_SCRIPT = """
import { readFileSync } from "node:fs";
import {
  ChartConflictBodySchema,
  ChartIndexResponseSchema,
  parseChartStateDoc,
} from "./lib/chart-state.ts";

const [docRaw, indexRaw, conflictRaw] = JSON.parse(readFileSync(0, "utf8"));
const doc = parseChartStateDoc(docRaw);
if (doc.shapes.length !== docRaw.shapes.length) throw new Error("shape dropped");
if (doc.markers.length !== docRaw.markers.length) throw new Error("marker dropped");
ChartIndexResponseSchema.parse(indexRaw);
ChartConflictBodySchema.parse(conflictRaw);
parseChartStateDoc(conflictRaw.current);
console.log("ok");
"""


def test_wire_fixtures_pass_web_chart_state_zod():
    _require_web_zod()
    if not (WEB_ROOT / "lib" / "chart-state.ts").is_file():
        pytest.skip("apps/web/lib/chart-state.ts not present yet (UI developer's module)")
    payload = [
        json.loads((WIRE / n).read_text())
        for n in ("chart_state.json", "chart_index.json", "chart_conflict_409.json")
    ]
    proc = subprocess.run(
        ["npx", "tsx", "-e", ZOD_SCRIPT],
        input=json.dumps(payload).encode(),
        cwd=WEB_ROOT,
        capture_output=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stderr.decode()[-2000:]


def _regenerate() -> None:  # pragma: no cover - manual
    import os
    import tempfile

    from cryptosignal_copilot.app import create_app
    from cryptosignal_copilot.model_catalog import ModelsCatalog
    from cryptosignal_copilot.model_probe import ModelProbeService
    from cryptosignal_copilot.sessions_store import reset_sessions_store_for_tests
    from tests.conftest import TEST_LLM_MODEL, _default_test_models
    from tests.probe_fixtures import all_ok_transport

    os.environ.update(
        {
            "LLM_API_STYLE": "openai",
            "LLM_BASE_URL": "http://127.0.0.1:20128/v1",
            "LLM_API_KEY": "sk-test",
            "LLM_MODEL": TEST_LLM_MODEL,
            "COPILOT_SKIP_HTF": "1",
        }
    )
    db = Path(tempfile.mkdtemp()) / "fixtures.sqlite3"
    os.environ["DATABASE_URL"] = sqlite_url_for_path(db)
    store = reset_sessions_store_for_tests(db)
    catalog = ModelsCatalog(fetch_models=_default_test_models)
    charts = ChartStateStore(database_url=store.database_url, clock=Clock())

    def factory(runner=None):
        return create_app(
            runner=runner or ScriptedRunner(),
            models_catalog=catalog,
            sessions_store=store,
            model_probe=ModelProbeService(catalog, transport=all_ok_transport()),
            chart_store=charts,
        )

    for name, body in asyncio.run(_fixture_bodies(factory)).items():
        (WIRE / name).write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n")
        print("wrote", WIRE / name)


if __name__ == "__main__":
    _regenerate()
