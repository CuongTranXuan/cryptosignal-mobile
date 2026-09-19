/** Vietnamese UI strings for the Copilot panel (default product language). */

export const COPILOT_TITLE = "Copilot";
export const COPILOT_OFFLINE = "ngắt kết nối";

export const COPILOT_TAB_MANUAL = "Thủ công";
export const COPILOT_TAB_AUTO_DRAW = "Tự vẽ";

export const COPILOT_ACTION_FIND_TRIANGLES = "Tìm tam giác";
export const COPILOT_ACTION_HEAD_SHOULDERS = "Vai đầu vai";
export const COPILOT_ACTION_DRAW_ON_CHART = "Vẽ lên biểu đồ";
export const COPILOT_ACTION_EDIT_COORDS = "Sửa tọa độ";

/** Appended to preset analyze prompts so models reply in Vietnamese despite English technical tails. */
export const COPILOT_VIETNAMESE_OUTPUT_INSTRUCTION =
  "Reply and summarize in Vietnamese; output all text in Vietnamese.";

export const TRIANGLES_PROMPT =
  "Tìm tam giác cân trong cửa sổ nến đã đóng này. Return PatternShape polyline(s). " +
  COPILOT_VIETNAMESE_OUTPUT_INSTRUCTION;

export const HEAD_SHOULDERS_PROMPT =
  "Tìm mẫu vai đầu vai trong cửa sổ nến đã đóng này. Return PatternShape polyline(s). " +
  COPILOT_VIETNAMESE_OUTPUT_INSTRUCTION;

export const AUTO_DRAW_PROMPT =
  "Tự vẽ: cập nhật mẫu hình cho nến đóng mới nhất. Update patterns for the latest closed candle. " +
  COPILOT_VIETNAMESE_OUTPUT_INSTRUCTION;

export const COPILOT_EMPTY_STATE =
  "Hãy nhờ Copilot tìm mẫu hình trong cửa sổ nến đã đóng.";
export const COPILOT_INPUT_PLACEHOLDER = "Hỏi về cửa sổ này…";
export const COPILOT_SEND = "Gửi";
export const COPILOT_LOADING = "Đang phân tích…";

export const COPILOT_ROLE_USER = "bạn";
export const COPILOT_ROLE_AGENT = "Copilot";

export const COPILOT_ERROR = "Copilot lỗi";
export const COPILOT_ERROR_UNAUTHORIZED = "Copilot lỗi: nhà cung cấp không được phép";
export const COPILOT_ERROR_CREDITS_EXHAUSTED = "Copilot lỗi: hết hạn mức nhà cung cấp";
export const COPILOT_ERROR_RATE_LIMITED = "Copilot lỗi: nhà cung cấp giới hạn tần suất";

export function copilotDrewShapes(count: number, lines: string[]): string {
  return `\n\nĐã vẽ ${count} hình trên biểu đồ:\n${lines.join("\n")}`;
}

export const COPILOT_SCROLLED_TO_OVERLAYS = "\nĐã cuộn biểu đồ để hiển thị các lớp phủ.";

export function copilotPlacedMarkers(count: number): string {
  return `\n\nĐã đặt ${count} đánh dấu trên biểu đồ.`;
}

export function copilotSkippedShapes(count: number): string {
  return `\n\n(Bỏ qua ${count} hình không hợp lệ — thiếu trường hoặc thời gian ngoài cửa sổ.)`;
}

export function copilotSkippedMarkers(count: number): string {
  return `\n\n(Bỏ qua ${count} đánh dấu không hợp lệ.)`;
}

export function copilotShapeSummaryLine(
  name: string,
  kind: string,
  confidencePct: number,
  pointCount: number,
): string {
  return `• ${name} (${kind}, ${confidencePct}%, ${pointCount} điểm)`;
}

/** Map known English SSE error payloads from the copilot backend to Vietnamese UI copy. */
export function mapCopilotSseError(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return COPILOT_ERROR;
  const lower = trimmed.toLowerCase();
  if (lower.includes("provider unauthorized")) return COPILOT_ERROR_UNAUTHORIZED;
  if (lower.includes("credits exhausted")) return COPILOT_ERROR_CREDITS_EXHAUSTED;
  if (lower.includes("rate-limited") || lower.includes("rate limited")) {
    return COPILOT_ERROR_RATE_LIMITED;
  }
  if (lower === "copilot failed" || lower.startsWith("copilot failed:")) return COPILOT_ERROR;
  return trimmed;
}

export function copilotRoleLabel(role: "user" | "agent"): string {
  return role === "user" ? COPILOT_ROLE_USER : COPILOT_ROLE_AGENT;
}
