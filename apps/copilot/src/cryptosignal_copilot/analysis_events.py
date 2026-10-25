"""SSE payloads for regime and analysis (Part B §5 / spec #32)."""

from __future__ import annotations

from typing import Any

from cryptosignal_copilot.candidates import CandidateCatalog, DrawingCandidate
from cryptosignal_copilot.chart_regime import Regime


def regime_to_bias(regime: Regime | str) -> str:
    if regime == "trend_up":
        return "bullish"
    if regime == "trend_down":
        return "bearish"
    return "neutral"


def build_regime_event(
    catalog: CandidateCatalog,
    intent_check: dict[str, Any],
    *,
    htf: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "ltf": {
            "regime": str(catalog.regime),
            "atr": catalog.atr,
        },
        "htf": htf or {},
        "intent_check": intent_check,
    }


def _evidence_for_regime(catalog: CandidateCatalog) -> list[str]:
    regime = str(catalog.regime)
    lines: list[str] = []
    if regime == "trend_up":
        lines.append("Higher highs and higher lows on recent swings")
        lines.append("Price above EMA50 with positive EMA20 slope")
    elif regime == "trend_down":
        lines.append("Lower highs and lower lows on recent swings")
        lines.append("Price below EMA50 with negative EMA20 slope")
    elif regime == "volatile":
        lines.append("ATR elevated versus recent median")
    else:
        lines.append("Mixed swing structure without clear trend")
    if catalog.atr is not None:
        lines.append(f"ATR14 ≈ {catalog.atr:.2f}")
    return lines


def build_analysis_event(
    catalog: CandidateCatalog,
    shapes: list[dict[str, Any]],
    intent_check: dict[str, Any],
    *,
    picked: list[DrawingCandidate] | None = None,
) -> dict[str, Any]:
    bias = regime_to_bias(catalog.regime)
    evidence_for = _evidence_for_regime(catalog)
    evidence_against: list[str] = []
    confidences: list[float] = []
    primary_inv: dict[str, Any] | None = None

    for shape in shapes:
        guard = shape.get("guardrail")
        if not isinstance(guard, dict):
            continue
        conf = guard.get("confidence")
        if isinstance(conf, (int, float)):
            confidences.append(float(conf))
        against = guard.get("evidence_against")
        if isinstance(against, list):
            for item in against:
                if isinstance(item, str) and item and item not in evidence_against:
                    evidence_against.append(item)
        inv = guard.get("invalidation")
        if primary_inv is None and isinstance(inv, dict) and inv.get("price") is not None:
            primary_inv = inv

    if picked:
        for cand in picked:
            for item in cand.evidence_against:
                if item and item not in evidence_against:
                    evidence_against.append(item)

    confidence = round(sum(confidences) / len(confidences), 3) if confidences else 0.55
    if not evidence_for:
        evidence_for = ["Detector regime from closed candles"]
    if not evidence_against:
        evidence_against = ["No structural warnings on selected drawings"]

    return {
        "bias": bias,
        "no_valid_pattern": len(shapes) == 0,
        "evidence_for": evidence_for,
        "evidence_against": evidence_against,
        "invalidation": primary_inv,
        "confidence": confidence,
        "intent_check": intent_check,
    }
