"""Translate detector evidence strings for Vietnamese summaries."""

from __future__ import annotations

_EVIDENCE_VI: dict[str, str] = {
    "only 2 touches": "chỉ 2 lần chạm",
    "role from close: support": "vai trò theo giá đóng: hỗ trợ",
    "role from close: resistance": "vai trò theo giá đóng: kháng cự",
}


def evidence_to_vietnamese(text: str) -> str:
    key = text.strip()
    if key in _EVIDENCE_VI:
        return _EVIDENCE_VI[key]
    if key.startswith("role from close:"):
        role = key.split(":", 1)[-1].strip()
        if role == "support":
            return "vai trò theo giá đóng: hỗ trợ"
        if role == "resistance":
            return "vai trò theo giá đóng: kháng cự"
    return key
