/** Server post-shapes overlay line (C.11 `agent.py`). */
export function isServerOverlayReadyText(delta: string): boolean {
  return delta.includes("Lớp phủ sẵn sàng");
}

/**
 * Join consecutive SSE `text` deltas so blocks do not run together
 * (e.g. `…thị trường.Mô hình` → paragraph break between).
 */
export function joinStreamTextBlocks(previous: string, delta: string): string {
  if (!delta) return previous;
  if (!previous) return delta;
  if (/^\s/.test(delta)) return previous + delta;
  if (/\s$/.test(previous)) return previous + delta;
  return `${previous}\n\n${delta}`;
}
