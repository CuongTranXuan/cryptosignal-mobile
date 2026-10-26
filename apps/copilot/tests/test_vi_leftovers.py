"""C.16: user-facing backend text is Vietnamese at the source, and every evidence line /
invalidation carries a stable `{code, params, text}`.

Runs the real runner with a scripted model over all 16 replay fixtures (classic + SMC)
and scans everything the analysis panel and summary show: SSE `text` deltas, the
`analysis` event, shape/marker guardrails. Canonical shape `name`s stay English ids by
contract (the web maps them with `displayShapeName`), so they are not scanned.
"""

from __future__ import annotations

import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic_ai import Agent

from cryptosignal_copilot.agent import PydanticAiRunner
from cryptosignal_copilot.drawing_intent import (
    AnalyzeResultLlm,
    PickAssessment,
    build_deterministic_fallback,
)
from cryptosignal_copilot.vi_text import (
    EVIDENCE_CODES,
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


async def _run(fixture: str, style: str, monkeypatch) -> list[tuple[str, dict]]:
    plan = _plan_from_fixture(fixture, candle_count=200)
    plan.request.intent.style = style  # type: ignore[union-attr]
    catalog = plan.candidate_catalog

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
    for fixture in FIXTURES:
        for style in ("classic", "smc"):
            events = await _run(fixture, style, monkeypatch)
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
                    for shape in data["shapes"]:
                        guard = shape["guardrail"]
                        assert len(guard["evidence_against_items"]) == len(
                            guard["evidence_against"]
                        )
                        for item in guard["evidence_against_items"]:
                            _assert_coded(item)
                        if guard.get("invalidation"):
                            assert guard["invalidation"]["code"] in INVALIDATION_CODES
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
