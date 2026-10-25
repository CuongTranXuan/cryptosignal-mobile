import type { AnalyzeMetaEvent, DrawingRegime } from "./copilot-schema";

const HTF_REGIME_VI: Record<DrawingRegime, string> = {
  trend_up: "xu hướng tăng",
  trend_down: "xu hướng giảm",
  range: "đi ngang",
  volatile: "biến động mạnh",
};

export function formatUnixSecondsLocal(
  unixSeconds: number,
  locale?: string,
): string {
  const ms = unixSeconds > 1e12 ? unixSeconds : unixSeconds * 1000;
  return new Intl.DateTimeFormat(locale ?? undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(ms));
}

/** HTF line: regime + last closed candle close time in local timezone. */
export function formatMetaHtfLine(meta: AnalyzeMetaEvent | null | undefined): string | null {
  const htf = meta?.htf;
  if (!htf || typeof htf !== "object") return null;
  const interval = typeof htf.interval === "string" ? htf.interval : null;
  const regime =
    typeof htf.regime === "string" && htf.regime in HTF_REGIME_VI
      ? HTF_REGIME_VI[htf.regime as DrawingRegime]
      : typeof htf.regime === "string"
        ? htf.regime
        : null;
  const closeTime =
    typeof htf.last_closed_time === "number" && Number.isFinite(htf.last_closed_time)
      ? htf.last_closed_time
      : null;
  const closeLabel = closeTime != null ? formatUnixSecondsLocal(closeTime) : null;

  const parts: string[] = [];
  if (interval && regime) parts.push(`Khung cao hơn (${interval}): ${regime}`);
  else if (interval) parts.push(`Khung cao hơn: ${interval}`);
  else if (regime) parts.push(`Khung cao hơn: ${regime}`);

  if (closeLabel) {
    parts.push(`nến đóng lúc ${closeLabel}`);
  }
  if (parts.length === 0) return null;
  return `${parts.join(" — ")}.`;
}
