# Platform Component Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure frontend chart components into a `components/charting/` module with shared types and a stable `ResearchChartPanel` API so future work can add persisted drawings, live candle layers, and agent overlays without rewriting the dashboard.

**Architecture:** Extract the monolithic `price-history-chart.tsx` into focused subcomponents and a `useLightweightChart` hook. Define annotation and data-quality types in `shared/chart-types.ts`. Keep `PriceHistoryChart` as a backward-compatible re-export. No behavior change in this phase.

**Tech Stack:** Expo Web, React Native, TradingView Lightweight Charts 5.x, existing `shared/chart-utils.ts`

## Global Constraints

- Signals-only boundary: chart annotations are research aids, not trade instructions.
- `LIVE_UNCONFIRMED` visual layers must remain visually distinct from confirmed closed-candle signals when added later.
- Browser-only chart rendering (`Platform.OS === "web"`); native fallback message preserved.
- No inline imports; imports at top of file.
- Run `pnpm test:docker` before checkpoint.

---

### Task 1: Shared chart types

**Files:**
- Create: `shared/chart-types.ts`
- Test: `tests/charting-module.contract.test.ts`

**Interfaces:**
- Produces: `ChartCandle`, `ChartSignalMarker`, `ChartDataQuality`, `ChartAnnotationKind`, `ChartAnnotation`, `ResearchChartPanelProps`

- [x] **Step 1:** Add typed contracts for candles, signal markers, data quality, and extensible annotation kinds (horizontal level first; trendline/zone reserved).
- [x] **Step 2:** Add contract test asserting exported types and annotation kind union are stable.

### Task 2: Charting module decomposition

**Files:**
- Create: `components/charting/format.ts`
- Create: `components/charting/chart-toolbar.tsx`
- Create: `components/charting/chart-metrics.tsx`
- Create: `components/charting/chart-level-controls.tsx`
- Create: `components/charting/chart-legend.tsx`
- Create: `components/charting/use-lightweight-chart.ts`
- Create: `components/charting/research-chart-panel.tsx`
- Create: `components/charting/index.ts`
- Modify: `components/price-history-chart.tsx` (re-export only)

**Interfaces:**
- Consumes: `shared/chart-types.ts`, `shared/chart-utils.ts`, `hooks/use-colors.ts`
- Produces: `ResearchChartPanel`, `PriceHistoryChart` (alias), `useLightweightChart`

- [x] **Step 1:** Move price/timestamp formatting to `format.ts`.
- [x] **Step 2:** Extract toolbar, metrics, level controls, and legend into presentational components.
- [x] **Step 3:** Move chart lifecycle `useEffect` into `use-lightweight-chart.ts`.
- [x] **Step 4:** Compose `ResearchChartPanel` with optional `annotations` / `onAnnotationsChange` props (levels remain local until persistence lands).
- [x] **Step 5:** Replace `price-history-chart.tsx` body with re-export from `components/charting`.

### Task 3: Documentation and validation

**Files:**
- Create: `docs/PRODUCT_VISION.md`
- Modify: `docs/README.md`
- Modify: `todo.md`

- [x] **Step 1:** Write product vision and gap analysis doc.
- [x] **Step 2:** Link vision doc from `docs/README.md`.
- [x] **Step 3:** Record restructure in `todo.md`.
- [ ] **Step 4:** Run `pnpm test:docker` and fix any failures.

## Follow-up phases (not in this plan)

- **Phase 2:** Persist annotations via tRPC + Drizzle schema.
- **Phase 3:** Live candle layer on `ResearchChartPanel` from Redis snapshot.
- **Phase 4:** Extract `components/platform/workspaces/` from `app/(tabs)/index.tsx`.
- **Phase 5:** AI harness worker service.
