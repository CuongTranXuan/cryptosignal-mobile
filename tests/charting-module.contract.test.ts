import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { ChartAnnotationKind } from "../shared/chart-types";

describe("charting module contract", () => {
  it("exports a stable ResearchChartPanel entry point and annotation kinds", () => {
    const indexSource = readFileSync(resolve(process.cwd(), "components/charting/index.ts"), "utf8");
    const panelSource = readFileSync(resolve(process.cwd(), "components/charting/research-chart-panel.tsx"), "utf8");
    const typesSource = readFileSync(resolve(process.cwd(), "shared/chart-types.ts"), "utf8");

    expect(indexSource).toContain("ResearchChartPanel");
    expect(panelSource).toContain("export function ResearchChartPanel");
    expect(panelSource).toContain("onAnnotationsChange");
    expect(typesSource).toContain("HORIZONTAL_LEVEL");
    expect(typesSource).toContain("TRENDLINE");
    expect(typesSource).toContain("ZONE");
  });

  it("keeps PriceHistoryChart as a backward-compatible alias", () => {
    const legacySource = readFileSync(resolve(process.cwd(), "components/price-history-chart.tsx"), "utf8");
    expect(legacySource).toContain("ResearchChartPanel as PriceHistoryChart");
  });

  it("reserves annotation kinds for future drawing tools", () => {
    const kinds: ChartAnnotationKind[] = ["HORIZONTAL_LEVEL", "TRENDLINE", "ZONE", "SIGNAL_MARKER", "METHODOLOGY_OVERLAY"];
    expect(kinds).toHaveLength(5);
  });
});
