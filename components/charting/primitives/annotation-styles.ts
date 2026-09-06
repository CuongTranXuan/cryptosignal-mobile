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
  if (upper.includes("INVALIDATION")) return "NEUTRAL";
  if (upper.includes("BEARISH") || upper.includes("UPTHRUST")) return "BEARISH";
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

export function withAlpha(hexColor: string, alpha: number): string {
  if (hexColor.startsWith("rgba(") || hexColor.startsWith("rgb(")) return hexColor;
  const normalized = hexColor.replace("#", "");
  if (normalized.length !== 6) return hexColor;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
