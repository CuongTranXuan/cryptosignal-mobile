import type { Interval, PatternShape } from "./pattern-shape";

/** Coerce common LLM sloppy overlays into PatternShape fields before Zod. */
export function coerceAgentShape(
  raw: unknown,
  ctx: { symbol: string; interval: Interval },
): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };

  // type → kind
  if (out.kind == null && typeof out.type === "string") {
    out.kind = out.type;
  }
  delete out.type;

  // label → name
  if (out.name == null && typeof out.label === "string") {
    out.name = out.label;
  }
  delete out.label;

  // strip unknown decorative keys that break .strict()
  for (const key of ["color", "lineWidth", "role", "style", "stroke", "fill"]) {
    delete out[key];
  }

  if (out.id == null || out.id === "") {
    out.id = `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }
  if (out.symbol == null) out.symbol = ctx.symbol;
  if (out.interval == null) out.interval = ctx.interval;
  if (out.status == null) out.status = "preview";
  if (out.source == null) out.source = "agent";
  if (out.confidence == null) out.confidence = 0.7;
  if (out.priceLow === undefined) out.priceLow = null;
  if (out.priceHigh === undefined) out.priceHigh = null;

  // polyline with 2 points → trendline
  const kind = out.kind;
  const points = out.points;
  if (kind === "polyline" && Array.isArray(points) && points.length === 2) {
    out.kind = "trendline";
  }

  // zone from 2 corners without price band
  if (out.kind === "zone" && Array.isArray(points) && points.length >= 2) {
    const prices = points
      .map((p) => (p && typeof p === "object" ? Number((p as { price?: unknown }).price) : NaN))
      .filter((n) => Number.isFinite(n));
    if (prices.length >= 2 && (out.priceLow == null || out.priceHigh == null)) {
      out.priceLow = Math.min(...prices);
      out.priceHigh = Math.max(...prices);
    }
  }

  // ensure point times are ints
  if (Array.isArray(out.points)) {
    out.points = out.points.map((p) => {
      if (!p || typeof p !== "object") return p;
      const pt = p as { time?: unknown; price?: unknown };
      return {
        time: Math.round(Number(pt.time)),
        price: Number(pt.price),
      };
    });
  }

  return out;
}

export function coerceAgentMarker(
  raw: unknown,
  ctx: { symbol: string; interval: Interval },
): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  if (out.id == null || out.id === "") {
    out.id = `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }
  if (out.symbol == null) out.symbol = ctx.symbol;
  if (out.interval == null) out.interval = ctx.interval;
  if (out.source == null) out.source = "agent";
  if (out.confidence == null) out.confidence = 0.7;
  if (out.time != null) out.time = Math.round(Number(out.time));
  // map common aliases
  if (out.position == null && typeof out.placement === "string") out.position = out.placement;
  if (out.shape == null && typeof out.marker === "string") out.shape = out.marker;
  if (out.side == null && typeof out.direction === "string") out.side = out.direction;
  if (out.side === "long") out.side = "buy";
  if (out.side === "short") out.side = "sell";
  if (out.position == null) out.position = out.side === "sell" ? "aboveBar" : "belowBar";
  if (out.shape == null) {
    out.shape = out.side === "sell" ? "arrowDown" : out.side === "buy" ? "arrowUp" : "circle";
  }
  for (const key of ["color", "placement", "marker", "direction", "label"]) {
    // keep label if present as optional
    if (key === "label") continue;
    delete out[key];
  }
  return out;
}

export type { PatternShape };
