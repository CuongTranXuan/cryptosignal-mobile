#!/usr/bin/env bash
# E2E chart-AI checks through Next.js copilot proxy (expects stub on :8765, web on :3000).
set -euo pipefail
BASE="${BASE_URL:-http://127.0.0.1:3000/v1/copilot}"
OUT="${1:-/opt/cursor/artifacts/e2e-chart-ai-results.txt}"
SSE_CAPTURE="${E2E_SSE_CAPTURE:-/tmp/chart-ai-analyze.sse}"
mkdir -p "$(dirname "$OUT")"
WEB_DIR="$(cd "$(dirname "$0")/.." && pwd)"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

{
  echo "=== E2E chart-AI via $BASE ==="
  echo "time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "web_head: $(git -C "$WEB_DIR/../.." rev-parse HEAD 2>/dev/null || echo unknown)"

  echo ""
  echo "--- GET /styles (elliott empty patterns) ---"
  curl -sf "$BASE/styles" | python3 -c "
import json,sys
d=json.load(sys.stdin)
e=next(s for s in d['styles'] if s['id']=='elliott')
w=next(s for s in d['styles'] if s['id']=='wyckoff')
print('elliott_patterns', len(e['patterns']))
print('wyckoff_patterns', len(w['patterns']))
assert len(e['patterns'])==0 and len(w['patterns'])==0
"
  pass "styles elliott/wyckoff empty patterns"

  echo ""
  echo "--- Session intent create + reload ---"
  SESSION=$(curl -sf -X POST "$BASE/sessions" -H 'Content-Type: application/json' -d '{"title":"e2e","model_id":"agentrouter/deepseek-v4-flash","chart":{"symbol":"BTCUSDT","interval":"1h","from":1,"to":100,"candle_count":50},"intent":{"style":"smc","requested_pattern":"bos"}}')
  SID=$(echo "$SESSION" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
  echo "$SESSION" | python3 -c "import json,sys; print('intent', json.load(sys.stdin).get('intent'))"
  RELOAD=$(curl -sf "$BASE/sessions/$SID")
  echo "$RELOAD" | python3 -c "import json,sys; i=json.load(sys.stdin).get('intent'); assert i and i.get('style')=='smc'; print('reload_ok', i)"
  pass "session intent survives reload"

  echo ""
  echo "--- Analyze with bullish bias (bias conflict) + client schema validation ---"
  CONFLICT_SID=$(curl -sf -X POST "$BASE/sessions" -H 'Content-Type: application/json' -d '{"title":"e2e-bias","model_id":"agentrouter/deepseek-v4-flash","chart":{"symbol":"BTCUSDT","interval":"1h","from":1,"to":100,"candle_count":50},"intent":{"style":"classic","bias":"bullish"}}')
  CONFLICT_ID=$(echo "$CONFLICT_SID" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

  CANDLES='[{"time":1,"open":10,"high":11,"low":9,"close":9.5,"volume":1},{"time":2,"open":9.5,"high":10,"low":8.5,"close":9,"volume":1},{"time":3,"open":9,"high":9.5,"low":8,"close":8.5,"volume":1},{"time":4,"open":8.5,"high":9,"low":7.5,"close":8,"volume":1},{"time":5,"open":8,"high":8.5,"low":7,"close":7.5,"volume":1},{"time":6,"open":7.5,"high":8,"low":6.5,"close":7,"volume":1},{"time":7,"open":7,"high":7.5,"low":6,"close":6.5,"volume":1},{"time":8,"open":6.5,"high":7,"low":5.5,"close":6,"volume":1},{"time":9,"open":6,"high":6.5,"low":5,"close":5.5,"volume":1},{"time":10,"open":5.5,"high":6,"low":4.5,"close":5,"volume":1},{"time":11,"open":5,"high":5.5,"low":4,"close":4.5,"volume":1},{"time":12,"open":4.5,"high":5,"low":3.5,"close":4,"volume":1}]'

  curl -sf -X POST "$BASE/analyze" -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
    -d "{\"symbol\":\"BTCUSDT\",\"interval\":\"1h\",\"from\":1,\"to\":12,\"closedCandles\":$CANDLES,\"existingShapes\":[],\"prompt\":\"e2e bias conflict\",\"session_id\":\"$CONFLICT_ID\"}" \
    > "$SSE_CAPTURE"

  echo "$SSE_CAPTURE" | python3 -c "
import json,re,sys
text=open(sys.argv[1]).read()
assert 'event: meta' in text
assert 'intent_check' in text
meta=re.search(r'event: meta\\ndata: (.+?)\\n\\n', text)
m=json.loads(meta.group(1))
ic=m.get('intent_check') or {}
print('intent_check', ic)
assert ic.get('bias_conflict') is True, ic
assert 'event: regime' in text
assert 'event: analysis' in text
shapes=re.search(r'event: shapes\\ndata: (.+?)\\n\\n', text)
assert shapes, 'missing shapes event'
s=json.loads(shapes.group(1))
raw=s.get('shapes') or []
assert len(raw) <= 6, len(raw)
for sh in raw:
    assert not any(k.startswith('_') for k in sh.keys()), sh.keys()
    assert sh.get('id','').startswith('drw_'), sh.get('id')
    assert sh.get('guardrail'), 'missing guardrail'
print('shapes_count', len(raw))
print('skipped', s.get('skipped'))
skipped=s.get('skipped') or []
codes={row.get('reason_code') for row in skipped}
print('skipped_codes', codes)
" "$SSE_CAPTURE"
  pass "analyze shapes drw_+guardrail <=6, intent_check conflict, regime/analysis events"

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
raw=s.get('shapes') or []
print(raw[0]['id'] if raw else 'drw_e2e_fallback')
")

  for ACTION in keep reject edit delete; do
    BODY="{\"session_id\":\"$CONFLICT_ID\",\"drawing_id\":\"$DRAW_ID\",\"action\":\"$ACTION\"}"
    if [ "$ACTION" = "edit" ]; then
      BODY="{\"session_id\":\"$CONFLICT_ID\",\"drawing_id\":\"$DRAW_ID\",\"action\":\"edit\",\"snapshot\":{\"kind\":\"trendline\",\"points\":[{\"time\":1,\"price\":1},{\"time\":2,\"price\":2}]}}"
    fi
    FB=$(curl -sf -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE/feedback" -H 'Content-Type: application/json' -d "$BODY")
    echo "$ACTION: $FB"
    echo "$FB" | grep -q 'HTTP_CODE:201' || fail "feedback $ACTION not 201"
  done
  pass "feedback keep/reject/edit/delete"

  echo ""
  echo "ALL CHECKS PASSED"
} | tee "$OUT"
