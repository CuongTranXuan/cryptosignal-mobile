"""Vietnamese user-facing text, keyed by detector codes (C.14 i18n at the source).

Detectors emit the `EV_*` evidence strings directly; candidate/shape `name`s stay
canonical English ids (LLM prompt, web `displayShapeName`, stable shape hashes)
and are rendered for users through `pattern_name_vi`, a closed table that covers
every name the detectors can produce (tests assert no name falls through).
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from cryptosignal_copilot.market_price import format_market_price

# --------------------------------------------------------------------------- coded text
#
# Every evidence line and invalidation condition that reaches the client is also sent
# as `{code, params, text}`: `code` is stable snake_case, `params` holds numbers/strings,
# `text` is the Vietnamese sentence (the same string kept in the legacy string arrays).
# Detectors emit the Vietnamese text; `evidence_item` maps it back to its code, so there
# is one table per code and no parallel bookkeeping. Codes are listed in
# docs/CHART_AI_SPEC.md (C.16 coded text).

_ROLE_VI = {"support": "hỗ trợ", "resistance": "kháng cự"}
_VI_ROLE = {v: k for k, v in _ROLE_VI.items()}

EV_NECKLINE_NOT_BROKEN = "chưa phá đường viền cổ"
EV_PATTERN_COMPLETED = "mô hình đã hoàn tất"
EV_NO_STRUCTURAL_WARNING = "Không có cảnh báo cấu trúc trên các hình đã chọn"
EV_NO_CATALOG = "Không có danh mục ứng viên"
EV_REGIME_FROM_CLOSED = "Chế độ thị trường xác định từ nến đã đóng"
EV_HIGHER_HIGHS_LOWS = "Đỉnh/đáy cao hơn trên các nhịp sóng gần đây"
EV_LOWER_HIGHS_LOWS = "Đỉnh/đáy thấp hơn trên các nhịp sóng gần đây"
EV_PRICE_ABOVE_EMA = "Giá trên EMA50, độ dốc EMA20 dương"
EV_PRICE_BELOW_EMA = "Giá dưới EMA50, độ dốc EMA20 âm"
EV_ATR_ELEVATED = "ATR cao so với trung vị gần đây"
EV_MIXED_STRUCTURE = "Cấu trúc đỉnh/đáy hỗn hợp, chưa rõ xu hướng"


def ev_few_touches(n: int) -> str:
    return f"chỉ {n} lần chạm"


def ev_few_top_touches(n: int) -> str:
    return f"chỉ {n} lần chạm đỉnh"


def ev_few_bottom_touches(n: int) -> str:
    return f"chỉ {n} lần chạm đáy"


def ev_role_flip(role: str) -> str:
    return f"đổi vai theo giá đóng cửa: nay là {_ROLE_VI.get(role, role)}"


def ev_atr(period: int, value_label: str) -> str:
    return f"Biên độ dao động ATR{period} ≈ {value_label}"


EV_ONLY_TWO_TOUCHES = ev_few_touches(2)
EV_ONLY_TWO_TOPS = ev_few_top_touches(2)
EV_ONLY_TWO_BOTTOMS = ev_few_bottom_touches(2)

_NUM = r"(-?\d[\d,]*(?:\.\d+)?)"


def _num(raw: str) -> int | float:
    value = float(raw.replace(",", ""))
    return int(value) if value.is_integer() and "." not in raw else value


# (code, regex over the Vietnamese text, params from the match). Legacy English detector
# strings (stored sessions, older guardrails) are matched too and re-rendered in Vietnamese.
_EVIDENCE_CODES: tuple[
    tuple[str, re.Pattern[str], Callable[[re.Match[str]], dict[str, Any]]], ...
] = (
    (
        "few_touches",
        re.compile(r"chỉ (\d+) lần chạm|only (\d+) touches"),
        lambda m: {"n": int(m.group(1) or m.group(2))},
    ),
    (
        "few_top_touches",
        re.compile(r"chỉ (\d+) lần chạm đỉnh(?: swing)?|only (\d+) swing touches on tops"),
        lambda m: {"n": int(m.group(1) or m.group(2))},
    ),
    (
        "few_bottom_touches",
        re.compile(r"chỉ (\d+) lần chạm đáy(?: swing)?|only (\d+) swing touches on bottoms"),
        lambda m: {"n": int(m.group(1) or m.group(2))},
    ),
    (
        "role_from_close",
        re.compile(r"đổi vai theo giá đóng cửa: nay là (hỗ trợ|kháng cự)"),
        lambda m: {"role": _VI_ROLE[m.group(1)]},
    ),
    (
        "role_from_close",
        re.compile(r"role from close: (support|resistance)"),
        lambda m: {"role": m.group(1)},
    ),
    (
        "neckline_not_broken",
        re.compile(r"chưa phá đường viền cổ|neckline not broken"),
        lambda m: {},
    ),
    ("pattern_completed", re.compile(r"mô hình đã hoàn tất|pattern completed"), lambda m: {}),
    ("no_structural_warning", re.compile(re.escape(EV_NO_STRUCTURAL_WARNING)), lambda m: {}),
    ("no_catalog", re.compile(re.escape(EV_NO_CATALOG)), lambda m: {}),
    ("regime_from_closed", re.compile(re.escape(EV_REGIME_FROM_CLOSED)), lambda m: {}),
    ("higher_highs_lows", re.compile(re.escape(EV_HIGHER_HIGHS_LOWS)), lambda m: {}),
    ("lower_highs_lows", re.compile(re.escape(EV_LOWER_HIGHS_LOWS)), lambda m: {}),
    ("price_above_ema", re.compile(re.escape(EV_PRICE_ABOVE_EMA)), lambda m: {}),
    ("price_below_ema", re.compile(re.escape(EV_PRICE_BELOW_EMA)), lambda m: {}),
    ("atr_elevated", re.compile(re.escape(EV_ATR_ELEVATED)), lambda m: {}),
    ("mixed_structure", re.compile(re.escape(EV_MIXED_STRUCTURE)), lambda m: {}),
    (
        "atr_value",
        re.compile(r"(?:Biên độ dao động )?ATR(\d+) ≈ " + _NUM),
        lambda m: {"period": int(m.group(1)), "value": _num(m.group(2))},
    ),
)
EVIDENCE_CODES = tuple(dict.fromkeys(code for code, _rx, _p in _EVIDENCE_CODES))

_RENDER: dict[str, Callable[[dict[str, Any], re.Match[str]], str]] = {
    "few_touches": lambda p, m: ev_few_touches(p["n"]),
    "few_top_touches": lambda p, m: ev_few_top_touches(p["n"]),
    "few_bottom_touches": lambda p, m: ev_few_bottom_touches(p["n"]),
    "role_from_close": lambda p, m: ev_role_flip(p["role"]),
    "neckline_not_broken": lambda p, m: EV_NECKLINE_NOT_BROKEN,
    "pattern_completed": lambda p, m: EV_PATTERN_COMPLETED,
    "atr_value": lambda p, m: ev_atr(p["period"], m.group(2)),
}


def evidence_item(text: str) -> dict[str, Any]:
    """`{code, params, text}` for one evidence line; unknown text → code `note`."""
    raw = text.strip()
    for code, rx, params_of in _EVIDENCE_CODES:
        match = rx.fullmatch(raw)
        if match:
            params = params_of(match)
            render = _RENDER.get(code)
            return {
                "code": code,
                "params": params,
                "text": render(params, match) if render else raw,
            }
    return {"code": "note", "params": {}, "text": raw}


def localize_evidence(text: str) -> str:
    """Vietnamese text for an evidence line (legacy English detector strings included)."""
    return str(evidence_item(text)["text"])


def evidence_items(lines: list[str]) -> list[dict[str, Any]]:
    return [evidence_item(line) for line in lines]


# --------------------------------------------------------------------------- regime / bias

_REGIME_VI = {
    "trend_up": "xu hướng tăng",
    "trend_down": "xu hướng giảm",
    "range": "đi ngang",
    "volatile": "biến động mạnh",
}


def regime_vi(regime: str) -> str:
    return _REGIME_VI.get(regime, "đi ngang")


BIAS_CONFLICT_VI = (
    "Thiên kiến người dùng không khớp chế độ thị trường phát hiện; lớp phủ theo chế độ thị trường."
)


# --------------------------------------------------------------------------- invalidation

INVALIDATION_CODES = ("close_above", "close_below", "close_beyond")
_CONDITION_VI = {
    "close_above": "đóng cửa trên",
    "close_below": "đóng cửa dưới",
    "close_beyond": "đóng cửa vượt",
}


def condition_code(condition: str | None) -> str:
    key = (condition or "close_beyond").strip().lower().replace(" ", "_")
    return key if key in _CONDITION_VI else "close_beyond"


def invalidation_text_vi(condition: str | None, price_label: str) -> str:
    """e.g. `đóng cửa trên 87,299.13`."""
    return f"{_CONDITION_VI[condition_code(condition)]} {price_label}"


# --------------------------------------------------------------------------- gate reasons

GATE_REASON_VI: dict[str, str] = {
    "low-conf": "độ tin cậy thấp",
    "ancient": "quá cũ",
    "beyond-k": "ngoài cửa sổ nến",
    "apex+3": "quá đỉnh tam giác",
    "no-candles": "không có nến",
    "min-span": "quá ngắn",
    "near-vertical": "gần thẳng đứng",
    "non-wick": "không chạm râu nến",
    "not-swing": "không phải đỉnh/đáy",
    "single-touch": "chỉ 1 lần chạm",
    "triangle-polyline": "tam giác sai dạng",
    "unpaired-triangle": "tam giác thiếu cạnh",
    "triangle-structure": "cấu trúc tam giác sai",
    "fib-no-C": "Fibonacci thiếu điểm C",
    "fib-not-horizontal": "Fibonacci không nằm ngang",
    "cap": "vượt giới hạn 6 hình",
    "gate-error": "lỗi kiểm tra",
    "off-grid": "lệch lưới thời gian",
    "off-candle": "không khớp nến",
    "before-window": "trước cửa sổ phân tích",
    "interval-mismatch": "sai khung thời gian",
    "no-anchor": "thiếu điểm neo",
    "zone-without-time": "vùng thiếu mốc thời gian",
    "mixed-side": "lẫn đỉnh và đáy",
    "multiple-future": "nhiều điểm tương lai",
    "future-not-endpoint": "điểm tương lai không ở cuối",
    "human-future": "hình vẽ tay có điểm tương lai",
    "impulse": "thiếu nhịp đẩy giữa các lần chạm",
    "kind": "loại hình không hỗ trợ",
}
SCHEMA_REASON_VI = "sai cấu trúc dữ liệu"


def gate_reason_vi(reason: str) -> str:
    """Vietnamese label for a gate drop code (`schema:<field>` codes share one label)."""
    if reason.startswith("schema:"):
        return SCHEMA_REASON_VI
    return GATE_REASON_VI.get(reason, "không hợp lệ")


# --------------------------------------------------------------------------- pattern names

_NAME_VI: dict[str, str] = {
    "Resistance trendline": "Đường xu hướng kháng cự",
    "Support trendline": "Đường xu hướng hỗ trợ",
    "Double top": "Hai đỉnh",
    "Double top neckline": "Đường viền cổ hai đỉnh",
    "Double bottom": "Hai đáy",
    "Double bottom neckline": "Đường viền cổ hai đáy",
    "Liquidity highs": "Thanh khoản trên các đỉnh",
    "Liquidity lows": "Thanh khoản dưới các đáy",
    "Ascending triangle": "Tam giác tăng",
    "Descending triangle": "Tam giác giảm",
    "Symmetrical triangle": "Tam giác cân",
    "Channel (high rail)": "Kênh giá (biên trên)",
    "Channel (low rail)": "Kênh giá (biên dưới)",
    "Channel high rail": "Biên trên kênh giá",
    "Channel low rail": "Biên dưới kênh giá",
    "Head and shoulders": "Vai đầu vai",
    "H&S neckline": "Đường viền cổ vai đầu vai",
    "Inverse H&S": "Vai đầu vai ngược",
    "Inverse H&S neckline": "Đường viền cổ vai đầu vai ngược",
    "Fib retracement": "Fibonacci thoái lui",
    "Fib pocket 0.5–0.618": "Vùng Fibonacci 0.5–0.618",
    "Bullish FVG": "FVG tăng",
    "Bearish FVG": "FVG giảm",
    "BOS bullish": "BOS tăng",
    "BOS bearish": "BOS giảm",
    "BOS level": "Mức BOS",
    "CHoCH bullish": "CHoCH tăng",
    "CHoCH bearish": "CHoCH giảm",
    "Bullish order block": "Khối lệnh tăng",
    "Bearish order block": "Khối lệnh giảm",
    "Order block": "Khối lệnh",
}
_RAIL_VI = {"upper": "cạnh trên", "lower": "cạnh dưới"}
_SR_RE = re.compile(r"^S/R (?:(support|resistance) \(flipped\) )?(.+)$")
_FIB_RE = re.compile(r"^Fib (0\.\d+)$")
_RAIL_RE = re.compile(r"^(.+) (upper|lower)$")


def pattern_name_vi(name: str) -> str | None:
    """Vietnamese display name, or None when the name is not a known detector name."""
    if name in _NAME_VI:
        return _NAME_VI[name]
    match = _SR_RE.match(name)
    if match:
        role, price = match.groups()
        if role is None:
            return f"Vùng hỗ trợ/kháng cự {price}"
        return f"Vùng {_ROLE_VI[role]} (đổi vai) {price}"
    match = _FIB_RE.match(name)
    if match:
        return f"Fibonacci {match.group(1)}"
    match = _RAIL_RE.match(name)
    if match and match.group(1) in _NAME_VI:
        return f"{_NAME_VI[match.group(1)]} ({_RAIL_VI[match.group(2)]})"
    return None


def display_name_vi(name: str) -> str:
    """User-facing name; unknown names (e.g. human drawings) pass through unchanged."""
    return pattern_name_vi(name) or name


# --------------------------------------------------------------------------- wire localization


def localize_invalidation(inv: dict[str, Any], symbol: str) -> dict[str, Any]:
    """Add `code`/`params`/`text` to an invalidation dict (keeps `price`/`condition`)."""
    if inv.get("price") is None:
        return inv
    price = float(inv["price"])
    code = condition_code(inv.get("condition"))
    return {
        **inv,
        "code": code,
        "params": {"price": price},
        "text": invalidation_text_vi(code, format_market_price(price, symbol)),
    }


def localize_guardrail(guard: dict[str, Any], symbol: str) -> dict[str, Any]:
    """Vietnamese `evidence_against` + coded `evidence_against_items` + coded invalidation."""
    lines = [
        localize_evidence(x) for x in guard.get("evidence_against") or [] if isinstance(x, str)
    ]
    out = {**guard, "evidence_against": lines, "evidence_against_items": evidence_items(lines)}
    inv = guard.get("invalidation")
    if isinstance(inv, dict):
        out["invalidation"] = localize_invalidation(inv, symbol)
    return out


# --------------------------------------------------------------------------- API errors

ERR_REQUEST_TOO_LARGE = "Yêu cầu quá lớn"
ERR_DB_UNAVAILABLE = "Cơ sở dữ liệu tạm thời không khả dụng, vui lòng thử lại sau"
_TOO_LARGE_VI = {
    "shapes": "Biểu đồ có quá nhiều hình vẽ",
    "markers": "Biểu đồ có quá nhiều điểm đánh dấu",
    "points": "Một hình vẽ có quá nhiều điểm",
    "string_bytes": "Nhãn hoặc nội dung quá dài",
    "summary_text_bytes": "Tóm tắt phân tích quá dài",
    "analysis_bytes": "Dữ liệu phân tích quá lớn",
    "doc_bytes": "Lịch sử biểu đồ vượt giới hạn lưu",
    "charts": "Phiên này đã lưu đủ số biểu đồ cho phép",
}


def chart_too_large_vi(field: str) -> str:
    return _TOO_LARGE_VI.get(field, _TOO_LARGE_VI["doc_bytes"])
