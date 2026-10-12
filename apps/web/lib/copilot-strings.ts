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
export const COPILOT_ERROR_INVALID_MODEL = "Copilot lỗi: mô hình không hợp lệ hoặc không khả dụng";
export const COPILOT_ERROR_CANDLE_COUNT =
  "Copilot lỗi: số nến vượt giới hạn an toàn của mô hình đã chọn";
export const COPILOT_ERROR_CONTEXT_LENGTH = "Copilot lỗi: cửa sổ ngữ cảnh quá dài cho mô hình này";
export const COPILOT_ERROR_OVER_BUDGET =
  "Copilot lỗi: lịch sử và số nến vượt ngân sách token của mô hình";
export const COPILOT_ERROR_EMPTY_OUTPUT =
  "Mô hình không trả lời — thử ít nến hơn hoặc đổi mô hình";
export const COPILOT_ERROR_MODELS_UNAVAILABLE =
  "Copilot lỗi: không tải được danh sách mô hình từ nhà cung cấp";

export const COPILOT_MODEL_ADVANCED = "Nâng cao";
export const COPILOT_MODEL_SEARCH = "Tìm mô hình…";
export const COPILOT_REASONING_LABEL = "Mức lý luận";
export const COPILOT_REASONING_OFF = "Tắt";
export const COPILOT_REASONING_LOW = "Thấp";
export const COPILOT_REASONING_MEDIUM = "Trung bình";
export const COPILOT_REASONING_HIGH = "Cao";
export const COPILOT_EFFECTIVE_CANDLES = "Đã dùng {count} nến";
export const COPILOT_EFFECTIVE_CANDLES_CLAMPED = "Đã dùng {count} nến (đã giới hạn)";

export const COPILOT_MODEL_PICKER_LABEL = "Mô hình";
export const COPILOT_MODEL_PICKER_PLACEHOLDER = "Chọn mô hình…";
export const COPILOT_CANDLE_COUNT_LABEL = "Số nến phân tích";
export const COPILOT_CANDLE_CUSTOM = "Tùy chỉnh";
export const COPILOT_SESSIONS_TITLE = "Phiên";
export const COPILOT_SESSION_NEW = "Phiên mới";
export const COPILOT_SESSION_RENAME = "Đổi tên";
export const COPILOT_SESSION_DELETE = "Xóa";
export const COPILOT_SESSION_DELETE_CONFIRM = "Xóa phiên này?";
export const COPILOT_SESSION_EMPTY = "Chưa có phiên — tạo phiên mới để lưu lịch sử.";
export const COPILOT_MODEL_LIMITS_PREFIX = "Giới hạn";

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
  if (lower.includes("provider unauthorized") || lower.includes("không được ủy quyền")) {
    return COPILOT_ERROR_UNAUTHORIZED;
  }
  if (lower.includes("credits exhausted") || lower.includes("hết credits")) {
    return COPILOT_ERROR_CREDITS_EXHAUSTED;
  }
  if (
    lower.includes("rate-limited") ||
    lower.includes("rate limited") ||
    lower.includes("giới hạn tốc độ")
  ) {
    return COPILOT_ERROR_RATE_LIMITED;
  }
  if (lower.includes("invalid model") || lower.includes("mô hình không hợp lệ")) {
    return COPILOT_ERROR_INVALID_MODEL;
  }
  if (lower.includes("candle_count") || lower.includes("số nến")) {
    return COPILOT_ERROR_CANDLE_COUNT;
  }
  if (lower.includes("context length") || lower.includes("cửa sổ ngữ cảnh")) {
    return COPILOT_ERROR_CONTEXT_LENGTH;
  }
  if (
    lower === "copilot failed" ||
    lower.startsWith("copilot failed:") ||
    lower.startsWith("copilot thất bại")
  ) {
    return COPILOT_ERROR;
  }
  return trimmed;
}

export function copilotRoleLabel(role: "user" | "agent", modelLabel?: string): string {
  if (role === "user") return COPILOT_ROLE_USER;
  return modelLabel ? `${COPILOT_ROLE_AGENT} · ${modelLabel}` : COPILOT_ROLE_AGENT;
}
