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
from cryptosignal_copilot.config import sqlite_url_for_path
db = Path(tempfile.gettempdir()) / "cryptosignal-copilot-e2e.sqlite3"
os.environ["DATABASE_URL"] = sqlite_url_for_path(db)
from cryptosignal_copilot.app import create_app
from cryptosignal_copilot.model_catalog import ModelsCatalog
from cryptosignal_copilot.sessions_store import reset_sessions_store_for_tests
from cryptosignal_copilot.analyze_prep import AnalyzePlan
from cryptosignal_copilot.chart_response import aggregate_skipped, enrich_shapes_with_guardrails
from cryptosignal_copilot.schema import PatternShape
from tests.omniroute_fixtures import omniroute_models_payload

class FakeRunner:
    async def run(self, plan: AnalyzePlan):
        request = plan.request
        yield "text", {"delta": "Phân tích mẫu hình (stub). "}
        candles = request.closedCandles
        t0 = candles[0].time if candles else 1
        t1 = candles[-1].time if candles else t0
        shape = PatternShape(
            id="s1",
            symbol=request.symbol,
            interval=request.interval,
            kind="trendline",
            name="Test line",
            status="preview",
            source="agent",
            confidence=0.7,
            points=[{"time": t0, "price": 2}, {"time": t1, "price": 4}],
            priceLow=None,
            priceHigh=None,
        )
        regime = str((plan.meta or {}).get("intent_check", {}).get("detected_regime") or "range")
        enriched, _anchors = enrich_shapes_with_guardrails(
            [shape.model_dump()],
            regime=regime,
            symbol=request.symbol,
            interval=request.interval,
        )
        skipped, skipped_count = aggregate_skipped([("s1", "low-conf")])
        yield "shapes", {
            "shapes": enriched,
            "skipped": skipped,
            "skipped_count": skipped_count,
        }
        yield "done", {}

async def _fetch_models(_cfg):
    return omniroute_models_payload()
catalog = ModelsCatalog(fetch_models=_fetch_models)
catalog.clear_cache()
store = reset_sessions_store_for_tests(db)
app = create_app(runner=FakeRunner(), models_catalog=catalog, sessions_store=store)
import uvicorn
uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
`;

const child = spawn("python3", ["-c", py], {
  cwd: copilotDir,
  env: { ...process.env, PYTHONPATH: `${copilotDir}/src:${copilotDir}` },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
