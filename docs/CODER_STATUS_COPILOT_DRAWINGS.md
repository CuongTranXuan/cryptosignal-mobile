# Coder Status: Copilot Actionable Drawings

## Role
Coder owns backend in `apps/copilot` only: drawing gate, agent prompts, schema coerce, local smoke. Does not own `apps/web`.

## What I did
- **`drawing_gate.py`:** Per-rail min-span ≥8 bars; triangle treated as two rails with ≥15 each; ATR from pattern height; right-edge wick extreme; ancient window = oldest 35% of history; future k caps 30/24/18/12 with hard max 48; min confidence 0.55; no entry/stop claims in gate output.
- **`agent.py` prompts:** Widen flats where needed; keep per-rail ≥8 in instructions; Vietnamese summary labels with English structural scaffolding.
- **Schema coerce:** Strip unknown keys (avoid `extra=forbid` rejects); `type`→`kind`, `label`→`name`, `ms`→`s`; trendlines collapsed to two defining closed swings and reprojected forward on that slope.
- Live smoke at commit `507d6e3d` (branch may have newer commits; smoke SHA is authoritative for verification below).

## Current situation (as of branch `feat/copilot-actionable-drawings`, PR #5)
- **Live smoke PASS** @ `507d6e3d`: BTCUSDT 15m, 96 closed candles, `from=1790635500`, `lastClosed=1790721000`, `barSec=900`; `dropped=[]`, no skip, no errors.
- **Kept 3 preview shapes:**
```json
[
  {"id":"tl-support-1790700300","kind":"trendline","name":"Hỗ trợ tăng 82.900 → 83.384","status":"preview","confidence":0.62,"points":[{"time":1790700300,"price":82900.0},{"time":1790723700,"price":83599.11111111111}]},
  {"id":"tl-resist-1790687700","kind":"trendline","name":"Kháng cự giảm 84.563,99 → 83.722,01","status":"preview","confidence":0.57,"points":[{"time":1790687700,"price":84563.99},{"time":1790723700,"price":83601.72714285714}]},
  {"id":"zone-range-1790716500","kind":"zone","name":"Vùng tích lũy 83.384–83.722","status":"preview","confidence":0.58,"priceLow":83384.0,"priceHigh":83722.01,"points":[{"time":1790716500,"price":83384.0},{"time":1790719200,"price":83722.01}]}
]
```
- Forward `k=3` ≤ 15m cap 24. Defining hist swings collapsed onto slope (support also used 83384@1790716500; resist also 83722.01@1790719200).
- **Teammate sign-offs:** Researcher spec check PASS on this smoke; UI paint-check OK (client filter keeps all three).

## Soft risks / follow-ups
- OmniRoute may content-block on heavy all-Vietnamese user prompts; mixed VI+EN prompt worked in smoke.
- Prefer zero shapes over fake short rails — do not waive per-rail ≥8.
- Zone alone without converging rails is not a triangle.
- Render/Vercel deploy out of scope for this doc if still blocked elsewhere.

## Definition of done (coder)
- Gate + prompts + coerce landed on PR #5
- At least one live analyze with kept shapes passing numeric rules (done on `507d6e3d`)
- Status doc written (this file)

## Not claiming
Exhaustive symbol/interval coverage; production deploy readiness; `apps/web` behavior beyond reported UI paint-check.
