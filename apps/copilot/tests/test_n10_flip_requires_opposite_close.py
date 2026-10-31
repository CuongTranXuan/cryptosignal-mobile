"""N10: a rejection from a zone is not a flip; a flip needs a close beyond the opposite side first."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import cryptosignal_copilot.candidates as C
from cryptosignal_copilot.candidates import _sr_flipped, _sr_zone_start_time
from cryptosignal_copilot.schema import Candle

FIXTURES = Path(__file__).parent / "fixtures"


def _load(path: Path) -> tuple[str, str, list[Candle]]:
    payload = json.loads(path.read_text())
    return (
        payload["symbol"],
        payload["interval"],
        [Candle.model_validate(r) for r in payload["candles"]],
    )


def _candle(t: int, close: float) -> Candle:
    return Candle(time=t, open=close, high=close + 0.1, low=close - 0.1, close=close, volume=1)


def _sr_outputs(
    monkeypatch: pytest.MonkeyPatch, path: Path
) -> list[tuple[C.DrawingCandidate, list[Candle]]]:
    seen: list[tuple[C.DrawingCandidate, list[Candle]]] = []
    original = C._sr_role_from_last_close

    def record(cand, candles):
        out = original(cand, candles)
        if out.pattern_id == "support_resistance":
            seen.append((out, candles))
        return out

    monkeypatch.setattr(C, "_sr_role_from_last_close", record)
    symbol, interval, candles = _load(path)
    C.build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
    return seen


def _has_prior_opposite_close(cand: C.DrawingCandidate, candles: list[Candle]) -> bool:
    shape = cand.shapes[0]
    low, high = float(shape["priceLow"]), float(shape["priceHigh"])
    to_role = "support" if "support (flipped)" in cand.name else "resistance"
    return _sr_flipped(candles, low, high, _sr_zone_start_time(cand), to_role=to_role)


def test_rejection_from_resistance_is_not_a_flip():
    # Zone 100-101 formed at t=0; price closes inside, then drops below: a rejection.
    closes = [100.5, 100.8, 99.0, 98.5]
    candles = [_candle(i + 1, c) for i, c in enumerate(closes)]
    assert not _sr_flipped(candles, 100.0, 101.0, 0, to_role="resistance")
    # A close above the zone first, then below it: a real support→resistance flip.
    closes = [101.5, 102.0, 100.5, 99.0]
    candles = [_candle(i + 1, c) for i, c in enumerate(closes)]
    assert _sr_flipped(candles, 100.0, 101.0, 0, to_role="resistance")
    # Mirror for support.
    assert not _sr_flipped(
        [_candle(1, 100.5), _candle(2, 102.0)], 100.0, 101.0, 0, to_role="support"
    )
    assert _sr_flipped(
        [_candle(1, 99.0), _candle(2, 100.5), _candle(3, 102.0)], 100.0, 101.0, 0, to_role="support"
    )


def test_sol_4h_resistance_rejection_not_labelled_flipped(monkeypatch):
    """C.14 example: SOLUSDT 4h zone ~83.20-83.46 from two swing highs, every later close below."""
    outputs = _sr_outputs(monkeypatch, FIXTURES / "n10" / "solusdt_4h_200.json")
    zone = [
        cand
        for cand, _ in outputs
        if float(cand.shapes[0]["priceLow"]) <= 83.33 <= float(cand.shapes[0]["priceHigh"])
    ]
    assert zone, "expected the 83.2-83.5 S/R zone in this window"
    for cand in zone:
        assert "(flipped)" not in cand.name, cand.name
        assert not any("đổi vai" in e or "role from close" in e for e in cand.evidence_against)


@pytest.mark.parametrize(
    "path",
    sorted((FIXTURES / "ohlcv").glob("*.json")) + [FIXTURES / "n10" / "solusdt_4h_200.json"],
    ids=lambda p: p.stem,
)
def test_every_flipped_zone_has_prior_opposite_close(monkeypatch, path):
    for cand, candles in _sr_outputs(monkeypatch, path):
        if "(flipped)" in cand.name:
            assert _has_prior_opposite_close(cand, candles), cand.name
