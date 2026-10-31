#!/usr/bin/env python3
"""Validate chart-AI E2E SSE capture for zero-shape (server summary) path."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for part in text.split("\n\n"):
        if not part.strip():
            continue
        event = "message"
        data_lines: list[str] = []
        for line in part.split("\n"):
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].strip())
        if data_lines:
            events.append((event, json.loads("\n".join(data_lines))))
    return events


def main() -> int:
    sse_path = Path(sys.argv[1])
    text = sse_path.read_text()
    events = parse_sse(text)
    shapes_ev = next((d for e, d in events if e == "shapes"), None)
    assert shapes_ev is not None, "missing shapes event"
    raw = shapes_ev.get("shapes") or []
    assert len(raw) == 0, f"expected zero shapes, got {len(raw)}"

    deltas = [
        str(d.get("delta") or "")
        for e, d in events
        if e == "text"
    ]
    joined = "".join(deltas)
    assert "Không có mô hình hợp lệ" in joined, joined[:200]
    assert "Lớp phủ sẵn sàng" not in joined, "empty path should not emit overlay-ready text"

    analysis = next((d for e, d in events if e == "analysis"), None)
    assert analysis is not None, "missing analysis event"
    assert analysis.get("no_valid_pattern") is True, analysis
    against = analysis.get("evidence_against") or []
    assert not any("thiên kiến" in str(x).lower() for x in against), against

    print(json.dumps({"shapes_count": 0, "server_no_model_summary": True}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
