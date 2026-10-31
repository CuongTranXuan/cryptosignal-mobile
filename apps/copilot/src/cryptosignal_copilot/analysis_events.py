"""SSE payloads for regime and analysis (Part B §5 / spec #32)."""

from __future__ import annotations

from typing import Any

from cryptosignal_copilot.candidates import CandidateCatalog, DrawingCandidate
from cryptosignal_copilot.chart_regime import Regime
from cryptosignal_copilot.market_price import format_market_price
from cryptosignal_copilot.vi_text import (
    EV_ATR_ELEVATED,
    EV_HIGHER_HIGHS_LOWS,
    EV_LOWER_HIGHS_LOWS,
    EV_MIXED_STRUCTURE,
    EV_NO_STRUCTURAL_WARNING,
    EV_PRICE_ABOVE_EMA,
    EV_PRICE_BELOW_EMA,
    EV_REGIME_FROM_CLOSED,
    ev_atr,
    evidence_items,
    localize_evidence,
    localize_invalidation,
)


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


def _evidence_for_regime(catalog: CandidateCatalog, *, symbol: str) -> list[str]:
    regime = str(catalog.regime)
    lines: list[str] = []
    if regime == "trend_up":
        lines += [EV_HIGHER_HIGHS_LOWS, EV_PRICE_ABOVE_EMA]
    elif regime == "trend_down":
        lines += [EV_LOWER_HIGHS_LOWS, EV_PRICE_BELOW_EMA]
    elif regime == "volatile":
        lines.append(EV_ATR_ELEVATED)
    else:
        lines.append(EV_MIXED_STRUCTURE)
    if catalog.atr is not None:
        lines.append(ev_atr(14, format_market_price(float(catalog.atr), symbol)))
    return lines


def build_analysis_event(
    catalog: CandidateCatalog,
    shapes: list[dict[str, Any]],
    intent_check: dict[str, Any],
    *,
    picked: list[DrawingCandidate] | None = None,
    symbol: str = "BTCUSDT",
) -> dict[str, Any]:
    bias = regime_to_bias(catalog.regime)
    evidence_for = _evidence_for_regime(catalog, symbol=symbol)
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
                if isinstance(item, str) and item:
                    text = localize_evidence(item)
                    if text not in evidence_against:
                        evidence_against.append(text)
        inv = guard.get("invalidation")
        if primary_inv is None and isinstance(inv, dict) and inv.get("price") is not None:
            primary_inv = inv

    if picked:
        for cand in picked:
            for item in cand.evidence_against:
                text = localize_evidence(item) if item else ""
                if text and text not in evidence_against:
                    evidence_against.append(text)

    confidence = round(sum(confidences) / len(confidences), 3) if confidences else 0.55
    if not evidence_for:
        evidence_for = [EV_REGIME_FROM_CLOSED]
    if shapes and not evidence_against:
        evidence_against = [EV_NO_STRUCTURAL_WARNING]

    return {
        "bias": bias,
        "no_valid_pattern": len(shapes) == 0,
        "evidence_for": evidence_for,
        "evidence_against": evidence_against,
        "evidence_for_items": evidence_items(evidence_for),
        "evidence_against_items": evidence_items(evidence_against),
        "invalidation": localize_invalidation(primary_inv, symbol) if primary_inv else None,
        "confidence": confidence,
        "intent_check": intent_check,
    }
