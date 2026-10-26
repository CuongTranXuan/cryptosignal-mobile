/**
 * Vietnamese display for backend evidence, invalidation conditions and server messages.
 *
 * Newer backends send `{code, params, text}` items whose `text` is already Vietnamese.
 * Older backends send English (or mixed) template strings; this module maps the known
 * templates to Vietnamese and returns any other text unchanged, so nothing is dropped.
 */

import type { EvidenceItem } from "./copilot-schema";
import { formatMarketPrice } from "./format-market-price";

type Rule = {
  pattern: RegExp;
  render: (match: RegExpExecArray, symbol: string) => string;
};

const ROLE_VI: Record<string, string> = { support: "hỗ trợ", resistance: "kháng cự" };

const STYLE_VI: Record<string, string> = {
  classic: "Cổ điển",
  smc: "SMC",
  elliott: "Elliott",
  wyckoff: "Wyckoff",
};

const REGIME_VI: Record<string, string> = {
  trend_up: "xu hướng tăng",
  trend_down: "xu hướng giảm",
  range: "đi ngang",
  volatile: "biến động mạnh",
};

/** Detector gate reasons (`drawing_gate.py`) as shown in the server drop note. */
const GATE_REASON_VI: Record<string, string> = {
  "low-conf": "độ tin cậy thấp",
  ancient: "quá cũ",
  "beyond-k": "ngoài cửa sổ nến",
  "apex+3": "quá đỉnh tam giác",
  "no-candles": "không có nến",
  "min-span": "quá ngắn",
  "near-vertical": "gần thẳng đứng",
  "non-wick": "không chạm râu nến",
  "not-swing": "không phải đỉnh/đáy",
  "single-touch": "chỉ 1 lần chạm",
  "triangle-polyline": "tam giác sai dạng",
  "unpaired-triangle": "tam giác thiếu cạnh",
  "triangle-structure": "cấu trúc tam giác sai",
  "fib-no-C": "Fibonacci thiếu điểm C",
  cap: "vượt giới hạn 6 hình",
};

const NUMBER = String.raw`(-?\d[\d,]*(?:\.\d+)?)`;

function price(raw: string, symbol: string): string {
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? formatMarketPrice(value, symbol) : raw;
}

/** Whole-string templates: English detector strings and mixed-language Vietnamese ones. */
const EVIDENCE_RULES: Rule[] = [
  { pattern: /^only (\d+) touches$/i, render: (m) => `chỉ ${m[1]} lần chạm` },
  {
    pattern: /^only (\d+) swing touches on tops$/i,
    render: (m) => `chỉ ${m[1]} lần chạm đỉnh`,
  },
  {
    pattern: /^only (\d+) swing touches on bottoms$/i,
    render: (m) => `chỉ ${m[1]} lần chạm đáy`,
  },
  {
    pattern: /^role from close: (support|resistance)$/i,
    render: (m) => `đổi vai theo giá đóng cửa: nay là ${ROLE_VI[m[1]!.toLowerCase()]}`,
  },
  { pattern: /^neckline not broken$/i, render: () => "chưa phá đường viền cổ" },
  { pattern: /^pattern completed$/i, render: () => "mô hình đã hoàn tất" },
  {
    pattern: /^Cấu trúc swing hỗn hợp, chưa rõ xu hướng$/,
    render: () => "Cấu trúc đỉnh/đáy hỗn hợp, chưa rõ xu hướng",
  },
  {
    pattern: /^Đỉnh\/đáy (cao|thấp) hơn trên các swing gần đây$/,
    render: (m) => `Đỉnh/đáy ${m[1]} hơn trên các nhịp sóng gần đây`,
  },
  {
    pattern: new RegExp(String.raw`^ATR(\d+) ≈ ${NUMBER}$`),
    render: (m, symbol) => `Biên độ dao động trung bình ATR${m[1]} ≈ ${price(m[2]!, symbol)}`,
  },
  {
    pattern: /^Thiên kiến người dùng không khớp chế độ detector; lớp phủ theo chế độ detector\.?$/,
    render: () =>
      "Thiên kiến người dùng không khớp chế độ thị trường phát hiện; lớp phủ theo chế độ thị trường.",
  },
  {
    pattern:
      /^Style (\w+) has no live v1 detectors; use classic\/SMC candidates or no_valid_pattern when nothing fits\.?$/i,
    render: (m) =>
      `Phong cách ${STYLE_VI[m[1]!.toLowerCase()] ?? m[1]} chưa có bộ phát hiện trực tiếp; ` +
      "dùng ứng viên Cổ điển/SMC hoặc báo không có mẫu hình hợp lệ khi không có gì phù hợp.",
  },
];

/** Translate one known backend template; unknown text is returned unchanged. */
export function translateBackendText(text: string, symbol = "BTCUSDT"): string {
  const trimmed = text.trim();
  for (const rule of EVIDENCE_RULES) {
    const match = rule.pattern.exec(trimmed);
    if (match) return rule.render(match, symbol);
  }
  return text;
}

/** Display text for an evidence item: coded items use their `text`, legacy strings are translated. */
export function evidenceItemText(item: EvidenceItem, symbol = "BTCUSDT"): string {
  if (typeof item === "string") return translateBackendText(item, symbol);
  if (item.code) return item.text?.trim() || item.code.replace(/_/g, " ");
  return translateBackendText(item.text ?? "", symbol);
}

/** Coded items when the backend sent them, else the legacy string array. */
export function preferEvidenceItems(
  items: readonly EvidenceItem[] | undefined,
  legacy: readonly EvidenceItem[] | undefined,
): readonly EvidenceItem[] {
  return items && items.length > 0 ? items : (legacy ?? []);
}

export function evidenceTexts(items: readonly EvidenceItem[] | undefined, symbol = "BTCUSDT"): string[] {
  return (items ?? []).map((item) => evidenceItemText(item, symbol)).filter((line) => line.trim() !== "");
}

/** Stable React key / comparison value (raw backend text, before translation). */
export function evidenceItemRaw(item: EvidenceItem): string {
  return typeof item === "string" ? item : (item.text ?? item.code ?? "");
}

export function labelForGateReason(reason: string): string {
  return GATE_REASON_VI[reason] ?? reason;
}

function regimeVi(regime: string): string {
  return REGIME_VI[regime] ?? regime;
}

/** Sentence-level fixes for the server-authored stream summary (`server_summary.py`). */
const SUMMARY_PHRASES: Array<[RegExp, string | ((...groups: string[]) => string)]> = [
  [/chế độ detector là sideway/g, "chế độ thị trường là đi ngang"],
  [/chế độ detector là/g, "chế độ thị trường là"],
  [/Thiên hướng overlay \(máy chủ\)/g, "Thiên hướng lớp phủ (máy chủ)"],
  [/trung tính \/ range theo detector/g, "trung tính / đi ngang theo bộ phát hiện"],
  [/(tăng|giảm) theo detector\./g, (_m, dir) => `${dir} theo bộ phát hiện.`],
  [/Vô hiệu hóa \(detector\)/g, "Vô hiệu hóa (bộ phát hiện)"],
  [/thì bias theo hướng phá/g, "thì thiên hướng theo hướng phá"],
  [/thì bias (tăng|giảm)/g, (_m, dir) => `thì thiên hướng ${dir}`],
  [/thì đổi bias/g, "thì đổi thiên hướng"],
  [/coi là range/g, "coi là đi ngang"],
  [/trung tính\/range/g, "trung tính/đi ngang"],
  [/quan sát range/g, "quan sát vùng đi ngang"],
  [/Chi tiết pick:/g, "Chi tiết lựa chọn:"],
  [/chỉ mô tả geometry trên nến đã đóng/g, "chỉ mô tả hình học trên nến đã đóng"],
  [/\bclose_below\b/g, "đóng nến dưới"],
  [/\bclose_above\b/g, "đóng nến trên"],
  [/\bclose beyond\b/g, "đóng nến vượt"],
  [/chế độ (trend_up|trend_down|range|volatile)\b/g, (_m, regime) => `chế độ ${regimeVi(regime)}`],
  [
    /Đã bỏ qua (\d+) hình không hợp lệ \[([^\]]*)\]/g,
    (_m, count, codes) => {
      const reasons = codes
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const extra = /^\+\d+$/.test(entry);
          if (extra) return entry;
          const sep = entry.lastIndexOf(":");
          if (sep < 0) return labelForGateReason(entry);
          return `${entry.slice(0, sep)}: ${labelForGateReason(entry.slice(sep + 1))}`;
        });
      return `Đã bỏ qua ${count} hình không hợp lệ [${reasons.join(", ")}]`;
    },
  ],
];

const EVIDENCE_LIST_LINE = /^(Ủng hộ|Lưu ý kỹ thuật|Lưu ý): (.+?)(\.?)$/;

/**
 * Translate known English/jargon phrases in server-authored stream text. Text the
 * backend did not author (LLM prose, user input) does not match and stays unchanged.
 */
export function translateServerText(text: string, symbol = "BTCUSDT"): string {
  let out = text;
  for (const [pattern, replacement] of SUMMARY_PHRASES) {
    out =
      typeof replacement === "string"
        ? out.replace(pattern, replacement)
        : out.replace(pattern, (...args) => replacement(...(args.slice(0, -2) as string[])));
  }
  return out
    .split("\n")
    .map((line) => {
      const match = EVIDENCE_LIST_LINE.exec(line);
      if (!match) return line;
      const body = match[2]!;
      const whole = translateBackendText(body, symbol);
      if (whole !== body) return `${match[1]}: ${whole}`;
      const items = body.split("; ").map((item) => translateBackendText(item, symbol));
      return `${match[1]}: ${items.join("; ")}${match[3]}`;
    })
    .join("\n");
}
