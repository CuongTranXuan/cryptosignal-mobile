"""Rules-first intent pre-step with optional LLM fallback."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from cryptosignal_copilot.candidates import CandidateCatalog, patterns_for_style
from cryptosignal_copilot.chart_regime import bias_conflicts_regime
from cryptosignal_copilot.drawing_intent import (
    AnalyzeResultLlm,
    CandidateDrawingIntent,
    DrawingIntent,
    enrich_resolved_shapes,
    resolve_drawing_intents,
)
from cryptosignal_copilot.schema import AnalyzeIntent, AnalyzeRequest

RULE_SCORE_THRESHOLD = 0.65
AMBIGUITY_GAP = 0.08

_STYLE_PROMPT_SLICES: dict[str, str] = {
    "classic": (
        "Focus classic structure: trendlines, S/R zones, triangles, channels, "
        "H&S, double tops/bottoms, fib retracement. Pick candidate ids from the sheet."
    ),
    "smc": ("Focus SMC: BOS, CHoCH, FVG, order blocks, liquidity. Use only listed candidate ids."),
    "elliott": "Elliott wave labels only; prefer trendline candidates if any.",
    "wyckoff": "Wyckoff range context; prefer support_resistance candidates if any.",
}


@dataclass(frozen=True)
class IntentStepResult:
    use_llm: bool
    prompt_slice: str
    rule_shapes: list[dict[str, Any]]
    rule_intents: list[DrawingIntent]
    intent_source: str  # "rules" | "llm"


def style_prompt_slice(style: str) -> str:
    return _STYLE_PROMPT_SLICES.get(style, _STYLE_PROMPT_SLICES["classic"])


def _filter_candidates(catalog: CandidateCatalog, intent: AnalyzeIntent) -> list:
    allowed_patterns = patterns_for_style(intent.style)
    pool = [c for c in catalog.candidates if c.pattern_id in allowed_patterns]
    requested = intent.requested_pattern
    if requested:
        boosted = [c for c in pool if c.pattern_id == requested]
        rest = [c for c in pool if c.pattern_id != requested]
        pool = sorted(boosted, key=lambda c: c.score, reverse=True) + sorted(
            rest, key=lambda c: c.score, reverse=True
        )
    else:
        pool = sorted(pool, key=lambda c: c.score, reverse=True)
    return pool


def rules_first_step(
    request: AnalyzeRequest,
    catalog: CandidateCatalog,
    intent: AnalyzeIntent,
) -> IntentStepResult:
    pool = _filter_candidates(catalog, intent)
    conflict = bias_conflicts_regime(intent.bias, catalog.regime)
    slice_text = style_prompt_slice(intent.style)
    if not pool:
        return IntentStepResult(
            use_llm=True,
            prompt_slice=slice_text,
            rule_shapes=[],
            rule_intents=[],
            intent_source="llm",
        )
    top = pool[0]
    second = pool[1] if len(pool) > 1 else None
    clear_winner = top.score >= RULE_SCORE_THRESHOLD and (
        second is None or top.score - second.score >= AMBIGUITY_GAP
    )
    requested = intent.requested_pattern
    if requested:
        matched = [c for c in pool if c.pattern_id == requested and c.score >= 0.6]
        if matched and not conflict:
            intents: list[DrawingIntent] = [CandidateDrawingIntent(candidate_id=matched[0].id)]
            shapes, _ = resolve_drawing_intents(intents, catalog)
            last_close = float(request.closedCandles[-1].close) if request.closedCandles else None
            shapes = enrich_resolved_shapes(shapes, catalog, last_close=last_close)
            return IntentStepResult(
                use_llm=False,
                prompt_slice=slice_text,
                rule_shapes=shapes,
                rule_intents=intents,
                intent_source="rules",
            )
    if clear_winner and not conflict and not request.prompt.strip():
        intents = [CandidateDrawingIntent(candidate_id=top.id)]
        shapes, _ = resolve_drawing_intents(intents, catalog)
        last_close = float(request.closedCandles[-1].close) if request.closedCandles else None
        shapes = enrich_resolved_shapes(shapes, catalog, last_close=last_close)
        return IntentStepResult(
            use_llm=False,
            prompt_slice=slice_text,
            rule_shapes=shapes,
            rule_intents=intents,
            intent_source="rules",
        )
    return IntentStepResult(
        use_llm=True,
        prompt_slice=slice_text,
        rule_shapes=[],
        rule_intents=[],
        intent_source="llm",
    )


def candidate_id_list_for_prompt(
    catalog: CandidateCatalog, intent: AnalyzeIntent
) -> list[dict[str, Any]]:
    pool = _filter_candidates(catalog, intent)
    return [
        {
            "id": c.id,
            "pattern": c.pattern_id,
            "score": round(c.score, 3),
            "name": c.name,
            "swings": c.swing_ids,
            "shape_cost": len(c.shapes),
        }
        for c in pool[:20]
    ]


def build_rules_only_result(summary: str, shapes: list[dict[str, Any]]) -> AnalyzeResultLlm:
    return AnalyzeResultLlm(pick_assessments=[], drawing_intents=[])
