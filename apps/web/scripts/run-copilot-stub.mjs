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
from cryptosignal_copilot import intent_prep as _intent_prep

_orig_build_intent_check = _intent_prep.build_intent_check

def _e2e_build_intent_check(request, intent):
    out = _orig_build_intent_check(request, intent)
    if intent.bias == "bullish":
        return {
            **out,
            "detected_regime": "trend_down",
            "bias_conflict": True,
            "message": "Xu hướng tăng trái với chế độ giảm (stub e2e).",
        }
    return out

_intent_prep.build_intent_check = _e2e_build_intent_check

from cryptosignal_copilot.app import create_app
from cryptosignal_copilot.model_catalog import ModelsCatalog
from cryptosignal_copilot.sessions_store import reset_sessions_store_for_tests
from cryptosignal_copilot.analyze_prep import AnalyzePlan
from cryptosignal_copilot.chart_real_path import run_real_path
from cryptosignal_copilot.chart_response import aggregate_skipped
from tests.omniroute_fixtures import omniroute_models_payload

class FakeRunner:
    async def run(self, plan: AnalyzePlan):
        request = plan.request
        yield "text", {"delta": "Phân tích mẫu hình (stub). "}
        catalog = plan.candidate_catalog
        style = (request.intent.style if request.intent else "classic") or "classic"
        intent_check = (plan.meta or {}).get("intent_check") or {}
        regime = str(intent_check.get("detected_regime") or "range")
        yield "regime", {"regime": regime, "intent_check": intent_check}
        if catalog is None:
            yield "shapes", {"shapes": [], "skipped": [], "skipped_count": 0}
            yield "analysis", {"bias": "neutral", "no_valid_pattern": True, "intent_check": intent_check}
            yield "done", {}
            return
        wire_shapes, metrics = run_real_path(
            catalog,
            request.closedCandles,
            symbol=request.symbol,
            interval=request.interval,
            style=style,
        )
        dropped_for_skip = [("", "cap") for _ in range(metrics.cap_dropped)]
        for reason, count in metrics.gate_reasons.items():
            dropped_for_skip.extend([("", reason)] * count)
        skipped, skipped_count = aggregate_skipped(dropped_for_skip)
        yield "shapes", {
            "shapes": wire_shapes,
            "skipped": skipped,
            "skipped_count": skipped_count,
        }
        bias = (request.intent.bias if request.intent else None) or "neutral"
        yield "analysis", {
            "bias": bias,
            "no_valid_pattern": len(wire_shapes) == 0,
            "evidence_for": [],
            "evidence_against": [],
            "invalidation": None,
            "confidence": None,
            "intent_check": intent_check,
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
