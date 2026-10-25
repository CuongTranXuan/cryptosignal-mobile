#!/usr/bin/env python3
"""Validate chart-AI E2E SSE capture (real-candle analyze)."""

from __future__ import annotations

import json
import re
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
    metas = [d for e, d in events if e == "meta"]
    shapes_ev = next((d for e, d in events if e == "shapes"), None)
    assert shapes_ev is not None, "missing shapes event"
    raw = shapes_ev.get("shapes") or []
    assert len(raw) > 0, "expected non-zero shapes"
    assert len(raw) <= 6, len(raw)
    for sh in raw:
        assert sh.get("id", "").startswith("drw_"), sh.get("id")
        assert sh.get("guardrail"), "missing guardrail"
        assert not any(str(k).startswith("_") for k in sh.keys())

    skipped = shapes_ev.get("skipped") or []
    codes = {row.get("reason_code") for row in skipped}
    assert "cap" in codes, skipped

    assert any(m.get("intent_budget_fallback") for m in metas), metas

    ic = (metas[0] if metas else {}).get("intent_check") or {}
    print(
        json.dumps(
            {
                "shapes_count": len(raw),
                "skipped": skipped,
                "intent_budget_fallback": any(m.get("intent_budget_fallback") for m in metas),
                "intent_check": ic,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
