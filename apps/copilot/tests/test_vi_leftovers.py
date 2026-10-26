"""C.16: user-facing backend text is Vietnamese at the source, and every evidence line /
invalidation carries a stable `{code, params, text}`.

Runs the real runner with a scripted model over all 16 replay fixtures (classic + SMC)
and scans everything the analysis panel and summary show: SSE `text` deltas, the
`analysis` event, shape/marker guardrails, and the per-shape Vietnamese `labels` map
of the `shapes` event. Canonical shape `name`s stay English ids by contract (`labels`
carries the display text), so `name` itself is not scanned.

Also covered: the rules path (no LLM call), Elliott/Wyckoff intent messages, every gate
drop code, and a source scan for the English templates that used to ship.
"""

from __future__ import annotations

import ast
import dataclasses
import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic_ai import Agent

from cryptosignal_copilot.agent import PydanticAiRunner
from cryptosignal_copilot.drawing_gate import format_drop_note
from cryptosignal_copilot.drawing_intent import (
    AnalyzeResultLlm,
    PickAssessment,
    build_deterministic_fallback,
    enrich_resolved_shapes,
    resolve_drawing_intents,
)
from cryptosignal_copilot.intent_prep import build_intent_check
from cryptosignal_copilot.schema import AnalyzeIntent
from cryptosignal_copilot.vi_text import (
    EVIDENCE_CODES,
    GATE_REASON_VI,
    INVALIDATION_CODES,
    evidence_item,
    localize_guardrail,
)
from tests.test_n12_validator_fallback import _plan_from_fixture

FIXTURES = sorted(p.name for p in (Path(__file__).parent / "fixtures" / "ohlcv").glob("*.json"))

# English words that used to leak into the Vietnamese panel/summary. Acronyms and
# product terms (ATR, EMA, HTF, FVG, BOS, CHoCH, SMC, Fibonacci, symbols) are fine.
ENGLISH = re.compile(
    r"\b(only|touch(?:es)?|role|from|close|closes|neckline|broken|pattern|completed|"
    r"support|resistance|flipped|detector|overlay|range|bias|pick|picks|geometry|sideway|"
    r"swing|swings|tops?|bottoms?|double|triangle|channel|rail|head|shoulders|inverse|"
    r"order|block|bullish|bearish|liquidity|highs|lows|level|trendline|retracement|"
    r"pocket|upper|lower|fallback|catalog|candidate|style|marker|shape|beyond|the|and|"
    r"with|not|has|live|use|when|nothing|fits|LLM)\b|\b[a-z]+_[a-z_]+\b",
    re.IGNORECASE,
)


def _scripted_output(catalog: Any, style: str) -> AnalyzeResultLlm:
    picks = build_deterministic_fallback(catalog, style)
    ids = [
        intent.candidate_id if intent.type == "candidate" else intent.candidate_ids[0]
        for intent in picks.drawing_intents
    ]
    return AnalyzeResultLlm(
        pick_assessments=[
            PickAssessment(
                candidate_id=cid,
                quality="ok",
                confluence=["htf_level", "fib", "order_block", "structure"],
                touch_ack=True,
            )
            for cid in ids
        ],
        drawing_intents=picks.drawing_intents,
    )


async def _run(
    fixture: str, style: str, monkeypatch, *, rules: bool = False
) -> list[tuple[str, dict]]:
    plan = _plan_from_fixture(fixture, candle_count=200)
    plan.request.intent.style = style  # type: ignore[union-attr]
    catalog = plan.candidate_catalog
    if rules:
        # Rules-first path: shapes from the top picks, no model call at all.
        picks = build_deterministic_fallback(catalog, style)
        shapes, _ = resolve_drawing_intents(picks.drawing_intents, catalog)
        last = float(plan.request.closedCandles[-1].close)
        step = dataclasses.replace(
            plan.intent_step,
            use_llm=False,
            rule_shapes=enrich_resolved_shapes(shapes, catalog, last_close=last),
            rule_intents=list(picks.drawing_intents),
            intent_source="rules",
        )
        plan = dataclasses.replace(plan, intent_step=step)

    async def scripted(self, prompt, model_settings=None):
        return SimpleNamespace(output=_scripted_output(catalog, style))

    monkeypatch.setattr(Agent, "run", scripted)
    return [ev async for ev in PydanticAiRunner().run(plan)]


def _guard_texts(guard: dict[str, Any]) -> list[str]:
    out = [str(x) for x in guard.get("evidence_against") or []]
    out += [str(i["text"]) for i in guard.get("evidence_against_items") or []]
    inv = guard.get("invalidation") or {}
    if inv.get("text"):
        out.append(str(inv["text"]))
    return out


def _user_texts(events: list[tuple[str, dict]]) -> list[str]:
    texts: list[str] = []
    for kind, data in events:
        if kind == "text":
            texts.append(data["delta"])
        elif kind == "analysis":
            for key in ("evidence_for", "evidence_against"):
                texts += [str(x) for x in data.get(key) or []]
                texts += [str(i["text"]) for i in data.get(f"{key}_items") or []]
            inv = data.get("invalidation") or {}
            if inv.get("text"):
                texts.append(str(inv["text"]))
            message = (data.get("intent_check") or {}).get("message")
            if message:
                texts.append(str(message))
        elif kind == "shapes":
            for shape in data["shapes"]:
                texts += _guard_texts(shape.get("guardrail") or {})
            texts += [str(v) for v in (data.get("labels") or {}).values()]
        elif kind == "markers":
            for marker in data["markers"]:
                texts.append(str(marker.get("label") or ""))
                texts += _guard_texts(marker.get("guardrail") or {})
    return texts


def _assert_coded(item: dict[str, Any]) -> None:
    assert set(item) == {"code", "params", "text"}, item
    assert re.fullmatch(r"[a-z][a-z0-9_]*", item["code"]), item
    assert item["code"] != "note", f"uncoded evidence: {item['text']!r}"
    assert all(isinstance(v, (int, float, str)) for v in item["params"].values()), item


@pytest.mark.asyncio
async def test_no_english_leftovers_across_replay_fixtures(llm_env, monkeypatch):
    leftovers: dict[str, set[str]] = {}
    seen_codes: set[str] = set()
    runs = [(f, style, False) for f in FIXTURES for style in ("classic", "smc")]
    runs += [(f, "classic", True) for f in FIXTURES[::4]]  # rules path sample
    for fixture, style, rules in runs:
        events = await _run(fixture, style, monkeypatch, rules=rules)
        kinds = [k for k, _ in events]
        assert "analysis" in kinds and kinds[-1] == "done", (fixture, kinds)
        for text in _user_texts(events):
            for match in ENGLISH.finditer(text):
                leftovers.setdefault(match.group(0), set()).add(text[:120])
        for kind, data in events:
            if kind == "analysis":
                for key in ("evidence_for_items", "evidence_against_items"):
                    assert len(data[key]) == len(data[key.removesuffix("_items")])
                    for item in data[key]:
                        _assert_coded(item)
                        seen_codes.add(item["code"])
                inv = data.get("invalidation")
                if inv:
                    assert inv["code"] in INVALIDATION_CODES
                    assert inv["params"] == {"price": inv["price"]}
            if kind == "shapes":
                assert set(data["labels"]) == {s["id"] for s in data["shapes"]}
                for shape in data["shapes"]:
                    guard = shape["guardrail"]
                    assert len(guard["evidence_against_items"]) == len(guard["evidence_against"])
                    for item in guard["evidence_against_items"]:
                        _assert_coded(item)
                    if guard.get("invalidation"):
                        assert guard["invalidation"]["code"] in INVALIDATION_CODES
                        # The raw condition is a snake_case code too (was "close beyond").
                        assert guard["invalidation"]["condition"] in INVALIDATION_CODES
    assert not leftovers, {k: sorted(v)[:3] for k, v in leftovers.items()}
    assert {"few_touches", "atr_value"} <= seen_codes


@pytest.mark.parametrize(
    ("legacy", "code", "params", "text"),
    [
        ("only 2 touches", "few_touches", {"n": 2}, "chỉ 2 lần chạm"),
        ("only 2 swing touches on tops", "few_top_touches", {"n": 2}, "chỉ 2 lần chạm đỉnh"),
        ("only 2 swing touches on bottoms", "few_bottom_touches", {"n": 2}, "chỉ 2 lần chạm đáy"),
        (
            "role from close: support",
            "role_from_close",
            {"role": "support"},
            "đổi vai theo giá đóng cửa: nay là hỗ trợ",
        ),
        ("neckline not broken", "neckline_not_broken", {}, "chưa phá đường viền cổ"),
        ("pattern completed", "pattern_completed", {}, "mô hình đã hoàn tất"),
        (
            "ATR14 ≈ 1,234.56",
            "atr_value",
            {"period": 14, "value": 1234.56},
            "Biên độ dao động ATR14 ≈ 1,234.56",
        ),
    ],
)
def test_legacy_english_evidence_maps_to_code_and_vietnamese(legacy, code, params, text):
    assert evidence_item(legacy) == {"code": code, "params": params, "text": text}
    # Vietnamese text maps to the same code (round trip).
    assert evidence_item(text) == {"code": code, "params": params, "text": text}


def test_localize_guardrail_codes_invalidation():
    guard = {
        "regime": "range",
        "confidence": 0.6,
        "evidence_against": ["only 2 touches"],
        "invalidation": {"price": 87299.1349, "condition": "close_above"},
    }
    out = localize_guardrail(guard, "BTCUSDT")
    assert out["evidence_against"] == ["chỉ 2 lần chạm"]
    assert out["evidence_against_items"] == [
        {"code": "few_touches", "params": {"n": 2}, "text": "chỉ 2 lần chạm"}
    ]
    assert out["invalidation"] == {
        "price": 87299.1349,
        "condition": "close_above",
        "code": "close_above",
        "params": {"price": 87299.1349},
        "text": "đóng cửa trên 87,299.13",
    }
    legacy = localize_guardrail(
        {**guard, "invalidation": {"price": 1.5, "condition": "close beyond"}}, "BTCUSDT"
    )
    assert legacy["invalidation"]["code"] == "close_beyond"
    assert legacy["invalidation"]["text"].startswith("đóng cửa vượt ")


def test_code_tables_are_snake_case():
    for code in (*EVIDENCE_CODES, *INVALIDATION_CODES):
        assert re.fullmatch(r"[a-z][a-z0-9_]*", code)


@pytest.mark.parametrize("style", ["elliott", "wyckoff"])
def test_unsupported_style_message_is_vietnamese(style):
    plan = _plan_from_fixture(FIXTURES[0], candle_count=200)
    message = build_intent_check(plan.request, AnalyzeIntent(style=style))["message"]
    assert message and "chưa có bộ phát hiện" in message
    english = [m.group(0) for m in ENGLISH.finditer(message)]
    assert english == [], english


def _gate_drop_codes() -> set[str]:
    src = (Path(__file__).parents[1] / "src/cryptosignal_copilot/drawing_gate.py").read_text()
    tree = ast.parse(src)
    codes: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Return) and isinstance(node.value, ast.Tuple):
            elts = node.value.elts
            # `return None, "<drop code>"`
            if (
                len(elts) == 2
                and isinstance(elts[0], ast.Constant)
                and elts[0].value is None
                and isinstance(elts[1], ast.Constant)
                and isinstance(elts[1].value, str)
            ):
                codes.add(elts[1].value)
        if isinstance(node, ast.Return) and isinstance(node.value, ast.Constant):
            value = node.value.value
            if isinstance(value, str) and re.fullmatch(r"[a-z]+(-[a-zA-Z0-9+]+)+", value):
                codes.add(value)
    return codes - {"upper", "lower"}


def test_every_gate_drop_code_has_a_vietnamese_label():
    codes = _gate_drop_codes()
    assert {"off-grid", "no-anchor", "min-span", "apex+3"} & codes
    missing = sorted(codes - set(GATE_REASON_VI))
    assert missing == [], missing
    note = format_drop_note([(f"s{i}", c) for i, c in enumerate(sorted(codes))])
    note += format_drop_note([("x", "schema:points:count")])
    assert "không hợp lệ (" in note and "không hợp lệ)" not in note
    assert [m.group(0) for m in ENGLISH.finditer(note)] == []


# Templates the UI developer found at HEAD before f4a7c699. They may only survive as
# legacy-input regexes in vi_text.py (which maps old English evidence to codes).
LEGACY_TEMPLATES = (
    "role from close",
    "only 2 touches",
    "only 2 swing touches",
    "neckline not broken",
    "pattern completed",
    "close beyond",
    "has no live v1",
    "Chi tiết pick",
    "Vô hiệu hóa (detector)",
    "chế độ trend_",
    "sideway",
)


def test_source_has_no_legacy_english_templates():
    root = Path(__file__).parents[1] / "src/cryptosignal_copilot"
    hits: list[str] = []
    for path in sorted(root.glob("*.py")):
        if path.name == "vi_text.py":
            continue
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                for template in LEGACY_TEMPLATES:
                    if template.lower() in node.value.lower():
                        hits.append(f"{path.name}:{node.lineno}: {template!r}")
    assert hits == [], hits
