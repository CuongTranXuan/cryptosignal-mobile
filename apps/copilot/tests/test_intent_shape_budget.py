from cryptosignal_copilot.candidates import CandidateCatalog, DrawingCandidate
from cryptosignal_copilot.drawing_gate import MAX_SHAPES
from cryptosignal_copilot.drawing_intent import (
    CandidateDrawingIntent,
    total_shape_cost,
)


def test_total_shape_cost_sums_candidate_shapes():
    catalog = CandidateCatalog(
        symbol="X",
        interval="1h",
        regime="range",
        atr=1.0,
        zigzag=[],
        candidates=[
            DrawingCandidate(
                id="fib_aaaaaaaaaaaa",
                pattern_id="fib_retracement",
                style="classic",
                score=0.9,
                swing_ids=[],
                name="fib",
                shapes=[{"id": f"s{i}"} for i in range(4)],
            ),
            DrawingCandidate(
                id="tri_bbbbbbbbbbbb",
                pattern_id="ascending_triangle",
                style="classic",
                score=0.8,
                swing_ids=[],
                name="tri",
                shapes=[{"id": "a"}, {"id": "b"}],
            ),
        ],
    )
    intents = [
        CandidateDrawingIntent(candidate_id="fib_aaaaaaaaaaaa"),
        CandidateDrawingIntent(candidate_id="tri_bbbbbbbbbbbb"),
    ]
    total, costs = total_shape_cost(intents, catalog)
    assert total == 6
    assert total <= MAX_SHAPES
    intents.append(CandidateDrawingIntent(candidate_id="tri_bbbbbbbbbbbb"))
    total2, _ = total_shape_cost(intents, catalog)
    assert total2 == 8
