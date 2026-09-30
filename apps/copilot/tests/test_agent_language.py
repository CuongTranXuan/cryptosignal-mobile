"""Copilot agent defaults to Vietnamese for chat-facing text; SSE progress is VI."""

from cryptosignal_copilot.agent import INSTRUCTIONS, _build_user_prompt
from cryptosignal_copilot.schema import AnalyzeRequest


def test_instructions_default_vietnamese_summary():
    assert "LANGUAGE:" in INSTRUCTIONS
    assert "Write `summary` and chat-facing text in Vietnamese by default" in INSTRUCTIONS
    assert "Do not reply in English unless the user explicitly asks for English" in INSTRUCTIONS
    # Must not default the model to English chat output.
    assert "English by default" not in INSTRUCTIONS
    assert "Only use Vietnamese if the user explicitly asks" not in INSTRUCTIONS
    # Soft VI scaffolding: avoid heavy Tiếng Việt phrases in the system prompt itself.
    assert "Tiếng Việt" not in INSTRUCTIONS
    assert "ALL chat-facing text in Vietnamese" not in INSTRUCTIONS
    assert "kind" in INSTRUCTIONS
    assert "PatternShape" in INSTRUCTIONS
    # OmniRoute 2026-09-19: no get_klines tool (custom-tool reject) — instructions
    # must not tell the model to call a klines tool that is not registered.
    assert "get_klines" not in INSTRUCTIONS
    assert "closedCandles" in INSTRUCTIONS


def test_instructions_encode_actionable_drawing_rules():
    assert "K=2" in INSTRUCTIONS and "K=3" in INSTRUCTIONS
    assert "1.5xATR(14)" in INSTRUCTIONS
    assert "oldest 35%" in INSTRUCTIONS
    assert ">= 8 bars" in INSTRUCTIONS
    assert ">= 15 bars" in INSTRUCTIONS
    assert "min-span" in INSTRUCTIONS
    assert "flat top" in INSTRUCTIONS
    assert "longer mate does not" in INSTRUCTIONS
    assert ">= 12 bars" in INSTRUCTIONS
    assert "0.55" in INSTRUCTIONS
    assert "0.7" in INSTRUCTIONS
    assert "at most 6" in INSTRUCTIONS
    assert "Fib 0.382" in INSTRUCTIONS
    assert "Fib pocket 0.5–0.618" in INSTRUCTIONS
    assert "upper" in INSTRUCTIONS and "lower" in INSTRUCTIONS
    assert "3*barSeconds" in INSTRUCTIONS
    assert "0.25xATR(14)" in INSTRUCTIONS
    assert "Do not claim entries, stops, or that a level will hold." in INSTRUCTIONS
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
    prompt = _build_user_prompt(req)
    assert "PRIMARY ANALYSIS WINDOW" in prompt
    assert "from=100" in prompt and "to=200" in prompt
    assert "closed candles" in prompt
    assert "User prompt: Tìm tam giác" in prompt
    # Vietnamese window headers must not be injected (agentrouter content-block risk).
    # Client prompts may still be VI; scaffolding stays English.
    assert "CỬA SỔ PHÂN TÍCH CHÍNH" not in prompt
    assert "nến đã đóng" not in prompt
    assert "Prompt người dùng" not in prompt
    assert "get_klines" not in prompt
    assert "PROJECTION GRID" in prompt
    assert "lastClosedCandleTime=100" in prompt
    assert "barSeconds=3600" in prompt
    assert "maxProjectBars=24" in prompt
    assert "3*barSeconds" in prompt
    assert "apexTime" in prompt
