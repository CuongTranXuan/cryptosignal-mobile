"""Shared in-play / window rules between detectors and drawing_gate."""

from __future__ import annotations

from cryptosignal_copilot.drawing_gate import (
    ANCIENT_FRACTION,
    DrawingWindow,
    apply_preview_gate,
    review_shape,
)


def anchor_in_play(touch_time: int, window_start: int, window_end: int) -> bool:
    """True when the anchor is not ancient (same rule as drawing_gate._is_ancient)."""
    if window_end <= window_start:
        return True
    fraction = (touch_time - window_start) / (window_end - window_start)
    return fraction >= ANCIENT_FRACTION


def split_gate_and_cap_drops(
    dropped: list[tuple[str, str]],
) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    gate = [(shape_id, reason) for shape_id, reason in dropped if reason != "cap"]
    cap = [(shape_id, reason) for shape_id, reason in dropped if reason == "cap"]
    return gate, cap


def candidate_passes_gate(
    shapes: list[dict],
    window: DrawingWindow,
) -> bool:
    for shape in shapes:
        reviewed, _reason = review_shape(shape, window)
        if reviewed is None:
            return False
    return True


def prefilter_candidate(
    shapes: list[dict[str, object]],
    window: DrawingWindow,
) -> str | None:
    """Per-candidate gate check (no cross-candidate batch pairing). Returns drop reason or None."""
    if not candidate_passes_gate(shapes, window):
        return "review_shape"
    staged = [dict(shape) for shape in shapes]
    _kept, batch_dropped = apply_preview_gate(staged, window)
    for _shape_id, reason in batch_dropped:
        if reason != "cap":
            return reason
    return None
