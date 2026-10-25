"""Detect researcher leak phrases in any string that could reach SSE."""

from __future__ import annotations

import re
import unicodedata

_LEAK_SUBSTRINGS: tuple[str, ...] = (
    "nen mua o 60k",
    "long o 60k",
    "l0ng",
    "entry 60k",
    "buy @ 65k",
    "target $70,000",
    "muc tieu 70k",
    "mục tiêu 70k",
    "dung lo 58k",
    "dừng lỗ 58k",
    "stop duoi 58k",
    "stop dưới 58k",
    "da tang sap bat dau",
    "đà tăng sắp bắt đầu",
    "gia co the but pha len 70k",
    "giá có thể bứt phá lên 70k",
    "bullish breakout imminent",
    "phe short yeu",
    "phe short yếu",
    "nên mua ở 60k",
    "mua ngay",
    "vượt đỉnh cũ",
    "phe mua đã kiểm soát",
)

_ZW_RE = re.compile(r"[\u200b-\u200f\ufeff]")


def normalize_for_leak_scan(text: str) -> str:
    folded = unicodedata.normalize("NFKC", text)
    folded = _ZW_RE.sub("", folded)
    folded = unicodedata.normalize("NFD", folded)
    stripped = "".join(ch for ch in folded if unicodedata.category(ch) != "Mn")
    return stripped.lower()


def contains_leak_phrase(text: str) -> bool:
    norm = normalize_for_leak_scan(text)
    for phrase in _LEAK_SUBSTRINGS:
        if normalize_for_leak_scan(phrase) in norm:
            return True
    return False


def sanitize_free_text(text: str | None, *, max_len: int = 64) -> str | None:
    if not text or not str(text).strip():
        return None
    if contains_leak_phrase(str(text)):
        return None
    return str(text).strip()[:max_len]
