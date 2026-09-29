"""Geometry gate: forward k caps, triangle apex+3, and in-play rejects."""

from cryptosignal_copilot.drawing_gate import (
    IMPULSE_ATR_MULT,
    DrawingWindow,
    _wilder_atr,
    effective_project_bars,
    forward_past_apex,
    line_intersection,
    review_shape,
)
from cryptosignal_copilot.schema import Candle, filter_preview_details, filter_preview_shapes

T0 = 1_700_000_000
BAR = 3600
N = 40


def ts(index: int) -> int:
    return T0 + index * BAR


def make_candles(
    n: int = N,
    wicks: dict[int, tuple[float, float]] | None = None,
    *,
    low: float = 110.0,
    high: float = 120.0,
) -> list[Candle]:
    overrides = wicks or {}
    rows: list[Candle] = []
    for index in range(n):
        lo, hi = overrides.get(index, (low, high))
        mid = (lo + hi) / 2
        rows.append(Candle(time=ts(index), open=mid, high=hi, low=lo, close=mid, volume=1.0))
    return rows


def make_window(rows: list[Candle], *, start: int | None = None) -> DrawingWindow:
    return DrawingWindow(
        candles=rows,
        interval="1h",
        window_start=start,
        allowed_times={row.time for row in rows},
    )


def trendline(
    shape_id: str,
    name: str,
    p1: tuple[int, float],
    p2: tuple[int, float],
    *,
    confidence: float = 0.6,
    source: str = "agent",
) -> dict:
    return {
        "id": shape_id,
        "symbol": "BTCUSDT",
        "interval": "1h",
        "kind": "trendline",
        "name": name,
        "status": "preview",
        "source": source,
        "confidence": confidence,
        "points": [
            {"time": p1[0], "price": p1[1]},
            {"time": p2[0], "price": p2[1]},
        ],
        "priceLow": None,
        "priceHigh": None,
    }


def on_line(index: int, i1: int, p1: float, i2: int, p2: float) -> float:
    return p1 + (p2 - p1) * (index - i1) / (i2 - i1)


def _filter(shapes: list[dict], rows: list[Candle], *, start: int | None = None):
    return filter_preview_shapes(
        shapes,
        {row.time for row in rows},
        symbol="BTCUSDT",
        interval="1h",
        window=make_window(rows, start=start),
    )


def test_project_bars_table(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    assert effective_project_bars("1m") == 30
    assert effective_project_bars("15m") == 24
    assert effective_project_bars("1h") == 24
    assert effective_project_bars("4h") == 18
    assert effective_project_bars("1d") == 12


def test_project_bars_override_and_hard_max(monkeypatch):
    monkeypatch.setenv("COPILOT_PROJECT_BARS", "10")
    assert effective_project_bars("1m") == 10
    monkeypatch.setenv("COPILOT_PROJECT_BARS", "100")
    assert effective_project_bars("1d") == 48
    monkeypatch.setenv("COPILOT_PROJECT_BARS", "nope")
    assert effective_project_bars("1h") == 24


def test_forward_past_apex_boundary():
    apex = 1_000_000.0
    assert forward_past_apex(apex + 3 * BAR, apex, BAR) is False
    assert forward_past_apex(apex + 4 * BAR, apex, BAR) is True


def test_line_intersection_apex_and_parallel():
    apex = line_intersection((ts(10), 80.0), (ts(25), 100.0), (ts(12), 160.0), (ts(27), 140.0))
    assert apex is not None
    assert abs(apex[0] - ts(41)) < 1e-6
    assert line_intersection((0.0, 0.0), (10.0, 1.0), (0.0, 5.0), (10.0, 6.0)) is None


def test_future_endpoint_within_k_kept_and_beyond_k_rejected(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(wicks={20: (90.0, 120.0), 32: (96.0, 120.0)})
    window = make_window(rows)

    def ray(index: int, shape_id: str) -> dict:
        return trendline(
            shape_id,
            "Impulse leg",
            (ts(20), 90.0),
            (ts(index), on_line(index, 20, 90.0, 32, 96.0)),
        )

    kept, reason = review_shape(ray(39 + 24, "in-k"), window)
    assert reason is None, reason
    assert kept is not None

    kept, reason = review_shape(ray(39 + 25, "past-k"), window)
    assert kept is None
    assert reason == "beyond-k"

    valid, dropped = _filter([ray(39 + 24, "in-k"), ray(39 + 25, "past-k")], rows)
    assert [shape["id"] for shape in valid] == ["in-k"]
    assert dropped == ["past-k"]


def test_k_cap_binds_when_apex_is_farther(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(
        wicks={
            10: (100.0, 140.0),
            30: (102.0, 138.0),
        }
    )
    forward = 39 + 25
    lower = trendline(
        "far-lower",
        "Triangle lower",
        (ts(10), 100.0),
        (ts(forward), on_line(forward, 10, 100.0, 30, 102.0)),
    )
    upper = trendline(
        "far-upper",
        "Triangle upper",
        (ts(10), 140.0),
        (ts(forward), on_line(forward, 10, 140.0, 30, 138.0)),
    )
    window = make_window(rows)
    _, lower_reason = review_shape(lower, window)
    _, upper_reason = review_shape(upper, window)
    assert lower_reason == "beyond-k"
    assert upper_reason == "beyond-k"
    apex = line_intersection(
        (ts(10), 100.0),
        (ts(30), 102.0),
        (ts(10), 140.0),
        (ts(30), 138.0),
    )
    assert apex is not None
    assert ts(forward) < apex[0] + 3 * BAR


def test_triangle_apex_plus_3_allowed_plus_4_rejected(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(
        wicks={
            10: (80.0, 120.0),
            12: (110.0, 160.0),
            25: (100.0, 120.0),
            27: (110.0, 140.0),
        }
    )

    def pair(forward_index: int, suffix: str) -> list[dict]:
        return [
            trendline(
                f"lower-{suffix}",
                "Triangle lower",
                (ts(10), 80.0),
                (ts(forward_index), on_line(forward_index, 10, 80.0, 25, 100.0)),
            ),
            trendline(
                f"upper-{suffix}",
                "Triangle upper",
                (ts(12), 160.0),
                (ts(forward_index), on_line(forward_index, 12, 160.0, 27, 140.0)),
            ),
        ]

    apex = line_intersection((ts(10), 80.0), (ts(25), 100.0), (ts(12), 160.0), (ts(27), 140.0))
    assert apex is not None
    assert forward_past_apex(ts(44), apex[0], BAR) is False
    assert forward_past_apex(ts(45), apex[0], BAR) is True
    assert (ts(45) - ts(39)) / BAR <= 24

    window = make_window(rows)
    for shape in pair(44, "ok"):
        kept, reason = review_shape(shape, window)
        assert reason is None, reason
        assert kept is not None

    valid, dropped = _filter(pair(44, "ok"), rows)
    assert dropped == []
    assert {shape["id"] for shape in valid} == {"lower-ok", "upper-ok"}

    valid, dropped = _filter(pair(45, "late"), rows)
    assert valid == []
    assert set(dropped) == {"lower-late", "upper-late"}


def test_parallel_channel_is_not_apex_rejected(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(
        wicks={
            20: (100.0, 130.0),
            32: (106.0, 136.0),
        }
    )
    forward = 44
    shapes = [
        trendline(
            "base",
            "Channel lower",
            (ts(20), 100.0),
            (ts(forward), on_line(forward, 20, 100.0, 32, 106.0)),
        ),
        trendline(
            "return",
            "Channel upper",
            (ts(20), 130.0),
            (ts(forward), on_line(forward, 20, 130.0, 32, 136.0)),
        ),
    ]
    valid, dropped = _filter(shapes, rows)
    assert dropped == []
    assert {shape["id"] for shape in valid} == {"base", "return"}


def test_per_rail_min_span_not_waived_by_a_longer_mate(monkeypatch):
    """A short flat top stays min-span. Its longer lower rail then drops as unpaired."""
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(
        wicks={
            8: (80.0, 120.0),
            18: (110.0, 150.0),
            30: (100.0, 120.0),
            32: (110.0, 148.0),
        }
    )
    upper = trendline("upper", "Ascending triangle upper", (ts(18), 150.0), (ts(32), 148.0))
    lower = trendline("lower", "Ascending triangle lower", (ts(8), 80.0), (ts(30), 100.0))
    _, upper_reason = review_shape(upper, make_window(rows))
    assert upper_reason == "min-span"
    _, lower_reason = review_shape(lower, make_window(rows))
    assert lower_reason is None, lower_reason

    from cryptosignal_copilot.schema import filter_preview_details

    valid, dropped = filter_preview_details(
        [upper, lower],
        {row.time for row in rows},
        symbol="BTCUSDT",
        interval="1h",
        window=make_window(rows),
    )
    assert valid == []
    assert ("upper", "min-span") in dropped
    assert ("lower", "unpaired-triangle") in dropped

    flat_top = trendline("flat", "Ascending triangle upper", (ts(18), 140.0), (ts(32), 140.0))
    _, flat_reason = review_shape(flat_top, make_window(rows))
    assert flat_reason == "min-span"

    eight = trendline("wide-enough", "Impulse leg", (ts(22), 90.0), (ts(30), 96.0))
    rows_eight = make_candles(wicks={22: (90.0, 120.0), 30: (96.0, 120.0)})
    _, eight_reason = review_shape(eight, make_window(rows_eight))
    assert eight_reason != "min-span"


def test_ancient_short_span_confidence_and_before_window(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    ancient_rows = make_candles(wicks={4: (90.0, 120.0), 12: (96.0, 120.0)})
    ancient = trendline("old", "Swing base", (ts(4), 90.0), (ts(12), 96.0))
    _, reason = review_shape(ancient, make_window(ancient_rows))
    assert reason == "ancient"

    short_rows = make_candles(wicks={10: (90.0, 120.0), 16: (94.0, 120.0)})
    short = trendline("short", "Swing base", (ts(10), 90.0), (ts(16), 94.0))
    _, reason = review_shape(short, make_window(short_rows))
    assert reason == "min-span"

    flat = make_candles()
    low_conf = trendline("low", "Fib 0.5", (ts(20), 115.0), (ts(32), 115.0), confidence=0.5)
    _, reason = review_shape(low_conf, make_window(flat))
    assert reason == "low-conf"

    rows = make_candles(wicks={20: (90.0, 120.0), 32: (96.0, 120.0)})
    early = trendline(
        "early",
        "Impulse leg",
        (ts(20), 90.0),
        (ts(32), 96.0),
    )
    _, reason = review_shape(early, make_window(rows, start=ts(30)))
    assert reason == "before-window"


def test_single_touch_diagonal_rejected(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(wicks={20: (90.0, 120.0)})
    shape = trendline(
        "one",
        "Impulse leg",
        (ts(20), 90.0),
        (ts(44), 150.0),
    )
    _, reason = review_shape(shape, make_window(rows))
    assert reason == "single-touch"


def test_near_vertical_rejected(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(wicks={24: (100.0, 130.0), 32: (110.0, 400.0)})
    steep = trendline("steep", "Spike", (ts(24), 130.0), (ts(32), 400.0))
    _, reason = review_shape(steep, make_window(rows))
    assert reason == "near-vertical"


def test_third_touch_clamps_confidence(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(wicks={20: (90.0, 120.0), 32: (96.0, 120.0)})
    shape = trendline(
        "two",
        "Impulse leg",
        (ts(20), 90.0),
        (ts(32), 96.0),
        confidence=0.9,
    )
    kept, reason = review_shape(shape, make_window(rows))
    assert reason is None, reason
    assert kept is not None
    assert kept["confidence"] == 0.7


def test_fib_level_must_be_horizontal_and_zone_pocket_kept(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles()
    level = trendline("lvl", "Fib 0.618", (ts(20), 115.0), (ts(32), 115.0))
    sloped = trendline("slope", "Fib 0.618", (ts(20), 100.0), (ts(32), 130.0))
    zone = {
        "id": "pocket",
        "symbol": "BTCUSDT",
        "interval": "1h",
        "kind": "zone",
        "name": "Fib pocket 0.5–0.618",
        "status": "preview",
        "source": "agent",
        "confidence": 0.66,
        "points": [
            {"time": ts(20), "price": 100.0},
            {"time": ts(32), "price": 110.0},
        ],
        "priceLow": 100.0,
        "priceHigh": 110.0,
    }
    valid, dropped = _filter([level, sloped, zone], rows)
    assert [shape["id"] for shape in valid] == ["lvl", "pocket"]
    assert dropped == ["slope"]


def test_cap_six_shapes(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles()
    shapes = [
        trendline(f"h{index}", f"Level {index}", (ts(20), 100.0 + index), (ts(32), 100.0 + index))
        for index in range(7)
    ]
    valid, dropped = _filter(shapes, rows)
    assert [shape["id"] for shape in valid] == [f"h{index}" for index in range(6)]
    assert dropped == ["h6"]


def test_off_grid_and_human_future_rejected(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(wicks={20: (90.0, 120.0), 32: (96.0, 120.0)})
    window = make_window(rows)
    off_grid = trendline(
        "grid",
        "Impulse leg",
        (ts(20), 90.0),
        (ts(39) + BAR + 30, on_line(40, 20, 90.0, 32, 96.0)),
    )
    _, reason = review_shape(off_grid, window)
    assert reason == "off-grid"

    human = trendline(
        "human",
        "Impulse leg",
        (ts(20), 90.0),
        (ts(39 + 2), on_line(41, 20, 90.0, 32, 96.0)),
        source="human",
    )
    _, reason = review_shape(human, window)
    assert reason == "human-future"


def test_short_polyline_rejected(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(wicks={20: (90.0, 120.0), 26: (94.0, 120.0), 31: (92.0, 120.0)})
    shape = {
        "id": "poly",
        "symbol": "BTCUSDT",
        "interval": "1h",
        "kind": "polyline",
        "name": "Head and shoulders",
        "status": "preview",
        "source": "agent",
        "confidence": 0.6,
        "points": [
            {"time": ts(20), "price": 90.0},
            {"time": ts(26), "price": 94.0},
            {"time": ts(31), "price": 92.0},
        ],
        "priceLow": None,
        "priceHigh": None,
    }
    _, reason = review_shape(shape, make_window(rows))
    assert reason == "min-span"


def test_gate_skips_bad_shapes_without_raising():
    rows = make_candles()
    valid, dropped = filter_preview_shapes(
        ["bad", None, {"id": "broken", "kind": "trendline", "points": []}],
        window=make_window(rows),
        symbol="BTCUSDT",
        interval="1h",
    )
    assert valid == []
    assert dropped


def test_env_override_tightens_k(monkeypatch):
    monkeypatch.setenv("COPILOT_PROJECT_BARS", "2")
    rows = make_candles(wicks={20: (90.0, 120.0), 32: (96.0, 120.0)})
    allowed = trendline(
        "k2",
        "Impulse leg",
        (ts(20), 90.0),
        (ts(41), on_line(41, 20, 90.0, 32, 96.0)),
    )
    rejected = trendline(
        "k5",
        "Impulse leg",
        (ts(20), 90.0),
        (ts(44), on_line(44, 20, 90.0, 32, 96.0)),
    )
    valid, dropped = _filter([allowed, rejected], rows)
    assert [shape["id"] for shape in valid] == ["k2"]
    assert dropped == ["k5"]


def test_polyline_named_triangle_rejected(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(wicks={16: (90.0, 120.0), 24: (100.0, 120.0), 34: (94.0, 120.0)})
    shape = {
        "id": "poly-tri",
        "symbol": "BTCUSDT",
        "interval": "1h",
        "kind": "polyline",
        "name": "Symmetrical triangle",
        "status": "preview",
        "source": "agent",
        "confidence": 0.8,
        "points": [
            {"time": ts(16), "price": 90.0},
            {"time": ts(24), "price": 100.0},
            {"time": ts(34), "price": 94.0},
        ],
        "priceLow": None,
        "priceHigh": None,
    }
    _, reason = review_shape(shape, make_window(rows))
    assert reason == "triangle-polyline"


def test_unpaired_triangle_rail_rejected(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(wicks={16: (90.0, 120.0), 32: (96.0, 120.0)})
    shape = trendline("only", "Triangle lower", (ts(16), 90.0), (ts(32), 96.0))
    valid, dropped = _filter([shape], rows)
    assert valid == []
    assert dropped == ["only"]
    _valid, detailed = filter_preview_details(
        [shape],
        {row.time for row in rows},
        symbol="BTCUSDT",
        interval="1h",
        window=make_window(rows),
    )
    assert detailed == [("only", "unpaired-triangle")]


def test_fib_extension_requires_c_pivot(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(
        wicks={
            8: (80.0, 120.0),
            18: (100.0, 120.0),
            22: (110.0, 150.0),
            30: (110.0, 140.0),
        }
    )
    impulse = trendline("ab", "Impulse AB", (ts(8), 80.0), (ts(18), 100.0))
    extension = trendline("ext", "Fib 1.618", (ts(20), 115.0), (ts(34), 115.0))
    valid, dropped = _filter([impulse, extension], rows)
    assert [shape["id"] for shape in valid] == ["ab"]
    assert dropped == ["ext"]

    pivot = trendline("c-leg", "Pivot C", (ts(22), 150.0), (ts(30), 140.0))
    valid, dropped = _filter([impulse, pivot, extension], rows)
    assert dropped == []
    assert {shape["id"] for shape in valid} == {"ab", "c-leg", "ext"}


def test_misnamed_converging_rails_still_get_apex_cap(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(
        wicks={
            10: (80.0, 120.0),
            12: (110.0, 160.0),
            25: (100.0, 120.0),
            27: (110.0, 140.0),
        }
    )

    def pair(forward_index: int) -> list[dict]:
        return [
            trendline(
                "a",
                "Rail A",
                (ts(10), 80.0),
                (ts(forward_index), on_line(forward_index, 10, 80.0, 25, 100.0)),
            ),
            trendline(
                "b",
                "Rail B",
                (ts(12), 160.0),
                (ts(forward_index), on_line(forward_index, 12, 160.0, 27, 140.0)),
            ),
        ]

    valid, dropped = _filter(pair(44), rows)
    assert dropped == []
    assert {shape["id"] for shape in valid} == {"a", "b"}
    for shape in valid:
        assert max(point["time"] for point in shape["points"]) == ts(44)

    valid, dropped = _filter(pair(45), rows)
    assert valid == []
    assert set(dropped) == {"a", "b"}


def test_cap_keeps_triangle_pair_together(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(
        wicks={
            10: (80.0, 120.0),
            12: (110.0, 160.0),
            25: (100.0, 120.0),
            27: (110.0, 140.0),
        }
    )
    rails = [
        trendline(
            "lower",
            "Triangle lower",
            (ts(10), 80.0),
            (ts(44), on_line(44, 10, 80.0, 25, 100.0)),
            confidence=0.6,
        ),
        trendline(
            "upper",
            "Triangle upper",
            (ts(12), 160.0),
            (ts(44), on_line(44, 12, 160.0, 27, 140.0)),
            confidence=0.61,
        ),
    ]
    extras = [
        trendline(f"h{index}", f"Level {index}", (ts(20), 100.0 + index), (ts(32), 100.0 + index), confidence=0.95)
        for index in range(5)
    ]
    valid, dropped = _filter(extras + rails, rows)
    ids = {shape["id"] for shape in valid}
    assert "lower" in ids and "upper" in ids
    assert len(valid) == 6
    assert len(dropped) == 1
    assert dropped[0].startswith("h")


def test_right_edge_wick_extreme_rejects_mid_body(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    # Last bar has no K bars to its right. It is still the low of the bars that exist.
    rows = make_candles(wicks={20: (90.0, 120.0), 39: (80.0, 140.0)})
    assert 39 >= N - 3
    wick = trendline("wick", "Impulse leg", (ts(20), 90.0), (ts(39), 80.0))
    kept, reason = review_shape(wick, make_window(rows))
    assert reason is None, reason
    assert kept is not None

    mid = (80.0 + 140.0) / 2
    body = trendline("body", "Impulse leg", (ts(20), 90.0), (ts(39), mid))
    _, reason = review_shape(body, make_window(rows))
    assert reason == "non-wick"

    # Index 38's low is not the edge extreme (39 is lower), so its wick is not a swing.
    not_extreme = trendline("inner", "Impulse leg", (ts(20), 90.0), (ts(38), 110.0))
    _, reason = review_shape(not_extreme, make_window(rows))
    assert reason == "not-swing"


def test_shallow_pattern_height_is_impulse_but_compressing_touch_is_not(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    shallow_rows = make_candles(
        wicks={10: (99.0, 110.0), 18: (100.0, 111.0), 26: (98.5, 110.0), 34: (100.0, 111.5)},
        low=100.0,
        high=110.0,
    )
    atr = _wilder_atr(shallow_rows, 14)
    assert atr is not None
    shallow_height = 111.5 - 98.5
    assert shallow_height < IMPULSE_ATR_MULT * atr
    lower = trendline("lower", "Triangle lower", (ts(10), 99.0), (ts(26), 98.5))
    _, reason = review_shape(lower, make_window(shallow_rows))
    assert reason == "impulse"

    # Deep first low, then a second low tucked under a nearby high.
    # Neighbor lows around the second touch sit just above it so it stays a fractal.
    tall_rows = make_candles(
        wicks={
            10: (50.0, 110.0),
            18: (100.0, 160.0),
            **{index: (158.0, 166.0) for index in (23, 24, 25, 27, 28, 29)},
            26: (155.0, 165.0),
            34: (150.0, 162.0),
        }
    )
    atr = _wilder_atr(tall_rows, 14)
    assert atr is not None
    pattern_height = 162.0 - 50.0
    consecutive = 162.0 - 155.0
    assert pattern_height >= IMPULSE_ATR_MULT * atr
    assert consecutive < IMPULSE_ATR_MULT * atr
    deep = trendline("lower", "Triangle lower", (ts(10), 50.0), (ts(26), 155.0))
    high = trendline("upper", "Triangle upper", (ts(18), 160.0), (ts(34), 162.0))
    valid, dropped = _filter([deep, high], tall_rows)
    assert dropped == []
    assert {shape["id"] for shape in valid} == {"lower", "upper"}


def test_right_edge_swing_and_nearby_bar_survive(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(wicks={20: (90.0, 120.0), 37: (96.0, 120.0)})
    edge = trendline("edge", "Impulse leg", (ts(20), 90.0), (ts(37), 96.0))
    kept, reason = review_shape(edge, make_window(rows))
    assert reason is None, reason
    assert kept is not None

    snapped = trendline("snap", "Impulse leg", (ts(21), 90.0), (ts(37), 96.0))
    kept, reason = review_shape(snapped, make_window(rows))
    assert reason is None, reason


def test_mid_body_anchor_is_non_wick(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    rows = make_candles(wicks={20: (90.0, 120.0), 32: (96.0, 120.0)})
    body = trendline("body", "Impulse leg", (ts(20), 105.0), (ts(32), 108.0))
    _, reason = review_shape(body, make_window(rows))
    assert reason == "non-wick"


def test_compressing_second_touch_is_not_impulse_rejected(monkeypatch):
    monkeypatch.delenv("COPILOT_PROJECT_BARS", raising=False)
    # Background 130/145. Second low (125) is much closer to the highs than the
    # first low (80), which used to fail a per-touch 1.5 ATR check.
    rows = make_candles(
        wicks={
            10: (80.0, 145.0),
            16: (130.0, 180.0),
            25: (125.0, 145.0),
            31: (130.0, 170.0),
        },
        low=130.0,
        high=145.0,
    )
    lower = trendline("lower", "Triangle lower", (ts(10), 80.0), (ts(25), 125.0))
    upper = trendline("upper", "Triangle upper", (ts(16), 180.0), (ts(31), 170.0))
    valid, dropped = _filter([lower, upper], rows)
    assert dropped == []
    assert {shape["id"] for shape in valid} == {"lower", "upper"}
