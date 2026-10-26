/**
 * Dev-only stub copilot (FakeRunner) for local E2E without real LLM keys.
 * Run from repo root: node apps/web/scripts/run-copilot-stub.mjs
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const copilotDir = path.join(root, "apps/copilot");

const py = `
import os, tempfile
from pathlib import Path
os.environ.setdefault("LLM_API_STYLE", "openai")
os.environ.setdefault("LLM_BASE_URL", "http://127.0.0.1:20128/v1")
os.environ.setdefault("LLM_API_KEY", "sk-test")
os.environ.setdefault("LLM_MODEL", "agentrouter/deepseek-v4-flash")
os.environ.setdefault("COPILOT_RUN_DB_MIGRATIONS", "true")
# The fake key cannot pass a live probe; keep the catalog unprobed so the UI can send.
os.environ.setdefault("COPILOT_MODEL_PROBE_ENABLED", "false")
from cryptosignal_copilot.config import sqlite_url_for_path
db = Path(tempfile.gettempdir()) / "cryptosignal-copilot-e2e.sqlite3"
os.environ["DATABASE_URL"] = sqlite_url_for_path(db)

from cryptosignal_copilot.app import create_app
from cryptosignal_copilot.model_catalog import ModelsCatalog
from cryptosignal_copilot.sessions_store import reset_sessions_store_for_tests
from cryptosignal_copilot.analyze_prep import AnalyzePlan
from cryptosignal_copilot.chart_real_path import run_real_path, simulate_llm_top_intents
from cryptosignal_copilot.chart_response import aggregate_skipped
from cryptosignal_copilot.analysis_events import build_regime_event, build_analysis_event
from tests.omniroute_fixtures import omniroute_models_payload
import time as _time

# Chart history (docs/CHART_HISTORY_SPEC.md): in-memory stand-in, used only when the app
# has no /charts routes (the real backend autosaves analyze runs itself). Pinned = origin user || kept || edited.
CHART_DOCS = {}
STUB_CHARTS = False  # set below when the app has no /charts routes (pre chart-history backend)
CHART_INTERVALS = {"1m", "15m", "30m", "1h", "4h", "1d"}

def _chart_key(sid, symbol, interval):
    return (sid, symbol.upper(), interval)

def _pinned(shape):
    return shape.get("origin") == "user" or bool(shape.get("kept")) or bool(shape.get("edited"))

def chart_save_run(sid, symbol, interval, ai_shapes, markers, analysis, model):
    key = _chart_key(sid, symbol, interval)
    cur = CHART_DOCS.get(key) or {}
    pins = [x for x in cur.get("shapes", []) if _pinned(x)]
    pin_ids = {x["id"] for x in pins}
    shapes = pins + [x for x in ai_shapes if x["id"] not in pin_ids]
    keep_markers = [m for m in cur.get("markers", []) if m.get("drawing_id") in pin_ids]
    now = _time.time()
    doc = {
        "symbol": symbol.upper(), "interval": interval,
        "revision": int(cur.get("revision", 0)) + 1, "updated_at": now,
        "shapes": shapes, "markers": keep_markers + list(markers),
        "analysis": analysis, "summary_text": "Stub: " + str(len(ai_shapes)) + " hình mới",
        "model": model, "analyzed_at": int(now), "view": cur.get("view"),
    }
    CHART_DOCS[key] = doc
    return doc

class FakeRunner:
    async def run(self, plan: AnalyzePlan):
        request = plan.request
        catalog = plan.candidate_catalog
        style = (request.intent.style if request.intent else "classic") or "classic"
        intent_check = (plan.meta or {}).get("intent_check") or {}
        meta = dict(plan.meta or {})
        prompt = (request.prompt or "").strip()

        if prompt == "e2e empty shapes only":
            yield "text", {
                "delta": (
                    f"Đang phân tích {request.symbol} {request.interval} "
                    f"({len(request.closedCandles)} nến đã đóng)…\\n\\n"
                ),
            }
            if catalog is not None:
                yield "regime", build_regime_event(
                    catalog,
                    intent_check,
                    htf=meta.get("htf"),
                )
            yield "text", {"delta": "Mô hình đã xong. Đang dựng lớp phủ…"}
            yield "text", {
                "delta": (
                    "\\n\\nKhông có mô hình hợp lệ trên cửa sổ này.\\n\\n"
                    "Đây không phải tín hiệu vào lệnh; chỉ mô tả geometry trên nến đã đóng."
                ),
            }
            yield "shapes", {"shapes": [], "skipped": [], "skipped_count": 0}
            if catalog is not None:
                yield "analysis", build_analysis_event(
                    catalog,
                    [],
                    intent_check,
                    symbol=request.symbol,
                )
            else:
                yield "analysis", {
                    "bias": "neutral",
                    "no_valid_pattern": True,
                    "evidence_for": [],
                    "evidence_against": [],
                    "invalidation": None,
                    "confidence": None,
                    "intent_check": intent_check,
                }
            yield "done", {}
            return

        yield "text", {
            "delta": f"Stub LLM ({len(request.closedCandles)} nến) — chọn nhiều mẫu để kiểm tra giới hạn 6 hình…\\n\\n",
        }

        if catalog is not None:
            yield "regime", build_regime_event(
                catalog,
                intent_check,
                htf=meta.get("htf"),
            )

        if catalog is None:
            yield "shapes", {"shapes": [], "skipped": [], "skipped_count": 0}
            yield "analysis", {
                "bias": "neutral",
                "no_valid_pattern": True,
                "evidence_for": [],
                "evidence_against": [],
                "invalidation": None,
                "confidence": None,
                "intent_check": intent_check,
            }
            yield "done", {}
            return

        intents = simulate_llm_top_intents(catalog, style, max_intents=12)
        wire_shapes, metrics = run_real_path(
            catalog,
            request.closedCandles,
            symbol=request.symbol,
            interval=request.interval,
            style=style,
            intents=intents,
        )
        # Like agent.py: every streamed AI shape carries the chart-history flags.
        wire_shapes = [{**x, "origin": "ai", "kept": False, "edited": False} for x in wire_shapes]

        yield "text", {"delta": "Mô hình đã xong. Đang dựng lớp phủ…"}
        yield "text", {"delta": "\\n\\nStub server summary (C.11).\\n"}

        dropped_for_skip = [("", "cap") for _ in range(metrics.cap_dropped)]
        for reason, count in metrics.gate_reasons.items():
            dropped_for_skip.extend([("", reason)] * count)
        skipped, skipped_count = aggregate_skipped(dropped_for_skip)

        yield "shapes", {
            "shapes": wire_shapes,
            "skipped": skipped,
            "skipped_count": skipped_count,
        }
        run_analysis = build_analysis_event(
            catalog,
            wire_shapes,
            intent_check,
        )
        yield "analysis", run_analysis
        if wire_shapes:
            names = ", ".join(str(s.get("name", "?")) for s in wire_shapes[:3])
            more = f" (+{len(wire_shapes) - 3} nữa)" if len(wire_shapes) > 3 else ""
            yield "text", {
                "delta": f"\\n\\nLớp phủ sẵn sàng: {len(wire_shapes)} — {names}{more}.",
            }

        anchor_markers = []
        for s in wire_shapes:
            sid = str(s.get("id") or "")
            if not sid:
                continue
            pts = s.get("points") or []
            time_val = int(pts[0]["time"]) if pts else 0
            anchor_markers.append(
                {
                    "id": f"anchor-{sid}",
                    "symbol": request.symbol,
                    "interval": request.interval,
                    "time": time_val,
                    "side": "neutral",
                    "position": "inBar",
                    "shape": "circle",
                    "label": "Neo",
                    "confidence": float(s.get("confidence", 0.7)),
                    "source": "agent",
                    "drawing_id": sid,
                    "guardrail": s.get("guardrail"),
                }
            )
        if anchor_markers:
            yield "markers", {"markers": anchor_markers}

        final_meta = dict(meta)
        final_meta["intent_budget_fallback"] = True
        final_meta["preview_shape_budget"] = 6
        if STUB_CHARTS and request.session_id:
            saved = chart_save_run(
                request.session_id, request.symbol, request.interval,
                wire_shapes, anchor_markers, run_analysis, meta.get("model"),
            )
            final_meta["chart_state_revision"] = saved["revision"]
        yield "meta", final_meta
        yield "done", {}

async def _fetch_models(_cfg):
    return omniroute_models_payload()
catalog = ModelsCatalog(fetch_models=_fetch_models)
catalog.clear_cache()
store = reset_sessions_store_for_tests(db)
app = create_app(runner=FakeRunner(), models_catalog=catalog, sessions_store=store)

STUB_CHARTS = not any("/charts" in str(getattr(r, "path", "")) for r in app.routes)
if STUB_CHARTS:
    from fastapi import Request
    from fastapi.responses import JSONResponse

    def _bad_interval(interval):
        if interval not in CHART_INTERVALS:
            return JSONResponse({"code": "invalid_interval"}, status_code=422)
        return None

    @app.get("/v1/copilot/sessions/{sid}/charts")
    async def stub_list_charts(sid: str):
        rows = [
            {
                "symbol": d["symbol"], "interval": d["interval"], "updated_at": d["updated_at"],
                "revision": d["revision"], "analyzed_at": d["analyzed_at"],
                "shape_count": len(d["shapes"]), "has_analysis": d["analysis"] is not None,
            }
            for (s, _sym, _tf), d in CHART_DOCS.items() if s == sid
        ]
        rows.sort(key=lambda r: r["updated_at"], reverse=True)
        return {"charts": rows}

    @app.get("/v1/copilot/sessions/{sid}/charts/{symbol}/{interval}")
    async def stub_get_chart(sid: str, symbol: str, interval: str):
        bad = _bad_interval(interval)
        if bad:
            return bad
        doc = CHART_DOCS.get(_chart_key(sid, symbol, interval))
        if doc is None:
            return JSONResponse({"code": "chart_state_not_found"}, status_code=404)
        return doc

    @app.put("/v1/copilot/sessions/{sid}/charts/{symbol}/{interval}")
    async def stub_put_chart(sid: str, symbol: str, interval: str, request: Request):
        bad = _bad_interval(interval)
        if bad:
            return bad
        body = await request.json()
        shapes = body.get("shapes") or []
        markers = body.get("markers") or []
        if len(shapes) > 200 or len(markers) > 300:
            return JSONResponse(
                {"code": "chart_state_too_large", "limit": {"shapes": 200, "markers": 300}},
                status_code=413,
            )
        key = _chart_key(sid, symbol, interval)
        cur = CHART_DOCS.get(key)
        rev = body.get("revision")
        if (cur is None and rev is not None) or (cur is not None and rev != cur["revision"]):
            if cur is None:
                return JSONResponse({"code": "chart_state_not_found"}, status_code=404)
            return JSONResponse({"code": "revision_conflict", "current": cur}, status_code=409)
        base = cur or {}
        doc = {
            "symbol": symbol.upper(), "interval": interval,
            "revision": int(base.get("revision", 0)) + 1, "updated_at": _time.time(),
            "shapes": shapes, "markers": markers,
            "analysis": body.get("analysis", base.get("analysis")),
            "summary_text": body.get("summary_text", base.get("summary_text")),
            "model": base.get("model"), "analyzed_at": base.get("analyzed_at"),
            "view": body.get("view", base.get("view")),
        }
        CHART_DOCS[key] = doc
        return {**doc, "chart_state_revision": doc["revision"]}

    @app.delete("/v1/copilot/sessions/{sid}/charts/{symbol}/{interval}")
    async def stub_delete_chart(sid: str, symbol: str, interval: str):
        CHART_DOCS.pop(_chart_key(sid, symbol, interval), None)
        return {"ok": True}
import uvicorn
uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
`;

const child = spawn("python3", ["-c", py], {
  cwd: copilotDir,
  env: { ...process.env, PYTHONPATH: `${copilotDir}/src:${copilotDir}` },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
