# UI Developer Status: Copilot Actionable Drawings

## BLUF
**Web client paints agent trendlines/polylines/zones with one forward-projected endpoint per shape, using server-aligned bar seconds and extrapolated chart coordinates; filter/projection math passes the `507d6e3d` BTCUSDT 15m smoke. Apex+3 triangle clamp and live browser screenshot QA are out of scope for this pass.**

## Role
UI developer owns chart overlay, forward time projection, client-side shape filtering, and analysis-window padding. Researcher = spec (`docs/RESEARCHER_STATUS_COPILOT_DRAWINGS.md`). Coder = gate/prompts (`docs/CODER_STATUS_COPILOT_DRAWINGS.md`).

## What shipped (UI)
- **Future-time shape projection:** Agent shapes may include a point with `time` beyond the last closed candle. `chart-canvas` sets `rightOffset` from `effectiveProjectionBars` and routes `timeToCoordinate` through `timeToCoordinateWithProjection` so forward endpoints render in chart whitespace.
- **Human draw unchanged:** Snap-to-nearest closed candle only; no freehand into empty future (`shape-overlay` / existing closed-time rules).
- **Analysis window:** Padding/hints updated where needed so forward overlays fit the visible window (`analysis-window.ts`; `estimateBarSeconds` for duration padding only).
- **Gap 5 — bar seconds alignment:** Forward filter uses `intervalBarSeconds(interval)` (1m→60, 15m→900, 1h→3600, 4h→14400, 1d→86400), matching server `drawing_gate.bar_seconds`. Median-gap `estimateBarSeconds` is not used for projection acceptance.
- **Draw API (client enforces / expects):** Kinds `trendline` (2 points), `polyline` (≥3), `zone` (`priceLow`/`priceHigh` + points). No first-class fib kind — fib renders as horizontal equal-price trendlines + zone pocket. Anchors are unix-second `time` + `price`. Future **k** caps align with server: 1m≤30, 15m/1h≤24, 4h≤18, 1d≤12, hard max 48 (`maxProjectionBarsForInterval` / `HARD_MAX_PROJECTION_BARS`).
- **Apex+3:** Not implemented client-side; server computes triangle apex from rails (no apex field in this pass).

## Paint-check: coder smoke `507d6e3d` (BTCUSDT 15m)
| Field | Value |
|-------|--------|
| `lastClosed` | `1790721000` |
| Kept | 2 forward trendlines + 1 zone |
| `dropped` | `[]` |
| Trendlines | 2 points each; forward endpoint `1790723700` → Δ2700s / 900s = **k=3** (≤24 for 15m) — **kept** |
| Zone | Historical points + `priceLow`/`priceHigh` — **paints** |

Researcher spec check: PASS. UI filter/projection math: PASS (unit tests + smoke numbers above). Live terminal screenshot not captured for this status commit.

## Tests
Web unit tests were green on prior UI commits (~87–89 cases); **not re-run** in this documentation-only commit.

## Key files (`apps/web`)
| Area | Path |
|------|------|
| Projection grid, k caps, `intervalBarSeconds`, `filterShapesWithProjection` | `lib/shape-projection.ts` |
| Copilot ingest + filter wiring | `lib/use-copilot.ts` |
| Pixel mapping | `lib/overlay-map.ts` |
| Chart `rightOffset` + extrapolated coordinates | `components/chart-canvas.tsx` |
| SVG overlay | `components/shape-overlay.tsx` |
| Analysis padding (`estimateBarSeconds`) | `lib/analysis-window.ts` |
| Tests | `tests/shape-projection.test.ts`, `tests/use-copilot.test.ts`, `tests/overlay-map.test.ts` |

## Definition of done (UI developer)
- Forward-projected agent endpoints visible on chart with server-aligned bar seconds
- Client filter accepts server-kept shapes within k caps on projection grid
- Paint-check PASS for `507d6e3d` smoke (above)
- Status doc written (this file)

## Not claiming
- Client-side apex+3 triangle clamp or apex overlay field
- Exhaustive symbol/interval live visual QA or screenshot archive
- End-to-end product sign-off without coder/researcher gate + broader QA
