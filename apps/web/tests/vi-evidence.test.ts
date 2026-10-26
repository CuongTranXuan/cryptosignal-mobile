import { describe, expect, it } from "vitest";
import {
  filterStructuralEvidenceAgainst,
  formatAnalysisSummaryVi,
  formatSkippedBreakdown,
  labelForRegime,
  parseAnalysisSseEvent,
} from "../lib/copilot-chart-ai";
import { DrawingGuardrailSchema } from "../lib/copilot-schema";
import { formatInvalidationLine, labelForInvalidationCondition } from "../lib/guardrail-format";
import { formatMetaHtfLine } from "../lib/htf-format";
import {
  evidenceItemText,
  evidenceTexts,
  translateBackendText,
  translateServerText,
} from "../lib/vi-evidence";

/** English words used by the backend templates; none may survive translation. */
const ENGLISH_LEAKS =
  /\b(only|touches?|swing|role|from|close|support|resistance|neckline|not|broken|pattern|completed|detectors?|overlay|sideway|range|bias|pick|geometry|style|has|live|use|candidates|when|nothing|fits|beyond|close_below|close_above|trend_up|trend_down|volatile|no_valid_pattern)\b/gi;
function englishWords(text: string): string[] {
  return text.match(ENGLISH_LEAKS) ?? [];
}

describe("translateBackendText: every known backend template", () => {
  const cases: Array<[string, string]> = [
    ["only 2 touches", "chỉ 2 lần chạm"],
    ["only 3 touches", "chỉ 3 lần chạm"],
    ["only 2 swing touches on tops", "chỉ 2 lần chạm đỉnh"],
    ["only 2 swing touches on bottoms", "chỉ 2 lần chạm đáy"],
    ["role from close: support", "đổi vai theo giá đóng cửa: nay là hỗ trợ"],
    ["role from close: resistance", "đổi vai theo giá đóng cửa: nay là kháng cự"],
    ["neckline not broken", "chưa phá đường viền cổ"],
    ["pattern completed", "mô hình đã hoàn tất"],
    ["Cấu trúc swing hỗn hợp, chưa rõ xu hướng", "Cấu trúc đỉnh/đáy hỗn hợp, chưa rõ xu hướng"],
    ["Đỉnh/đáy cao hơn trên các swing gần đây", "Đỉnh/đáy cao hơn trên các nhịp sóng gần đây"],
    ["Đỉnh/đáy thấp hơn trên các swing gần đây", "Đỉnh/đáy thấp hơn trên các nhịp sóng gần đây"],
    [
      "Thiên kiến người dùng không khớp chế độ detector; lớp phủ theo chế độ detector.",
      "Thiên kiến người dùng không khớp chế độ thị trường phát hiện; lớp phủ theo chế độ thị trường.",
    ],
    [
      "Style elliott has no live v1 detectors; use classic/SMC candidates or no_valid_pattern when nothing fits.",
      "Phong cách Elliott chưa có bộ phát hiện trực tiếp; dùng ứng viên Cổ điển/SMC hoặc báo không có mẫu hình hợp lệ khi không có gì phù hợp.",
    ],
  ];
  it.each(cases)("%s", (input, expected) => {
    expect(translateBackendText(input)).toBe(expected);
    expect(englishWords(translateBackendText(input))).toEqual([]);
  });

  it("reformats numeric params with the market price formatter", () => {
    expect(translateBackendText("ATR14 ≈ 295.38")).toBe(
      "Biên độ dao động trung bình ATR14 ≈ 295.38",
    );
    expect(translateBackendText("ATR14 ≈ 1295.5")).toBe(
      "Biên độ dao động trung bình ATR14 ≈ 1,295.50",
    );
    expect(translateBackendText("ATR14 ≈ 0.0123", "XRPUSDT")).toBe(
      "Biên độ dao động trung bình ATR14 ≈ 0.0123",
    );
  });

  it("returns unknown text unchanged (never drops information)", () => {
    expect(translateBackendText("volume weak")).toBe("volume weak");
    expect(translateBackendText("Giá trên EMA50, độ dốc EMA20 dương")).toBe(
      "Giá trên EMA50, độ dốc EMA20 dương",
    );
    expect(translateBackendText("")).toBe("");
  });
});

describe("evidence items: coded text first, translator for legacy strings", () => {
  it("uses `text` as-is when a code is present", () => {
    expect(
      evidenceItemText({ code: "only_n_touches", params: { n: 2 }, text: "chỉ 2 lần chạm" }),
    ).toBe("chỉ 2 lần chạm");
  });

  it("falls back to the code when a coded item has no text", () => {
    expect(evidenceItemText({ code: "future_code" })).toBe("future code");
  });

  it("translates legacy strings and uncoded objects", () => {
    expect(evidenceItemText("only 2 touches")).toBe("chỉ 2 lần chạm");
    expect(evidenceItemText({ text: "pattern completed" })).toBe("mô hình đã hoàn tất");
    expect(evidenceTexts(["only 2 touches", { text: "" }, "volume yếu"])).toEqual([
      "chỉ 2 lần chạm",
      "volume yếu",
    ]);
  });

  it("guardrail schema accepts old strings and new coded items", () => {
    const g = DrawingGuardrailSchema.parse({
      regime: "range",
      confidence: 0.7,
      evidence_against: [
        "only 2 touches",
        { code: "role_flip", params: { role: "support" }, text: "đổi vai: hỗ trợ" },
      ],
      invalidation: {
        price: 80784.92,
        condition: "close_below",
        code: "close_below",
        params: { price: 80784.92 },
        text: "đóng cửa dưới 80,784.92",
      },
    });
    expect(g.evidence_against.map((item) => evidenceItemText(item))).toEqual([
      "chỉ 2 lần chạm",
      "đổi vai: hỗ trợ",
    ]);
    expect(formatInvalidationLine(g.invalidation, "BTCUSDT")).toBe("đóng cửa dưới 80,784.92");
  });
});

describe("invalidation conditions", () => {
  it("maps legacy tokens including `close beyond`", () => {
    expect(labelForInvalidationCondition("close beyond")).toBe("Đóng nến vượt");
    expect(labelForInvalidationCondition("close_beyond")).toBe("Đóng nến vượt");
    expect(formatInvalidationLine({ price: 80784.92, condition: "close beyond" }, "BTCUSDT")).toBe(
      "80,784.92 — Đóng nến vượt",
    );
  });

  it("puts the price before coded text that does not include it", () => {
    expect(
      formatInvalidationLine({ price: 100, code: "close_above", text: "đóng cửa trên" }, "BTCUSDT"),
    ).toBe("100.00 — đóng cửa trên");
  });
});

describe("analysis card and other panel lines are all Vietnamese", () => {
  const analysis = parseAnalysisSseEvent({
    bias: "bullish",
    evidence_for: ["Cấu trúc swing hỗn hợp, chưa rõ xu hướng", "ATR14 ≈ 295.38"],
    evidence_against: ["only 2 touches", "role from close: support", "neckline not broken"],
    invalidation: { price: 80784.92, condition: "close beyond" },
    confidence: 0.7,
  })!;

  it("renders the TÓM TẮT PHÂN TÍCH body without English", () => {
    const text = formatAnalysisSummaryVi(analysis, "BTCUSDT")!;
    expect(text).toContain("Thiên hướng phát hiện: Tăng.");
    expect(text).toContain(
      "Bằng chứng thuận: Cấu trúc đỉnh/đáy hỗn hợp, chưa rõ xu hướng; Biên độ dao động trung bình ATR14 ≈ 295.38",
    );
    expect(text).toContain(
      "Bằng chứng ngược: chỉ 2 lần chạm; đổi vai theo giá đóng cửa: nay là hỗ trợ; chưa phá đường viền cổ",
    );
    expect(text).toContain("Vô hiệu hóa: 80,784.92 — Đóng nến vượt");
    expect(englishWords(text)).toEqual([]);
  });

  it("still drops the bias-conflict line after translation", () => {
    const msg = "Thiên kiến người dùng không khớp chế độ detector; lớp phủ theo chế độ detector.";
    const lines = filterStructuralEvidenceAgainst({
      evidence_against: [msg, "only 2 touches"],
      intent_check: { detected_regime: "trend_up", bias_conflict: true, message: msg },
    });
    expect(lines).toEqual(["chỉ 2 lần chạm"]);
  });

  it("labels unknown regimes, htf regimes and skipped reasons in Vietnamese", () => {
    expect(labelForRegime("squeeze")).toBe("chế độ khác (squeeze)");
    expect(
      formatMetaHtfLine({
        model: "m",
        candle_count_requested: 1,
        candle_count_used: 1,
        clamped: false,
        htf: { interval: "4h", regime: "trend_down" },
      }),
    ).toBe("Khung cao hơn (4h): xu hướng giảm.");
    expect(
      formatSkippedBreakdown([
        { reason_code: "low-conf", count: 1 },
        { reason_code: "future_reason", count: 2 },
      ]),
    ).toBe("\n\nBỏ qua 3 hình: 1 độ tin cậy thấp, 2 lý do khác (future reason).");
  });
});

describe("translateServerText: server-authored stream summary", () => {
  it("translates the server_summary.py sentences and keeps numbers", () => {
    const input = [
      "BTCUSDT 1h: chế độ detector là sideway — chưa có xu hướng rõ trên các nến đã đóng.",
      "Kịch bản có điều kiện: nếu đóng cửa dưới 80,784.92 thì bias giảm; nếu giữ trên 80,784.92 thì trung tính/range.",
      "Thiên hướng overlay (máy chủ): trung tính / range theo detector.",
      "Vô hiệu hóa (detector): close_below tại 80,784.92.",
      "Lưu ý: Thiên kiến người dùng không khớp chế độ detector; lớp phủ theo chế độ detector.",
      "Ủng hộ: Cấu trúc swing hỗn hợp, chưa rõ xu hướng; ATR14 ≈ 295.38.",
      "Lưu ý kỹ thuật: only 2 touches; role from close: support.",
      "Chi tiết pick:",
      "Đây không phải tín hiệu vào lệnh; chỉ mô tả geometry trên nến đã đóng.",
    ].join("\n\n");
    const out = translateServerText(input);
    expect(out).toContain("chế độ thị trường là đi ngang");
    expect(out).toContain("thì thiên hướng giảm");
    expect(out).toContain("trung tính/đi ngang");
    expect(out).toContain("Thiên hướng lớp phủ (máy chủ): trung tính / đi ngang theo bộ phát hiện.");
    expect(out).toContain("Vô hiệu hóa (bộ phát hiện): đóng nến dưới tại 80,784.92.");
    expect(out).toContain(
      "Lưu ý: Thiên kiến người dùng không khớp chế độ thị trường phát hiện; lớp phủ theo chế độ thị trường.",
    );
    expect(out).toContain(
      "Ủng hộ: Cấu trúc đỉnh/đáy hỗn hợp, chưa rõ xu hướng; Biên độ dao động trung bình ATR14 ≈ 295.38.",
    );
    expect(out).toContain("Lưu ý kỹ thuật: chỉ 2 lần chạm; đổi vai theo giá đóng cửa: nay là hỗ trợ.");
    expect(out).toContain("Chi tiết lựa chọn:");
    expect(out).toContain("chỉ mô tả hình học trên nến đã đóng");
    expect(englishWords(out)).toEqual([]);
  });

  it("translates rule-path regime ids and drop-note reasons", () => {
    expect(
      translateServerText("Phát hiện BTCUSDT 1h: chế độ trend_up, chọn mẫu theo quy tắc."),
    ).toBe("Phát hiện BTCUSDT 1h: chế độ xu hướng tăng, chọn mẫu theo quy tắc.");
    expect(
      translateServerText("\n\nĐã bỏ qua 2 hình không hợp lệ [tl-1:low-conf, sr-2:near-vertical]."),
    ).toBe("\n\nĐã bỏ qua 2 hình không hợp lệ [tl-1: độ tin cậy thấp, sr-2: gần thẳng đứng].");
  });

  it("leaves other text untouched", () => {
    const prose = "Đang phân tích BTCUSDT 1h (299 nến đã đóng)…";
    expect(translateServerText(prose)).toBe(prose);
  });
});
