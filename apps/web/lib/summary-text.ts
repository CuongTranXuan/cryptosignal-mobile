/**
 * The backend saves all streamed assistant text as `summary_text`, including progress
 * lines that only make sense while the stream runs. Strip them for the history bar and
 * restored chat messages.
 */
const PROGRESS_LINE_RES: readonly RegExp[] = [
  /^Đang phân tích\b.*…\s*$/u, // "Đang phân tích BTCUSDT 1h (299 nến đã đóng)…"
  /^Mô hình đã xong\b.*$/u, // "Mô hình đã xong. Đang dựng lớp phủ…"
  /^Đang dựng lớp phủ…\s*$/u,
];

export function isProgressLine(line: string): boolean {
  const t = line.trim();
  return t !== "" && PROGRESS_LINE_RES.some((re) => re.test(t));
}

/** Text without progress lines; blank runs collapsed. Null when nothing is left. */
export function cleanSummaryText(text: string | null | undefined): string | null {
  if (!text) return null;
  const kept = text.split(/\r?\n/).filter((line) => !isProgressLine(line));
  const out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out || null;
}
