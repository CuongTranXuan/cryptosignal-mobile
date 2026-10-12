from __future__ import annotations

import json
import re

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


def parse_analyze_result_text(raw: str) -> AnalyzeResult:
    """Parse AnalyzeResult from plain-text model output (cursor-agent style)."""
    payload = json.loads(extract_json_text(raw))
    return AnalyzeResult.model_validate(payload)
