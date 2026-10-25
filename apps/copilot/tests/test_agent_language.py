"""Copilot agent defaults to Vietnamese for chat-facing text; SSE progress is VI."""

from cryptosignal_copilot.agent import INSTRUCTIONS, _build_user_prompt
from cryptosignal_copilot.analyze_prep import AnalyzePlan
from cryptosignal_copilot.model_catalog import normalize_model_row
from cryptosignal_copilot.schema import AnalyzeRequest


def test_instructions_default_vietnamese_summary():
    assert "Vietnamese" in INSTRUCTIONS
    assert "drawing_intents" in INSTRUCTIONS
    assert "candidate_id" in INSTRUCTIONS
    assert "get_klines" not in INSTRUCTIONS


def test_instructions_encode_actionable_drawing_rules():
    assert "Max 6" in INSTRUCTIONS or "Max 6" in INSTRUCTIONS.replace("max", "Max")
    assert "Do not promise entries" in INSTRUCTIONS or "Do not claim entries" in INSTRUCTIONS
    assert "feature sheet" in INSTRUCTIONS
    assert "get_klines" not in INSTRUCTIONS


def test_build_user_prompt_english_window_annotation(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    req = AnalyzeRequest.model_validate(
        {
            "symbol": "BTCUSDT",
            "interval": "1h",
            "from": 100,
            "to": 200,
            "closedCandles": [
                {"time": 100, "open": 1, "high": 2, "low": 1, "close": 2, "volume": 1}
            ],
            "existingShapes": [],
            "prompt": "Tìm tam giác",
        }
    )
    model = normalize_model_row({"id": "agentrouter/deepseek-v4-flash", "owned_by": "agentrouter"})
    plan = AnalyzePlan(
        model_id=model.id,
        model=model,
        request=req,
        meta={
            "feature_sheet": {"atr14": 1.0, "swings": []},
            "candidates": [],
        },
        model_settings={},
        reasoning_effort=None,
        candle_count_requested=None,
        candle_count_used=1,
    )
    prompt = _build_user_prompt(req, plan=plan)
    assert "WINDOW from=100" in prompt and "to=200" in prompt
    assert "User prompt (read last): Tìm tam giác" in prompt
    assert "Context JSON" in prompt
    assert "CỬA SỔ PHÂN TÍCH CHÍNH" not in prompt
    assert "get_klines" not in prompt
    assert "PROJECTION GRID" in prompt
    assert "lastClosedCandleTime=100" in prompt
