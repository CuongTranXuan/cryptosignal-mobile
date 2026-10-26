#!/usr/bin/env python3
"""E2E: per-session chart history through the Next.js copilot proxy (stub or real backend).

Usage: BASE_URL=http://127.0.0.1:3101/v1/copilot python3 scripts/e2e-chart-history.py [out.txt]
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:3000/v1/copilot")
FIXTURE = Path(__file__).resolve().parent.parent / "tests/fixtures/e2e/btcusdt_1h_300.json"
lines = []


def log(msg):
    print(msg)
    lines.append(msg)


def call(method, path, body=None, accept="application/json"):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", accept)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode()
            return res.status, raw
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()


def js(raw):
    return json.loads(raw) if raw else None


def check(cond, label):
    if not cond:
        log(f"FAIL: {label}")
        Path(OUT).write_text("\n".join(lines) + "\n")
        sys.exit(1)
    log(f"PASS: {label}")


def sse_events(raw):
    out = []
    for block in raw.split("\n\n"):
        ev, data = "message", []
        for line in block.split("\n"):
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
        if data:
            out.append((ev, json.loads("\n".join(data))))
    return out


OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/e2e-chart-history.txt"
log(f"=== E2E chart history via {BASE} ===")

st, raw = call("POST", "/sessions", {
    "title": "e2e-chart-history", "model_id": "agentrouter/deepseek-v4-flash",
    "chart": {"symbol": "BTCUSDT", "interval": "1h", "from": 1, "to": 100, "candle_count": 300},
})
check(st == 200, f"create session ({st})")
sid = js(raw)["id"]
chart = f"/sessions/{sid}/charts/btcusdt/1h"

st, raw = call("GET", chart)
check(st == 404 and js(raw).get("code") == "chart_state_not_found", "GET unsaved chart → 404 chart_state_not_found")

shape = {
    "id": "human_e2e_1", "symbol": "BTCUSDT", "interval": "1h", "kind": "trendline",
    "name": "Đường e2e", "status": "committed", "source": "human", "confidence": 1.0,
    "points": [{"time": 1792382400, "price": 83000.0}, {"time": 1792598400, "price": 84000.0}],
    "priceLow": None, "priceHigh": None, "origin": "user", "kept": False, "edited": False,
}
st, raw = call("PUT", chart, {"shapes": [shape], "view": {"from": 1792300000, "to": 1792900000}})
doc = js(raw)
check(st == 200 and doc["revision"] == 1 and doc["symbol"] == "BTCUSDT", "PUT create (no revision) → revision 1, symbol uppercased")

st, raw = call("PUT", chart, {"shapes": [shape]})
check(st == 409 and js(raw).get("code") == "revision_conflict", "PUT without revision on existing doc → 409")

st, raw = call("PUT", chart, {"shapes": [shape], "revision": 0})
body = js(raw)
check(st == 409 and body["current"]["revision"] == 1, "PUT stale revision → 409 with current doc")

st, raw = call("PUT", chart, {"shapes": [{**shape, "kept": True}], "revision": 1})
check(st == 200 and js(raw)["revision"] == 2, "PUT base revision → revision 2")

st, raw = call("PUT", f"/sessions/{sid}/charts/BTCUSDT/2h", {"shapes": []})
check(st == 422, f"interval outside enum → 422 ({st})")

st, raw = call("PUT", f"/sessions/{sid}/charts/BTCUSDT/30m", {"shapes": [{**shape, "interval": "30m"}]})
check(st == 200 and js(raw)["interval"] == "30m", "30m chart saves")

too_many = [{**shape, "id": f"h{i}"} for i in range(201)]
st, raw = call("PUT", f"/sessions/{sid}/charts/BTCUSDT/4h", {"shapes": too_many})
check(st == 413 and js(raw).get("code") == "chart_state_too_large", "201 shapes → 413 chart_state_too_large")

data = json.loads(FIXTURE.read_text())
c = data["candles"]
st, raw = call("POST", "/analyze", {
    "symbol": "BTCUSDT", "interval": "1h", "from": c[0]["time"], "to": c[-1]["time"],
    "closedCandles": c, "existingShapes": [], "prompt": "e2e real candles cap budget",
    "candle_count": len(c), "session_id": sid,
}, accept="text/event-stream")
check(st == 200, "analyze with session_id")
events = sse_events(raw)
shapes_ev = [d for e, d in events if e == "shapes"]
metas = [d for e, d in events if e == "meta"]
ai = shapes_ev[-1]["shapes"] if shapes_ev else []
check(len(ai) > 0 and all(s.get("origin") == "ai" and s.get("kept") is False for s in ai),
      f"SSE shapes carry origin/kept/edited ({len(ai)} shapes)")
rev = metas[-1].get("chart_state_revision") if metas else None
check(isinstance(rev, int) and rev == 3, f"final meta chart_state_revision = {rev}")

st, raw = call("GET", chart)
doc = js(raw)
ids = [s["id"] for s in doc["shapes"]]
check(st == 200 and doc["revision"] == rev and "human_e2e_1" in ids and len(ids) == len(ai) + 1,
      "server saved the run and kept the pinned user shape")
check(doc["analysis"] is not None and doc["analyzed_at"], "doc has analysis + analyzed_at")

st, raw = call("GET", f"/sessions/{sid}/charts")
idx = js(raw)["charts"]
check(st == 200 and [f"{r['symbol']}|{r['interval']}" for r in idx][0] == "BTCUSDT|1h"
      and {r["interval"] for r in idx} == {"1h", "30m"}, "index lists 1h + 30m, newest first")

st, _ = call("DELETE", chart)
st2, raw = call("GET", chart)
check(st == 200 and st2 == 404, "DELETE clears the doc")

Path(OUT).write_text("\n".join(lines) + "\n")
log(f"wrote {OUT}")
