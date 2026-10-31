"""S/R names on the wire use tick-aware price formatting (PEPE / DOGE).

A fixed ``:.2f`` rendered PEPE zones as "S/R 0.00" and DOGE as "S/R 0.10"; those
names went into SSE shapes, the Vietnamese ``labels`` map and stored sessions.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from cryptosignal_copilot.candidates import build_candidate_catalog
from cryptosignal_copilot.drawing_intent import (
    CandidateDrawingIntent,
    enrich_resolved_shapes,
    resolve_drawing_intents,
)
from cryptosignal_copilot.market_price import format_market_price
from cryptosignal_copilot.schema import Candle
from cryptosignal_copilot.vi_text import display_name_vi

FIXTURES = Path(__file__).parent / "fixtures" / "ohlcv"

# (fixture, last close after rescale) — btc 1d yields a plain S/R, eth 1h a flipped one.
CASES = [
    ("PEPEUSDT", 0.0000123, "btcusdt_1d_200.json"),
    ("PEPEUSDT", 0.0000123, "ethusdt_1h_200.json"),
    ("DOGEUSDT", 0.1234, "btcusdt_1d_200.json"),
    ("DOGEUSDT", 0.1234, "ethusdt_1h_200.json"),
]


def _scaled(fixture: str, last_close: float) -> tuple[list[Candle], str]:
    doc = json.loads((FIXTURES / fixture).read_text())
    rows = doc["candles"]
    k = last_close / float(rows[-1]["close"])
    candles = [
        Candle.model_validate(
            {**r, **{f: float(r[f]) * k for f in ("open", "high", "low", "close")}}
        )
        for r in rows
    ]
    return candles, str(doc["interval"])


@pytest.mark.parametrize(("symbol", "last_close", "fixture"), CASES)
def test_sr_names_are_tick_formatted(symbol: str, last_close: float, fixture: str) -> None:
    candles, interval = _scaled(fixture, last_close)
    catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)
    srs = [c for c in catalog.candidates if c.pattern_id == "support_resistance"]
    assert srs, f"expected S/R candidates for {symbol} on {fixture}"
    for cand in srs:
        shape = cand.shapes[0]
        mid = (float(shape["priceLow"]) + float(shape["priceHigh"])) / 2.0
        label = format_market_price(mid, symbol)
        assert cand.name.endswith(f" {label}"), cand.name
        assert cand.name not in {"S/R 0.00", "S/R 0.10", "S/R 0.12"}
        # Zone shapes carry the candidate name (price + role/flip), never the stale .2f text.
        assert all(s["name"] == cand.name for s in cand.shapes)

    shapes, _ = resolve_drawing_intents(
        [CandidateDrawingIntent(candidate_id=c.id) for c in srs], catalog
    )
    wire = enrich_resolved_shapes(shapes, catalog, last_close=candles[-1].close)
    assert wire
    labels = {s["id"]: display_name_vi(str(s.get("name", ""))) for s in wire}
    for s in wire:
        name = str(s["name"])
        price_text = name.rsplit(" ", 1)[-1]
        assert price_text not in {"0.00", "0.10", "0.12"}, name
        if symbol == "PEPEUSDT":
            assert price_text.startswith("0.0000"), name
            assert len(price_text.split(".")[1]) >= 8, name
        else:
            assert len(price_text.split(".")[1]) >= 4, name
        assert labels[s["id"]].startswith("Vùng "), labels[s["id"]]
        assert labels[s["id"]].endswith(f" {price_text}"), labels[s["id"]]


def test_flipped_role_reaches_the_shape_name() -> None:
    candles, interval = _scaled("ethusdt_1h_200.json", 0.0000123)
    catalog = build_candidate_catalog(candles, symbol="PEPEUSDT", interval=interval)
    flipped = [c for c in catalog.candidates if "(flipped)" in c.name]
    assert flipped
    for cand in flipped:
        assert all(s["name"] == cand.name for s in cand.shapes)
        vi = display_name_vi(cand.shapes[0]["name"])
        assert vi.startswith("Vùng ") and "(đổi vai)" in vi, vi
