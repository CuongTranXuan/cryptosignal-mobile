"""Copilot agent defaults to Vietnamese for chat-facing text."""

from cryptosignal_copilot.agent import INSTRUCTIONS, _build_user_prompt
from cryptosignal_copilot.schema import AnalyzeRequest


def test_instructions_require_vietnamese_summary():
    assert "Vietnamese" in INSTRUCTIONS or "Tiếng Việt" in INSTRUCTIONS
    assert "kind" in INSTRUCTIONS
    assert "PatternShape" in INSTRUCTIONS
    assert "Do not reply in English unless the user explicitly asks" in INSTRUCTIONS


def test_build_user_prompt_vietnamese_window_annotation():
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
    assert "CỬA SỔ PHÂN TÍCH CHÍNH" in prompt
    assert "from=100" in prompt and "to=200" in prompt
    assert "nến đã đóng" in prompt
    assert "Prompt người dùng: Tìm tam giác" in prompt
    assert "PRIMARY ANALYSIS WINDOW" not in prompt
    assert "closed candles" not in prompt
