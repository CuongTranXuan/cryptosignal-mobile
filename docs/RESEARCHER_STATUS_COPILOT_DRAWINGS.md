# Researcher Status: Copilot Actionable Drawings

## Role
Researcher owns feature research/planning and drawing-pattern rules. Coder = backend gate/prompts. UI developer = overlay/projection.

## What I did
- Locked actionable drawing spec: swing fractal anchors, still-in-play, per-pattern geometry for trendline/channel/triangle/fib (fib = trendlines+zone, no fib kind), future k caps by interval, apex+3 for triangles, reject rules.
- Reviewed PR #5 gate vs spec; flagged gaps (triangle structure, fib C pivot, apex name-coupling, cap-6 orphan, client barSec median). Most closed in later commits.
- Ruled against waiving per-rail min-span; required server coerce for type/label/extras and trendline collapse to 2 swings + slope-projected forward.

## Current situation (as of tip `507d6e3d`)
- Live smoke PASS (spec check): BTCUSDT 15m, kept 2 forward trendlines (support+resistance converging) + accumulation zone; dropped=[]; forward k=3 ≤24.
- Not a named triangle; still usable structure.
- UI paint verification still outstanding (UI developer).
- Remaining soft risks: fib extensions still largely prompt-only for C-pivot; apex pairing still name-sensitive for triangles; model may still emit mid-body before coerce.

## Definition of done (researcher)
- Spec locked and encoded
- At least one live analyze with kept shapes that pass the numeric rules (done on `507d6e3d`)
- Status doc written (this file)

## Not claiming
Full product done — UI must confirm lines paint; more symbols/intervals not exhaustively tested.
