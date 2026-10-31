#!/usr/bin/env bash
# E2E chart-AI checks through Next.js copilot proxy (expects stub on :8765, web on :3000).
set -euo pipefail
BASE="${BASE_URL:-http://127.0.0.1:3000/v1/copilot}"
OUT="${1:-/opt/cursor/artifacts/e2e-chart-ai-results.txt}"
SSE_CAPTURE="${E2E_SSE_CAPTURE:-/tmp/chart-ai-analyze.sse}"
SSE_BIAS="${E2E_SSE_BIAS:-/tmp/chart-ai-bias.sse}"
SSE_EMPTY="${E2E_SSE_EMPTY:-/tmp/chart-ai-empty.sse}"
FIXTURE="${E2E_FIXTURE:-$(cd "$(dirname "$0")/.." && pwd)/tests/fixtures/e2e/btcusdt_1h_300.json}"
mkdir -p "$(dirname "$OUT")"
WEB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$WEB_DIR/../.." && pwd)"
TMP_ANALYZE="$(mktemp)"
TMP_BIAS="$(mktemp)"
TMP_EMPTY="$(mktemp)"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$TMP_ANALYZE" "$TMP_BIAS" "$TMP_EMPTY" "$COOKIE_JAR"' EXIT
# Sessions belong to the device in the httpOnly csm_device cookie: one jar, like a browser.
curl() { command curl -b "$COOKIE_JAR" -c "$COOKIE_JAR" "$@"; }

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

if [[ ! -f "$FIXTURE" ]]; then
  echo "Fetching Binance fixture..."
  curl -sf 'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=300' \
    | python3 -c "
import json,sys
raw=json.load(sys.stdin)
candles=[{'time':int(r[0]//1000),'open':float(r[1]),'high':float(r[2]),'low':float(r[3]),'close':float(r[4]),'volume':float(r[5])} for r in raw]
json.dump({'symbol':'BTCUSDT','interval':'1h','candles':candles,'bias_conflict_slice':{'start':60,'count':80,'bias':'bearish'}}, sys.stdout)
" > "$FIXTURE"
fi

{
  echo "=== E2E chart-AI via $BASE ==="
  echo "time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "web_head: $(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "fixture: $FIXTURE"

  echo ""
  echo "--- GET /styles (elliott empty patterns) ---"
  curl -sf "$BASE/styles" | python3 -c "
import json,sys
d=json.load(sys.stdin)
e=next(s for s in d['styles'] if s['id']=='elliott')
assert len(e['patterns'])==0
print('elliott_patterns', 0)
"
  pass "styles elliott empty patterns"

  echo ""
  echo "--- Session intent create + reload ---"
  SESSION=$(curl -sf -X POST "$BASE/sessions" -H 'Content-Type: application/json' -d '{"title":"e2e","model_id":"agentrouter/deepseek-v4-flash","chart":{"symbol":"BTCUSDT","interval":"1h","from":1,"to":100,"candle_count":50},"intent":{"style":"smc","requested_pattern":"bos"}}')
  SID=$(echo "$SESSION" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
  RELOAD=$(curl -sf "$BASE/sessions/$SID")
  echo "$RELOAD" | python3 -c "import json,sys; i=json.load(sys.stdin).get('intent'); assert i and i.get('style')=='smc'; print('reload_ok', i)"
  pass "session intent survives reload"

  echo ""
  echo "--- Analyze (300 BTC 1h) shapes, cap, intent_budget_fallback ---"
  SHAPE_SID=$(curl -sf -X POST "$BASE/sessions" -H 'Content-Type: application/json' -d '{"title":"e2e-shapes","model_id":"agentrouter/deepseek-v4-flash","chart":{"symbol":"BTCUSDT","interval":"1h","from":1,"to":100,"candle_count":300},"intent":{"style":"classic"}}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

  python3 -c "
import json
from pathlib import Path
data=json.loads(Path('$FIXTURE').read_text())
c=data['candles']
body={
  'symbol': data['symbol'],
  'interval': data['interval'],
  'from': c[0]['time'],
  'to': c[-1]['time'],
  'closedCandles': c,
  'existingShapes': [],
  'prompt': 'e2e real candles cap budget',
  'candle_count': len(c),
  'session_id': '$SHAPE_SID',
}
open('$TMP_ANALYZE','w').write(json.dumps(body))
"

  curl -sf -X POST "$BASE/analyze" -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
    -d @"$TMP_ANALYZE" > "$SSE_CAPTURE"

  python3 "$WEB_DIR/scripts/e2e-chart-ai-validate.py" "$SSE_CAPTURE"
  pass "non-zero shapes (<=6), cap skipped, intent_budget_fallback meta"

  echo ""
  echo "--- Bias conflict (real detector, bearish vs trend_up window) ---"
  BIAS_SID=$(curl -sf -X POST "$BASE/sessions" -H 'Content-Type: application/json' -d '{"title":"e2e-bias","model_id":"agentrouter/deepseek-v4-flash","chart":{"symbol":"BTCUSDT","interval":"1h","from":1,"to":100,"candle_count":80},"intent":{"style":"classic","bias":"bearish"}}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

  python3 -c "
import json
from pathlib import Path
data=json.loads(Path('$FIXTURE').read_text())
sl=data.get('bias_conflict_slice') or {'start':60,'count':80,'bias':'bearish'}
c=data['candles'][sl['start']:sl['start']+sl['count']]
body={
  'symbol': data['symbol'],
  'interval': data['interval'],
  'from': c[0]['time'],
  'to': c[-1]['time'],
  'closedCandles': c,
  'existingShapes': [],
  'prompt': 'e2e bias conflict real',
  'candle_count': len(c),
  'session_id': '$BIAS_SID',
}
open('$TMP_BIAS','w').write(json.dumps(body))
"

  curl -sf -X POST "$BASE/analyze" -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
    -d @"$TMP_BIAS" > "$SSE_BIAS"

  python3 -c "
import json,re
text=open('$SSE_BIAS').read()
meta=re.search(r'event: meta\\ndata: (.+?)\\n\\n', text)
m=json.loads(meta.group(1))
ic=m.get('intent_check') or {}
print('intent_check', ic)
assert ic.get('bias_conflict') is True, ic
assert ic.get('detected_regime') == 'trend_up', ic
"
  pass "bias conflict from real intent_check (no stub patch)"

  echo ""
  echo "--- Analyze empty shapes (stub prompt, server no-model summary) ---"
  EMPTY_SID=$(curl -sf -X POST "$BASE/sessions" -H 'Content-Type: application/json' -d '{"title":"e2e-empty","model_id":"agentrouter/deepseek-v4-flash","chart":{"symbol":"BTCUSDT","interval":"1h","from":1,"to":100,"candle_count":80},"intent":{"style":"classic"}}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

  python3 -c "
import json
from pathlib import Path
data=json.loads(Path('$FIXTURE').read_text())
c=data['candles'][:80]
body={
  'symbol': data['symbol'],
  'interval': data['interval'],
  'from': c[0]['time'],
  'to': c[-1]['time'],
  'closedCandles': c,
  'existingShapes': [],
  'prompt': 'e2e empty shapes only',
  'candle_count': len(c),
  'session_id': '$EMPTY_SID',
}
open('$TMP_EMPTY','w').write(json.dumps(body))
"

  curl -sf -X POST "$BASE/analyze" -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
    -d @"$TMP_EMPTY" > "$SSE_EMPTY"

  python3 "$WEB_DIR/scripts/e2e-chart-ai-validate-empty.py" "$SSE_EMPTY"
  pass "zero shapes with server Không có mô hình summary"

  echo ""
  echo "--- Zod client parse (vitest) ---"
  (cd "$WEB_DIR" && E2E_SSE_FILE="$SSE_CAPTURE" pnpm exec vitest run tests/e2e-sse-validation.test.ts)
  pass "client SSE schemas accept payload"

  echo ""
  echo "--- POST /feedback 201 (keep, reject, edit, delete) ---"
  DRAW_ID=$(python3 -c "
import json,re
text=open('$SSE_CAPTURE').read()
shapes=re.search(r'event: shapes\\ndata: (.+?)\\n\\n', text)
s=json.loads(shapes.group(1))
print(s['shapes'][0]['id'])
")

  for ACTION in keep reject edit delete; do
    BODY="{\"session_id\":\"$SHAPE_SID\",\"drawing_id\":\"$DRAW_ID\",\"action\":\"$ACTION\"}"
    if [ "$ACTION" = "edit" ]; then
      BODY="{\"session_id\":\"$SHAPE_SID\",\"drawing_id\":\"$DRAW_ID\",\"action\":\"edit\",\"before\":{\"kind\":\"trendline\"},\"after\":{\"kind\":\"trendline\",\"points\":[{\"time\":1,\"price\":1},{\"time\":2,\"price\":2}]}}"
    fi
    FB=$(curl -sf -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE/feedback" -H 'Content-Type: application/json' -d "$BODY")
    echo "$ACTION: $FB"
    echo "$FB" | grep -q 'HTTP_CODE:201' || fail "feedback $ACTION not 201"
  done
  pass "feedback keep/reject/edit/delete"

  echo ""
  echo "--- CI wire Zod contract (pytest) ---"
  (cd "$REPO_ROOT/apps/copilot" && pip install -q -e '.[dev]' && python3 -m pytest -q tests/test_wire_schema.py::test_wire_shapes_pass_web_zod_when_node_available)
  pass "wire Zod contract"

  echo ""
  echo "ALL CHECKS PASSED"
} | tee "$OUT"
