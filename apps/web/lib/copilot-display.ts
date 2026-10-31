import type { ChartBias, DrawingRegime, DrawingGuardrail } from "./copilot-schema";
import {
  KNOWN_PATTERN_IDS,
  labelForBias,
  labelForPattern,
  type KnownPatternId,
} from "./copilot-chart-ai";
import { formatInvalidationLine } from "./guardrail-format";

export { labelForInvalidationCondition, formatInvalidationLine } from "./guardrail-format";

const REGIME_MARKET_LABEL_VI: Record<DrawingRegime, string> = {
  trend_up: "Xu hướng tăng",
  trend_down: "Xu hướng giảm",
  range: "Đi ngang",
  volatile: "Biến động mạnh",
};

const EN_SHAPE_NAME_RULES: Array<{ pattern: RegExp; id: KnownPatternId }> = [
  { pattern: /inverse\s+head.*shoulder/i, id: "inverse_head_and_shoulders" },
  { pattern: /head.*shoulder/i, id: "head_and_shoulders" },
  { pattern: /double\s+top/i, id: "double_top" },
  { pattern: /double\s+bottom/i, id: "double_bottom" },
  { pattern: /ascending\s+triangle/i, id: "ascending_triangle" },
  { pattern: /descending\s+triangle/i, id: "descending_triangle" },
  { pattern: /symmetrical\s+triangle/i, id: "symmetrical_triangle" },
  { pattern: /channel.*high\s+rail/i, id: "channel_up" },
  { pattern: /channel.*low\s+rail/i, id: "channel_down" },
  { pattern: /channel\s+up/i, id: "channel_up" },
  { pattern: /channel\s+down/i, id: "channel_down" },
  { pattern: /fib\s+retracement/i, id: "fib_retracement" },
  { pattern: /support\s*\/\s*resistance|^s\/r\b|resistance.*flipped|support.*flipped/i, id: "support_resistance" },
  { pattern: /trendline/i, id: "trendline" },
  { pattern: /\bbos\b/i, id: "bos" },
  { pattern: /\bchoch\b/i, id: "choch" },
  { pattern: /\bfvg\b/i, id: "fvg" },
  { pattern: /order\s+block/i, id: "order_block" },
  { pattern: /liquidity/i, id: "liquidity" },
];

/**
 * Detector shape names → Vietnamese, same table as the backend (`vi_text._NAME_VI`), so the
 * chart legend, patterns table and the server's "Lớp phủ sẵn sàng" line use one wording.
 */
const SHAPE_NAME_VI: Record<string, string> = {
  "Resistance trendline": "Đường xu hướng kháng cự",
  "Support trendline": "Đường xu hướng hỗ trợ",
  "Double top": "Hai đỉnh",
  "Double top neckline": "Đường viền cổ hai đỉnh",
  "Double bottom": "Hai đáy",
  "Double bottom neckline": "Đường viền cổ hai đáy",
  "Liquidity highs": "Thanh khoản trên các đỉnh",
  "Liquidity lows": "Thanh khoản dưới các đáy",
  "Ascending triangle": "Tam giác tăng",
  "Descending triangle": "Tam giác giảm",
  "Symmetrical triangle": "Tam giác cân",
  "Channel (high rail)": "Kênh giá (biên trên)",
  "Channel (low rail)": "Kênh giá (biên dưới)",
  "Channel high rail": "Biên trên kênh giá",
  "Channel low rail": "Biên dưới kênh giá",
  "Head and shoulders": "Vai đầu vai",
  "H&S neckline": "Đường viền cổ vai đầu vai",
  "Inverse H&S": "Vai đầu vai ngược",
  "Inverse H&S neckline": "Đường viền cổ vai đầu vai ngược",
  "Fib retracement": "Fibonacci thoái lui",
  "Fib pocket 0.5–0.618": "Vùng Fibonacci 0.5–0.618",
  "Bullish FVG": "FVG tăng",
  "Bearish FVG": "FVG giảm",
  "BOS bullish": "BOS tăng",
  "BOS bearish": "BOS giảm",
  "BOS level": "Mức BOS",
  "CHoCH bullish": "CHoCH tăng",
  "CHoCH bearish": "CHoCH giảm",
  "Bullish order block": "Khối lệnh tăng",
  "Bearish order block": "Khối lệnh giảm",
  "Order block": "Khối lệnh",
};
const SR_ROLE_VI: Record<string, string> = { support: "hỗ trợ", resistance: "kháng cự" };
const RAIL_VI: Record<string, string> = { upper: "cạnh trên", lower: "cạnh dưới" };
const SR_NAME_RE = /^S\/R (?:(support|resistance) \(flipped\) )?(.+)$/;
const FIB_NAME_RE = /^Fib (0\.\d+)$/;
const RAIL_NAME_RE = /^(.+) (upper|lower)$/;

function detectorNameVi(name: string): string | null {
  const exact = SHAPE_NAME_VI[name];
  if (exact) return exact;
  const sr = SR_NAME_RE.exec(name);
  if (sr) {
    const [, role, price] = sr;
    return role ? `Vùng ${SR_ROLE_VI[role]} (đổi vai) ${price}` : `Vùng hỗ trợ/kháng cự ${price}`;
  }
  const fib = FIB_NAME_RE.exec(name);
  if (fib) return `Fibonacci ${fib[1]}`;
  const rail = RAIL_NAME_RE.exec(name);
  if (rail && rail[1] && rail[2] && SHAPE_NAME_VI[rail[1]]) {
    return `${SHAPE_NAME_VI[rail[1]]} (${RAIL_VI[rail[2]]})`;
  }
  return null;
}

export function displayShapeName(backendName: string): string {
  const trimmed = backendName.trim();
  if (!trimmed) return trimmed;
  const detector = detectorNameVi(trimmed);
  if (detector) return detector;
  for (const rule of EN_SHAPE_NAME_RULES) {
    if (rule.pattern.test(trimmed)) return labelForPattern(rule.id);
  }
  const lower = trimmed.toLowerCase();
  for (const id of KNOWN_PATTERN_IDS) {
    if (lower.includes(id.replace(/_/g, " "))) return labelForPattern(id);
  }
  return trimmed;
}

export function formatDetectedRegimeMarketLabel(regime: DrawingRegime | string): string {
  if (regime in REGIME_MARKET_LABEL_VI) {
    return REGIME_MARKET_LABEL_VI[regime as DrawingRegime];
  }
  return String(regime);
}

function inferConflictingUserBias(
  detectedRegime: DrawingRegime,
  explicitBias?: ChartBias | null,
): ChartBias {
  if (explicitBias && explicitBias !== "neutral") return explicitBias;
  if (detectedRegime === "trend_up") return "bearish";
  if (detectedRegime === "trend_down") return "bullish";
  return "neutral";
}

export function formatBiasConflictBannerText(
  intentCheck: { detected_regime: DrawingRegime; bias_conflict: boolean },
  userBias?: ChartBias | null,
): string {
  const bias = inferConflictingUserBias(intentCheck.detected_regime, userBias);
  const regimeLabel = formatDetectedRegimeMarketLabel(intentCheck.detected_regime);
  return `Xu hướng bạn chọn (${labelForBias(bias)}) mâu thuẫn với chế độ thị trường phát hiện (${regimeLabel}); hình vẽ theo chế độ thị trường.`;
}

/** Chat transcript append (leading newlines). */
export function formatBiasConflictChatNotice(
  intentCheck: { detected_regime: DrawingRegime; bias_conflict: boolean },
  userBias?: ChartBias | null,
): string {
  return `\n\n⚠ ${formatBiasConflictBannerText(intentCheck, userBias)}`;
}

export function formatGuardrailInvalidation(
  guardrail: DrawingGuardrail,
  symbol: string,
): string | null {
  return formatInvalidationLine(guardrail.invalidation, symbol);
}
