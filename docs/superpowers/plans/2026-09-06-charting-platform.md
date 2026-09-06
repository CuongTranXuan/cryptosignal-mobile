# Agent-First Chart Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive methodology evidence into `ChartAnnotation` geometry, render it on Lightweight Charts 5.2 via series primitives, and expose annotations through `market.chart` (Phase 1 in-memory) then persist them with dashboard-protected tRPC (Phase 2).

**Architecture:** Pure `shared/annotation-generator.ts` maps `SignalFinding[]` + candle context to deterministic annotations. Browser `AnnotationPrimitiveManager` attaches `ISeriesPrimitive` instances to the candlestick series. Server extends `getChartWindow` to include annotations; Phase 2 adds `chart_annotations` table and ingest upsert.

**Tech Stack:** lightweight-charts 5.2.0, Expo Web, tRPC 11, Drizzle ORM, Vitest, Zod, Node `crypto` (SHA-256 IDs)

## Global Constraints

- Signals-only boundary: annotations are research evidence, not trade instructions.
- `LIVE_UNCONFIRMED` overlays must remain visually distinct from confirmed closed-candle signals when live layer is added later.
- Browser-only chart rendering (`Platform.OS === "web"`); preserve native fallback message.
- Use LWC v5 APIs only: `chart.addSeries(CandlestickSeries)`, `createSeriesMarkers`, `ISeriesPrimitive` via `series.attachPrimitive` — never `series.setMarkers`.
- `UTCTimestamp` is **seconds**, not milliseconds.
- No inline imports; imports at top of file.
- TypeScript exhaustive switch with `never` in default cases for discriminated unions.
- Cap generated annotations at **20 per chart window**.
- Run `pnpm test:docker` before final checkpoint.
- Follow `.agents/skills/lightweight-charts/SKILL.md` for primitive rendering (`useBitmapCoordinateSpace`, coordinate conversion APIs).
- Git author for commits: `cuongtx <cuongtranxuan.pfiev@gmail.com>`.

---

## File map

| File | Responsibility |
|---|---|
| `shared/chart-types.ts` | Extend annotation union, source enum, render flatten helper types |
| `shared/annotation-generator.ts` | Evidence → geometry (pure, shared server/client tests) |
| `tests/annotation-generator.test.ts` | Generator contract tests |
| `components/charting/primitives/horizontal-level-primitive.ts` | LWC primitive for horizontal levels |
| `components/charting/primitives/trendline-primitive.ts` | LWC primitive for trendlines |
| `components/charting/primitives/zone-primitive.ts` | LWC primitive for zones |
| `components/charting/primitives/annotation-primitive-manager.ts` | Attach/detach primitives on series |
| `components/charting/primitives/annotation-styles.ts` | Bullish/bearish/neutral color mapping |
| `components/charting/use-lightweight-chart.ts` | Wire manager after candlestick series creation |
| `components/charting/research-chart-panel.tsx` | Pass annotations; remove local level UI when server annotations present |
| `components/charting/chart-legend.tsx` | Add methodology overlay legend entries |
| `tests/charting-primitives.contract.test.ts` | Primitive module structure contract |
| `server/db.ts` | Extend `getChartWindow` return type; Phase 2 CRUD helpers |
| `server/chart-annotations.ts` | Zod schemas, upsert/list/delete (Phase 2) |
| `server/routers.ts` | `market.annotations.*` procedures (Phase 2) |
| `drizzle/schema.ts` | `chart_annotations` table |
| `tests/chart-annotations.contract.test.ts` | Zod + DB round-trip (Phase 2) |
| `app/(tabs)/index.tsx` | Pass `chart.data.annotations` to `PriceHistoryChart` |
| `app/(tabs)/signals.tsx` | Same |
| `tests/backend.integration.test.ts` | Assert `market.chart` includes `annotations` |

---

### Task 1: Extend chart annotation types

**Files:**
- Modify: `shared/chart-types.ts`
- Test: `tests/annotation-generator.test.ts` (type import smoke only in Task 2)

**Interfaces:**
- Produces: `ChartAnnotationSource`, `MethodologyOverlayAnnotation`, updated `ChartAnnotation`, `RenderableChartAnnotation`, `flattenAnnotationsForRender(annotations: ChartAnnotation[]): RenderableChartAnnotation[]`

- [ ] **Step 1: Extend `shared/chart-types.ts`**

Add after existing `ZoneAnnotation`:

```typescript
export type ChartAnnotationSource = "ENGINE" | "AGENT" | "DASHBOARD" | "SYSTEM";

export type MethodologyOverlayAnnotation = ChartAnnotationBase & {
  kind: "METHODOLOGY_OVERLAY";
  source: ChartAnnotationSource;
  ruleId: string;
  ruleFamily: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  sourceFindingId: string;
  overlayShape: "HORIZONTAL_LEVEL" | "TRENDLINE" | "ZONE";
  geometry: HorizontalLevelAnnotation | TrendlineAnnotation | ZoneAnnotation;
};

export type ChartAnnotation =
  | HorizontalLevelAnnotation
  | TrendlineAnnotation
  | ZoneAnnotation
  | MethodologyOverlayAnnotation;

/** Concrete shapes passed to LWC primitives after expanding methodology overlays. */
export type RenderableChartAnnotation = HorizontalLevelAnnotation | TrendlineAnnotation | ZoneAnnotation;

export function flattenAnnotationsForRender(annotations: ChartAnnotation[] | undefined): RenderableChartAnnotation[] {
  if (!annotations?.length) return [];
  const flat: RenderableChartAnnotation[] = [];
  for (const annotation of annotations) {
    if (annotation.kind === "METHODOLOGY_OVERLAY") {
      flat.push(annotation.geometry);
      continue;
    }
    flat.push(annotation);
  }
  return flat.slice(0, 20);
}
```

Add optional `source?: ChartAnnotationSource` and `label?: string` to `ChartAnnotationBase` if not already present on base (labels used by primitives).

- [ ] **Step 2: Run typecheck**

Run: `pnpm check`  
Expected: PASS (may require updating `horizontalLevelsFromAnnotations` in `use-lightweight-chart.ts` to handle `METHODOLOGY_OVERLAY` via flatten helper in Task 4).

- [ ] **Step 3: Commit**

```bash
git add shared/chart-types.ts
git commit -m "feat: extend chart annotation types for methodology overlays"
```

---

### Task 2: Annotation generator from signal findings

**Files:**
- Create: `shared/annotation-generator.ts`
- Test: `tests/annotation-generator.test.ts`

**Interfaces:**
- Consumes: `SignalFinding`, `ChartAnnotation` from `shared/chart-types.ts` and `shared/signal-types.ts`
- Produces: `createAnnotationId(parts: string[]): string`, `buildAnnotationsFromSignalContext(input: AnnotationGeneratorInput): ChartAnnotation[]`

```typescript
export type AnnotationGeneratorInput = {
  assetSymbol: string;
  timeframe: string;
  candleCloseTime: string;
  configVersion: number;
  findings: SignalFinding[];
  invalidation: Record<string, unknown>;
  candle: { close: number; low: number; high: number; ema20: number; ema50: number };
  researchWindowStartTime: string;
};
```

- [ ] **Step 1: Write the failing test**

Create `tests/annotation-generator.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { buildAnnotationsFromSignalContext, createAnnotationId } from "../shared/annotation-generator";

const baseInput = {
  assetSymbol: "BTC/USDT",
  timeframe: "1h",
  candleCloseTime: "2026-08-18T10:00:00.000Z",
  configVersion: 3,
  invalidation: { researchOnly: true, close: 64500, atr14: 700 },
  candle: { close: 64500, low: 63800, high: 65100, ema20: 64200, ema50: 63800 },
  researchWindowStartTime: "2026-08-17T06:00:00.000Z",
};

describe("annotation generator", () => {
  it("creates deterministic ids from stable parts", () => {
    const left = createAnnotationId(["BTC/USDT", "1h", "2026-08-18T10:00:00.000Z", "SMC_BULLISH_BOS_PROXY_V1", "HORIZONTAL_LEVEL"]);
    const right = createAnnotationId(["BTC/USDT", "1h", "2026-08-18T10:00:00.000Z", "SMC_BULLISH_BOS_PROXY_V1", "HORIZONTAL_LEVEL"]);
    expect(left).toBe(right);
    expect(left.startsWith("annotation-")).toBe(true);
  });

  it("maps Wyckoff spring finding to support level and sweep zone", () => {
    const annotations = buildAnnotationsFromSignalContext({
      ...baseInput,
      findings: [{
        findingId: "public-1-WYCKOFF_SPRING_PROXY_V1",
        ruleFamily: "WYCKOFF",
        ruleId: "WYCKOFF_SPRING_PROXY_V1",
        direction: "BULLISH",
        strength: 0.16,
        evidence: { priorLow: 63000, close: 64500, closedCandle: true },
      }],
    });
    expect(annotations.some((a) => a.kind === "METHODOLOGY_OVERLAY" && a.overlayShape === "HORIZONTAL_LEVEL")).toBe(true);
    expect(annotations.some((a) => a.kind === "METHODOLOGY_OVERLAY" && a.overlayShape === "ZONE")).toBe(true);
  });

  it("maps SMC bullish BOS to horizontal break level", () => {
    const annotations = buildAnnotationsFromSignalContext({
      ...baseInput,
      findings: [{
        findingId: "public-1-SMC_BULLISH_BOS_PROXY_V1",
        ruleFamily: "SMC",
        ruleId: "SMC_BULLISH_BOS_PROXY_V1",
        direction: "BULLISH",
        strength: 0.18,
        evidence: { priorHigh: 64000, close: 64500, closedCandle: true },
      }],
    });
    const level = annotations.find((a) => a.kind === "METHODOLOGY_OVERLAY" && a.ruleId === "SMC_BULLISH_BOS_PROXY_V1");
    expect(level?.overlayShape).toBe("HORIZONTAL_LEVEL");
    if (level?.kind === "METHODOLOGY_OVERLAY" && level.geometry.kind === "HORIZONTAL_LEVEL") {
      expect(level.geometry.price).toBe(64000);
    }
  });

  it("adds invalidation zone from snapshot close and atr14", () => {
    const annotations = buildAnnotationsFromSignalContext({ ...baseInput, findings: [] });
    const invalidation = annotations.find((a) => a.kind === "ZONE" && a.label === "INVALIDATION");
    expect(invalidation).toBeDefined();
    if (invalidation?.kind === "ZONE") {
      expect(invalidation.topPrice).toBe(65200);
      expect(invalidation.bottomPrice).toBe(63800);
    }
  });

  it("ignores candle-pattern findings", () => {
    const annotations = buildAnnotationsFromSignalContext({
      ...baseInput,
      findings: [{
        findingId: "public-1-DOJI_V1",
        ruleFamily: "CANDLE_PATTERN",
        ruleId: "DOJI_V1",
        direction: "NEUTRAL",
        strength: 0.05,
        evidence: { closedCandle: true },
      }],
    });
    expect(annotations.every((a) => a.kind === "ZONE" ? a.label === "INVALIDATION" : true)).toBe(true);
    expect(annotations.some((a) => a.kind === "METHODOLOGY_OVERLAY" && a.ruleId === "DOJI_V1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/annotation-generator.test.ts`  
Expected: FAIL — cannot find module `../shared/annotation-generator`

- [ ] **Step 3: Implement `shared/annotation-generator.ts`**

```typescript
import { createHash } from "node:crypto";

import type {
  ChartAnnotation,
  ChartAnnotationSource,
  HorizontalLevelAnnotation,
  MethodologyOverlayAnnotation,
  TrendlineAnnotation,
  ZoneAnnotation,
} from "./chart-types";
import type { SignalFinding } from "./signal-types";

const MAX_ANNOTATIONS = 20;
const METHODOLOGY_RULE_IDS = new Set([
  "WYCKOFF_SPRING_PROXY_V1",
  "WYCKOFF_UPTHRUST_PROXY_V1",
  "SMC_BULLISH_BOS_PROXY_V1",
  "SMC_BEARISH_BOS_PROXY_V1",
  "EMA_TREND_V1",
]);

export type AnnotationGeneratorInput = {
  assetSymbol: string;
  timeframe: string;
  candleCloseTime: string;
  configVersion: number;
  findings: SignalFinding[];
  invalidation: Record<string, unknown>;
  candle: { close: number; low: number; high: number; ema20: number; ema50: number };
  researchWindowStartTime: string;
};

export function createAnnotationId(parts: string[]): string {
  return `annotation-${createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 24)}`;
}

function baseFields(input: AnnotationGeneratorInput, source: ChartAnnotationSource = "ENGINE") {
  return {
    assetSymbol: input.assetSymbol,
    timeframe: input.timeframe,
    createdAt: input.candleCloseTime,
    dataQuality: "CLOSED_CANDLE" as const,
    source,
  };
}

function wrapOverlay(
  input: AnnotationGeneratorInput,
  finding: SignalFinding,
  overlayShape: MethodologyOverlayAnnotation["overlayShape"],
  geometry: HorizontalLevelAnnotation | TrendlineAnnotation | ZoneAnnotation,
): MethodologyOverlayAnnotation {
  return {
    id: createAnnotationId([input.assetSymbol, input.timeframe, input.candleCloseTime, finding.ruleId, overlayShape]),
    kind: "METHODOLOGY_OVERLAY",
    source: "ENGINE",
    ruleId: finding.ruleId,
    ruleFamily: finding.ruleFamily,
    direction: finding.direction,
    sourceFindingId: finding.findingId,
    overlayShape,
    geometry,
    ...baseFields(input),
  };
}

function numberField(evidence: Record<string, unknown>, key: string): number | null {
  const value = evidence[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function annotationFromFinding(input: AnnotationGeneratorInput, finding: SignalFinding): ChartAnnotation[] {
  const evidence = finding.evidence;
  const shared = baseFields(input);
  const window = { startTime: input.researchWindowStartTime, endTime: input.candleCloseTime };

  switch (finding.ruleId) {
    case "WYCKOFF_SPRING_PROXY_V1": {
      const priorLow = numberField(evidence, "priorLow");
      if (priorLow === null) return [];
      const level: HorizontalLevelAnnotation = {
        id: createAnnotationId([input.assetSymbol, input.timeframe, input.candleCloseTime, finding.ruleId, "level"]),
        kind: "HORIZONTAL_LEVEL",
        price: priorLow,
        label: "Wyckoff spring support",
        ...shared,
      };
      const zone: ZoneAnnotation = {
        id: createAnnotationId([input.assetSymbol, input.timeframe, input.candleCloseTime, finding.ruleId, "zone"]),
        kind: "ZONE",
        topPrice: priorLow,
        bottomPrice: input.candle.low,
        ...window,
        label: "Spring sweep",
        ...shared,
      };
      return [wrapOverlay(input, finding, "HORIZONTAL_LEVEL", level), wrapOverlay(input, finding, "ZONE", zone)];
    }
    case "WYCKOFF_UPTHRUST_PROXY_V1": {
      const priorHigh = numberField(evidence, "priorHigh");
      if (priorHigh === null) return [];
      const level: HorizontalLevelAnnotation = {
        id: createAnnotationId([input.assetSymbol, input.timeframe, input.candleCloseTime, finding.ruleId, "level"]),
        kind: "HORIZONTAL_LEVEL",
        price: priorHigh,
        label: "Wyckoff upthrust resistance",
        ...shared,
      };
      const zone: ZoneAnnotation = {
        id: createAnnotationId([input.assetSymbol, input.timeframe, input.candleCloseTime, finding.ruleId, "zone"]),
        kind: "ZONE",
        topPrice: input.candle.high,
        bottomPrice: priorHigh,
        ...window,
        label: "Upthrust sweep",
        ...shared,
      };
      return [wrapOverlay(input, finding, "HORIZONTAL_LEVEL", level), wrapOverlay(input, finding, "ZONE", zone)];
    }
    case "SMC_BULLISH_BOS_PROXY_V1": {
      const priorHigh = numberField(evidence, "priorHigh");
      if (priorHigh === null) return [];
      const level: HorizontalLevelAnnotation = {
        id: createAnnotationId([input.assetSymbol, input.timeframe, input.candleCloseTime, finding.ruleId, "level"]),
        kind: "HORIZONTAL_LEVEL",
        price: priorHigh,
        label: "SMC bullish BOS",
        ...shared,
      };
      return [wrapOverlay(input, finding, "HORIZONTAL_LEVEL", level)];
    }
    case "SMC_BEARISH_BOS_PROXY_V1": {
      const priorLow = numberField(evidence, "priorLow");
      if (priorLow === null) return [];
      const level: HorizontalLevelAnnotation = {
        id: createAnnotationId([input.assetSymbol, input.timeframe, input.candleCloseTime, finding.ruleId, "level"]),
        kind: "HORIZONTAL_LEVEL",
        price: priorLow,
        label: "SMC bearish BOS",
        ...shared,
      };
      return [wrapOverlay(input, finding, "HORIZONTAL_LEVEL", level)];
    }
    case "EMA_TREND_V1": {
      const zone: ZoneAnnotation = {
        id: createAnnotationId([input.assetSymbol, input.timeframe, input.candleCloseTime, finding.ruleId, "zone"]),
        kind: "ZONE",
        topPrice: Math.max(input.candle.ema20, input.candle.ema50),
        bottomPrice: Math.min(input.candle.ema20, input.candle.ema50),
        ...window,
        label: "EMA structure band",
        ...shared,
      };
      return [wrapOverlay(input, finding, "ZONE", zone)];
    }
    default:
      return [];
  }
}

function invalidationZone(input: AnnotationGeneratorInput): ZoneAnnotation | null {
  const close = typeof input.invalidation.close === "number" ? input.invalidation.close : input.candle.close;
  const atr14 = typeof input.invalidation.atr14 === "number" ? input.invalidation.atr14 : null;
  if (!Number.isFinite(close) || atr14 === null || !Number.isFinite(atr14)) return null;
  return {
    id: createAnnotationId([input.assetSymbol, input.timeframe, input.candleCloseTime, "INVALIDATION", "ZONE"]),
    kind: "ZONE",
    topPrice: close + atr14,
    bottomPrice: close - atr14,
    startTime: input.researchWindowStartTime,
    endTime: input.candleCloseTime,
    label: "INVALIDATION",
    ...baseFields(input, "SYSTEM"),
  };
}

export function buildAnnotationsFromSignalContext(input: AnnotationGeneratorInput): ChartAnnotation[] {
  const annotations: ChartAnnotation[] = [];
  for (const finding of input.findings) {
    if (!METHODOLOGY_RULE_IDS.has(finding.ruleId)) continue;
    annotations.push(...annotationFromFinding(input, finding));
  }
  const invalidation = invalidationZone(input);
  if (invalidation) annotations.push(invalidation);
  return annotations.slice(0, MAX_ANNOTATIONS);
}
```

Add `source?: ChartAnnotationSource` to `ChartAnnotationBase` in `chart-types.ts` if the spread `...shared` requires it on geometry types.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run tests/annotation-generator.test.ts`  
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add shared/annotation-generator.ts tests/annotation-generator.test.ts shared/chart-types.ts
git commit -m "feat: generate chart annotations from methodology findings"
```

---

### Task 3: LWC annotation primitives

**Files:**
- Create: `components/charting/primitives/annotation-styles.ts`
- Create: `components/charting/primitives/horizontal-level-primitive.ts`
- Create: `components/charting/primitives/trendline-primitive.ts`
- Create: `components/charting/primitives/zone-primitive.ts`
- Create: `components/charting/primitives/annotation-primitive-manager.ts`
- Test: `tests/charting-primitives.contract.test.ts`

**Interfaces:**
- Consumes: `RenderableChartAnnotation`, `flattenAnnotationsForRender`, `chartTimestamp` from `shared/chart-types` and `components/charting/format`
- Produces: `AnnotationPrimitiveManager` class with `sync(series: ISeriesApi<"Candlestick">, annotations: RenderableChartAnnotation[], theme: AnnotationTheme): void` and `detachAll(): void`

- [ ] **Step 1: Write contract test**

Create `tests/charting-primitives.contract.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("charting primitives contract", () => {
  it("exports AnnotationPrimitiveManager and shape primitives", () => {
    const manager = readFileSync(resolve(process.cwd(), "components/charting/primitives/annotation-primitive-manager.ts"), "utf8");
    const horizontal = readFileSync(resolve(process.cwd(), "components/charting/primitives/horizontal-level-primitive.ts"), "utf8");
    expect(manager).toContain("export class AnnotationPrimitiveManager");
    expect(manager).toContain("attachPrimitive");
    expect(horizontal).toContain("ISeriesPrimitive");
    expect(horizontal).toContain("useBitmapCoordinateSpace");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/charting-primitives.contract.test.ts`  
Expected: FAIL — file not found

- [ ] **Step 3: Implement primitives**

`components/charting/primitives/annotation-styles.ts`:

```typescript
export type AnnotationTheme = {
  bullish: string;
  bearish: string;
  neutral: string;
  border: string;
};

export type AnnotationVisualTone = "BULLISH" | "BEARISH" | "NEUTRAL";

export function toneFromLabel(label?: string): AnnotationVisualTone {
  if (!label) return "NEUTRAL";
  const upper = label.toUpperCase();
  if (upper.includes("BEARISH") || upper.includes("UPTHRUST") || upper.includes("INVALIDATION")) return "BEARISH";
  if (upper.includes("BULLISH") || upper.includes("SPRING") || upper.includes("BOS")) return "BULLISH";
  return "NEUTRAL";
}

export function colorForTone(theme: AnnotationTheme, tone: AnnotationVisualTone): string {
  switch (tone) {
    case "BULLISH":
      return theme.bullish;
    case "BEARISH":
      return theme.bearish;
    default:
      return theme.neutral;
  }
}
```

`horizontal-level-primitive.ts` — implement `ISeriesPrimitive` with `paneViews()` returning a renderer that draws a horizontal line at `annotation.price` using `series.priceToCoordinate(price)` and full pane width via `useBitmapCoordinateSpace`. Export `createHorizontalLevelPrimitive(annotation, theme)`.

`zone-primitive.ts` — draw filled rectangle between `topPrice`/`bottomPrice` and `startTime`/`endTime` using `timeScale.timeToCoordinate` + `priceToCoordinate`. Fill at 60% opacity per spec.

`trendline-primitive.ts` — draw line between start/end time+price (include file even if generator does not emit trendlines yet; keeps primitive manager complete).

`annotation-primitive-manager.ts`:

```typescript
import type { ISeriesApi, Time } from "lightweight-charts";

import type { RenderableChartAnnotation } from "@/shared/chart-types";
import type { AnnotationTheme } from "./annotation-styles";

export class AnnotationPrimitiveManager {
  private attached: Array<{ id: string; primitive: unknown }> = [];

  sync(series: ISeriesApi<"Candlestick">, annotations: RenderableChartAnnotation[], theme: AnnotationTheme): void {
    this.detachAll();
    for (const annotation of annotations) {
      const primitive = createPrimitiveForAnnotation(annotation, theme);
      series.attachPrimitive(primitive);
      this.attached.push({ id: annotation.id, primitive });
    }
  }

  detachAll(): void {
    this.attached = [];
  }
}
```

Implement `createPrimitiveForAnnotation` with exhaustive switch on `annotation.kind`.

Reference `.agents/skills/lightweight-charts/SKILL.md` — use `IPrimitivePaneRenderer.draw(target)` with `target.useBitmapCoordinateSpace`.

- [ ] **Step 4: Run contract test**

Run: `pnpm exec vitest run tests/charting-primitives.contract.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/charting/primitives tests/charting-primitives.contract.test.ts
git commit -m "feat: add LWC primitives for chart annotations"
```

---

### Task 4: Wire primitives into chart hook and panel

**Files:**
- Modify: `components/charting/use-lightweight-chart.ts`
- Modify: `components/charting/research-chart-panel.tsx`
- Modify: `components/charting/chart-legend.tsx`

**Interfaces:**
- Consumes: `AnnotationPrimitiveManager`, `flattenAnnotationsForRender`, `RenderableChartAnnotation[]`
- Produces: `useLightweightChart` accepts `annotations?: ChartAnnotation[]` and `annotationTheme`

- [ ] **Step 1: Update `useLightweightChart` options**

Add to `UseLightweightChartOptions`:

```typescript
annotations?: ChartAnnotation[];
annotationTheme: AnnotationTheme;
```

After `candlesticks.setData(...)` and before `createSeriesMarkers`, instantiate `AnnotationPrimitiveManager`, call `manager.sync(candlesticks, flattenAnnotationsForRender(annotations), annotationTheme)`.

Remove `levels` prop and `levels.forEach(... createPriceLine)` — levels now come from annotation primitives only.

Return cleanup: `manager.detachAll()` before `chart.remove()`.

- [ ] **Step 2: Update `ResearchChartPanel`**

- Build `annotationTheme` from `useColors()` (`bullish: colors.success`, etc.).
- Pass `annotations` to `useLightweightChart`.
- Remove `ChartLevelControls`, `localLevels` state, and `createHorizontalLevelAnnotation` when `annotations` prop is defined (server-controlled mode).
- When `annotations` undefined, keep backward-compat local levels OR remove entirely per spec — **remove local level UI entirely** once Task 5 wires server annotations.

- [ ] **Step 3: Extend legend**

Add legend rows: "Methodology overlay (bullish)", "(bearish)", "Invalidation band".

- [ ] **Step 4: Run typecheck and chart module tests**

Run: `pnpm check && pnpm exec vitest run tests/charting-module.contract.test.ts tests/charting-primitives.contract.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/charting
git commit -m "feat: render server annotations on research chart"
```

---

### Task 5: Phase 1 — embed annotations in `market.chart` (in-memory)

**Files:**
- Modify: `server/db.ts` (`getChartWindow`)
- Modify: `app/(tabs)/index.tsx`
- Modify: `app/(tabs)/signals.tsx`
- Modify: `tests/backend.integration.test.ts`

**Interfaces:**
- Consumes: `buildAnnotationsFromSignalContext`, `AnnotationGeneratorInput`
- Produces: `getChartWindow` returns `{ candles, signals, scenarios, annotations: ChartAnnotation[] }`

- [ ] **Step 1: Write failing integration assertion**

In `tests/backend.integration.test.ts`, extend chart test:

```typescript
expect(chart).toMatchObject({
  candles: expect.any(Array),
  signals: expect.any(Array),
  scenarios: expect.any(Array),
  annotations: expect.any(Array),
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm exec vitest run tests/backend.integration.test.ts`  
Expected: FAIL — `annotations` undefined

- [ ] **Step 3: Extend `getChartWindow` in `server/db.ts`**

After loading `latest` candle and `signals`, find matching latest signal snapshot for `latest.candleCloseTime`. Parse `findings` and `invalidation` from JSON. Compute `researchWindowStartTime` from `candles[0].candleCloseTime`.

```typescript
import { buildAnnotationsFromSignalContext } from "../shared/annotation-generator";

// inside getChartWindow, before return:
const latestSignal = signals.find((s) => s.candleCloseTime.getTime() === latest.candleCloseTime.getTime())
  ?? signals[signals.length - 1];
const annotations = latestSignal
  ? buildAnnotationsFromSignalContext({
      assetSymbol,
      timeframe,
      candleCloseTime: latest.candleCloseTime.toISOString(),
      configVersion: latestSignal.configVersion,
      findings: latestSignal.findings as SignalFinding[],
      invalidation: parseJson(latestSignal.invalidationJson, {}),
      candle: {
        close: latest.close,
        low: latest.low,
        high: latest.high,
        ema20: latest.ema20,
        ema50: latest.ema50,
      },
      researchWindowStartTime: candles[0].candleCloseTime.toISOString(),
    })
  : [];
return { candles, signals: mappedSignals, scenarios, annotations };
```

Update empty-return branches to include `annotations: []`.

- [ ] **Step 4: Wire dashboard**

In `index.tsx` and `signals.tsx`:

```tsx
<PriceHistoryChart
  candles={chart.data.candles}
  signals={chart.data.signals}
  assetSymbol={assetSymbol}
  timeframe={timeframe}
  annotations={chart.data.annotations}
/>
```

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run tests/backend.integration.test.ts tests/annotation-generator.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/db.ts app/(tabs)/index.tsx app/(tabs)/signals.tsx tests/backend.integration.test.ts
git commit -m "feat: include generated annotations in market.chart response"
```

---

### Task 6: Phase 2 — persistence schema and migration

**Files:**
- Modify: `drizzle/schema.ts`
- Run: `pnpm db:generate:pg` and review SQL
- Test: `tests/chart-annotations.contract.test.ts`

**Interfaces:**
- Produces: `chartAnnotations` table, `ChartAnnotationRow` type

- [ ] **Step 1: Add table to `drizzle/schema.ts`**

```typescript
export const chartAnnotationSource = pgEnum("chart_annotation_source", ["ENGINE", "AGENT", "DASHBOARD", "SYSTEM"]);

export const chartAnnotations = pgTable(
  "chart_annotations",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    assetSymbol: varchar("assetSymbol", { length: 32 }).notNull(),
    timeframe: varchar("timeframe", { length: 12 }).notNull(),
    candleCloseTime: timestamp("candleCloseTime", { withTimezone: true }).notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    source: chartAnnotationSource("source").notNull(),
    sourceFindingId: varchar("sourceFindingId", { length: 96 }),
    payloadJson: text("payloadJson").notNull(),
    configVersion: integer("configVersion").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("chart_annotations_asset_time_idx").on(table.assetSymbol, table.timeframe, table.candleCloseTime),
  ],
);
```

- [ ] **Step 2: Generate migration**

Run: `pnpm db:generate:pg`  
Review generated SQL in `drizzle-pg/` — confirm **non-destructive** (CREATE TABLE only).

- [ ] **Step 3: Write contract test for Zod payload**

Create `tests/chart-annotations.contract.test.ts` validating a sample `ChartAnnotation` round-trips through `chartAnnotationPayloadSchema` (defined in Task 7).

- [ ] **Step 4: Commit**

```bash
git add drizzle/schema.ts drizzle-pg tests/chart-annotations.contract.test.ts
git commit -m "feat: add chart_annotations schema for persisted overlays"
```

---

### Task 7: Phase 2 — server CRUD and tRPC procedures

**Files:**
- Create: `server/chart-annotations.ts`
- Modify: `server/db.ts`
- Modify: `server/signal-ingest.ts`
- Modify: `server/routers.ts`
- Test: `tests/chart-annotations.contract.test.ts`, `tests/backend.integration.test.ts`

**Interfaces:**
- Produces: `upsertChartAnnotations(annotations: ChartAnnotation[]): Promise<void>`, `listChartAnnotations(query): Promise<ChartAnnotation[]>`, `deleteChartAnnotation(id: string): Promise<void>`

- [ ] **Step 1: Implement `server/chart-annotations.ts`**

Zod schema mirroring `ChartAnnotation` union (use `z.discriminatedUnion` on `kind`). Export `chartAnnotationPayloadSchema`.

- [ ] **Step 2: Add DB helpers in `server/db.ts`**

- `upsertChartAnnotations` — insert on conflict update `payloadJson`, `configVersion`
- `listChartAnnotations({ assetSymbol, timeframe, candleCloseTime? })`
- `deleteChartAnnotation(id)` + `recordAuditEvent("ANNOTATION_DELETED", ...)`

- [ ] **Step 3: Hook signal ingest**

In `server/signal-ingest.ts` after `recordSignalSnapshot`, call `buildAnnotationsFromSignalContext` and `upsertChartAnnotations`. Wrap in try/catch; on failure log audit `ANNOTATION_SKIPPED` without failing ingest.

- [ ] **Step 4: Add tRPC routes in `server/routers.ts`**

```typescript
annotations: router({
  list: dashboardProtectedProcedure
    .input(z.object({ assetSymbol: liveAssetSymbolSchema, timeframe: z.enum(["30m", "1h", "4h"]), candleCloseTime: z.string().datetime().optional() }))
    .query(({ input }) => listChartAnnotations(input)),
  upsert: dashboardProtectedProcedure
    .input(z.object({ annotations: z.array(chartAnnotationPayloadSchema).min(1).max(20) }))
    .mutation(({ input }) => upsertChartAnnotations(input.annotations)),
  delete: dashboardProtectedProcedure
    .input(z.object({ id: z.string().min(8).max(64) }))
    .mutation(({ input }) => deleteChartAnnotation(input.id)),
}),
```

- [ ] **Step 5: Update `getChartWindow` to read persisted annotations**

Prefer DB rows for the visible window; fall back to in-memory generator when table empty (migration period).

- [ ] **Step 6: Run tests**

Run: `pnpm exec vitest run tests/chart-annotations.contract.test.ts tests/backend.integration.test.ts`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/chart-annotations.ts server/db.ts server/signal-ingest.ts server/routers.ts tests
git commit -m "feat: persist and expose chart annotations via tRPC"
```

---

### Task 8: Final validation and docs

**Files:**
- Modify: `docs/PRODUCT_VISION.md` (mark Phase 1/2 complete)
- Modify: `docs/README.md` (link implementation plan)

- [ ] **Step 1: Run full Docker verification**

Run: `pnpm test:docker`  
Expected: all checks PASS

- [ ] **Step 2: Manual browser check**

Run: `pnpm docker:up`  
Open Research workspace → confirm methodology overlays render when signal has Wyckoff/SMC findings.

- [ ] **Step 3: Commit doc updates**

```bash
git add docs/PRODUCT_VISION.md docs/README.md
git commit -m "docs: mark chart annotation platform phases complete"
```

---

## Spec coverage self-review

| Spec requirement | Task |
|---|---|
| Evidence → geometry mapping | Task 2 |
| Deterministic IDs | Task 2 |
| LWC `ISeriesPrimitive` render | Task 3–4 |
| `market.chart` includes annotations | Task 5 |
| Remove local level dual-state | Task 4 |
| Persistence + ingest hook | Task 6–7 |
| `market.annotations.*` tRPC | Task 7 |
| Cap 20 annotations | Task 2 (`MAX_ANNOTATIONS`) |
| Error: skip invalid, don't fail chart | Task 7 ingest try/catch |
| Visual language bullish/bearish/neutral | Task 3 styles |
| Manual drawing deferred | Not in plan |
| Agent harness (Phase 3) | Follow-up plan `2026-09-06-charting-agent-api.md` |

## Follow-up plan (not in this file)

- **Phase 3:** Agent batch upsert + Telegram annotation summary text — separate plan after Phase 2 ships.
- **Phase 4:** Manual drawing toolbar — separate plan.
