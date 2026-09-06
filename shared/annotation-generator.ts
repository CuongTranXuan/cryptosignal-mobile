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
    ...baseFields(input),
    id: createAnnotationId([input.assetSymbol, input.timeframe, input.candleCloseTime, finding.ruleId, overlayShape]),
    kind: "METHODOLOGY_OVERLAY",
    ruleId: finding.ruleId,
    ruleFamily: finding.ruleFamily,
    direction: finding.direction,
    sourceFindingId: finding.findingId,
    overlayShape,
    geometry,
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
