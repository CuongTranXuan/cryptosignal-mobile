from __future__ import annotations

import json
import re

from cryptosignal_copilot.drawing_intent import AnalyzeResultLlm
from cryptosignal_copilot.schema import AnalyzeResult

_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)


def extract_json_text(raw: str) -> str:
    """Pull JSON object text from model output, including ```json fences."""
    text = raw.strip()
    match = _FENCE_RE.search(text)
    if match:
        return match.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        return text[start : end + 1]
    return text


def parse_analyze_result_llm_text(raw: str) -> AnalyzeResultLlm:
    """Parse id-based LLM output from plain-text (cursor text_json style)."""
    payload = json.loads(extract_json_text(raw))
    if "shapes" in payload and "drawing_intents" not in payload:
        return AnalyzeResultLlm(
            pick_assessments=[],
            drawing_intents=[],
        )
    if "pick_notes" in payload or "summary" in payload or "markers" in payload:
        payload = {
            "pick_assessments": list(payload.get("pick_assessments") or []),
            "drawing_intents": list(payload.get("drawing_intents") or []),
        }
    return AnalyzeResultLlm.model_validate(payload)


def parse_analyze_result_text(raw: str) -> AnalyzeResult:
    """Parse AnalyzeResult from plain-text model output (cursor-agent style)."""
    payload = json.loads(extract_json_text(raw))
    return AnalyzeResult.model_validate(payload)
