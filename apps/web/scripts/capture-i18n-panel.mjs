/**
 * C.14 i18n check: run one analyze through the stub, rewrite the SSE so it carries the
 * legacy English backend templates (evidence, conditions, server summary, intent_check,
 * gate reasons), then assert and screenshot that the analysis panel shows Vietnamese only.
 * APP_URL must use `localhost` (Next 16 dev does not hydrate on 127.0.0.1).
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = process.env.OUT_PATH ?? "/opt/cursor/artifacts/i18n-panel.png";
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const base = process.env.BASE_URL ?? "http://127.0.0.1:3000/v1/copilot";
const prompt = "e2e real candles cap budget";
const placeholder = "Hỏi về cửa sổ này…";

const ELLIOTT_MSG =
  "Style elliott has no live v1 detectors; use classic/SMC candidates or no_valid_pattern when nothing fits.";
const SHAPE_EVIDENCE = [
  ["only 2 touches", "role from close: support"],
  ["neckline not broken", "pattern completed"],
  ["only 2 swing touches on tops"],
  ["only 2 swing touches on bottoms"],
];
const SERVER_SUMMARY = [
  "BTCUSDT 1h: chế độ detector là sideway — chưa có xu hướng rõ trên các nến đã đóng.",
  "Kịch bản có điều kiện: nếu đóng cửa dưới 80,784.92 thì bias giảm; nếu giữ trên 80,784.92 thì trung tính/range.",
  "Vô hiệu hóa (detector): close beyond tại 80,784.92.",
  "Ủng hộ: Cấu trúc swing hỗn hợp, chưa rõ xu hướng; ATR14 ≈ 295.38.",
  "Lưu ý kỹ thuật: only 2 touches; role from close: support; neckline not broken.",
  "Chi tiết pick:",
  "Đây không phải tín hiệu vào lệnh; chỉ mô tả geometry trên nến đã đóng.",
].join("\n\n");
/** English words of the templates above; none may be visible in the panel. */
const LEAKS =
  /\b(only \d|touches|role from close|neckline|pattern completed|close beyond|close_below|close_above|detector|overlay|sideway|bias giảm|trung tính\/range|pick:|geometry|has no live|swing touches|Cấu trúc swing|Guardrail)\b/i;

function rewriteEvent(event, data) {
  if (event === "text" && typeof data.delta === "string" && data.delta.includes("Stub server summary")) {
    return { delta: `\n\n${SERVER_SUMMARY}\n` };
  }
  if (event === "shapes") {
    data.shapes = data.shapes.map((shape, i) => {
      if (!shape.guardrail) return shape;
      const guardrail = { ...shape.guardrail, evidence_against: SHAPE_EVIDENCE[i % SHAPE_EVIDENCE.length] };
      if (guardrail.invalidation) guardrail.invalidation = { ...guardrail.invalidation, condition: "close beyond" };
      return { ...shape, guardrail };
    });
    data.skipped = [
      { reason_code: "cap", count: 2 },
      { reason_code: "near-vertical", count: 1 },
    ];
    return data;
  }
  if (event === "analysis") {
    return {
      ...data,
      bias: "bullish",
      evidence_for: ["Cấu trúc swing hỗn hợp, chưa rõ xu hướng", "ATR14 ≈ 295.38"],
      evidence_against: ["only 2 touches", "role from close: support", "neckline not broken"],
      invalidation: { price: 80784.92, condition: "close beyond" },
      confidence: 0.7,
      intent_check: { ...(data.intent_check ?? { detected_regime: "range", bias_conflict: false }), message: ELLIOTT_MSG },
    };
  }
  return data;
}

function rewriteSse(body) {
  return body
    .split("\n\n")
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const dataLine = /^data: (.*)$/m.exec(block)?.[1];
      if (!event || dataLine == null) return block;
      const data = rewriteEvent(event, JSON.parse(dataLine));
      return `event: ${event}\ndata: ${JSON.stringify(data)}`;
    })
    .join("\n\n");
}

const fixture = JSON.parse(readFileSync(path.join(root, "tests/fixtures/e2e/btcusdt_1h_300.json"), "utf8"));
const klinesBody = fixture.candles.map((c) => [
  c.time * 1000,
  String(c.open),
  String(c.high),
  String(c.low),
  String(c.close),
  String(c.volume),
  c.time * 1000 + 3_599_999,
  "0",
  0,
  "0",
  "0",
  "0",
]);

mkdirSync(path.dirname(outPath), { recursive: true });

const sessionRes = await fetch(`${base}/sessions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "i18n-panel",
    model_id: "agentrouter/deepseek-v4-flash",
    chart: {
      symbol: "BTCUSDT",
      interval: "1h",
      from: fixture.candles[0].time,
      to: fixture.candles.at(-1).time,
      candle_count: fixture.candles.length,
    },
    intent: { style: "classic" },
  }),
});
if (!sessionRes.ok) throw new Error(`session create ${sessionRes.status}`);
const { id: sessionId } = await sessionRes.json();

const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || undefined });
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await context.route("**/api/v3/klines**", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(klinesBody) }),
);
await context.route("**/api/v3/ticker/24hr**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ symbol: "BTCUSDT", priceChangePercent: "1.23" }),
  }),
);
await context.route("**/v1/copilot/analyze**", async (route) => {
  const response = await route.fetch();
  const body = rewriteSse(await response.text());
  await route.fulfill({ status: response.status(), headers: response.headers(), body });
});

const page = await context.newPage();
await page.addInitScript((sid) => localStorage.setItem("copilot.active_session_id", sid), sessionId);
await page.goto(appUrl, { waitUntil: "networkidle" });
await page.getByTestId("chart-canvas").locator("canvas").first().waitFor({ timeout: 120_000 });

await page.waitForFunction((ph) => {
  const el = document.querySelector(`input[placeholder="${ph}"]`);
  return el instanceof HTMLInputElement && !el.disabled;
}, placeholder);
const input = page.getByPlaceholder(placeholder);
await input.fill(prompt);
await input.press("Enter");
await page.getByTestId("copilot-analysis-summary").waitFor({ timeout: 120_000 });
await page.waitForFunction(() => /Đã đặt \d+ điểm neo/.test(document.body.innerText), null, {
  timeout: 120_000,
});
await page.waitForTimeout(1000);

const panelText = await page.evaluate(() => {
  const parts = [
    document.querySelector('[data-testid="copilot-analysis-summary"]')?.textContent ?? "",
    ...[...document.querySelectorAll('[data-testid="patterns-guardrail-cell"]')].map((el) => el.textContent ?? ""),
    document.body.innerText,
  ];
  return parts.join("\n");
});
const leak = LEAKS.exec(panelText);
const checks = {
  summary: panelText.includes("Bằng chứng ngược: chỉ 2 lần chạm"),
  guardrail: panelText.includes("đổi vai theo giá đóng cửa: nay là hỗ trợ"),
  condition: panelText.includes("Đóng nến vượt"),
  stream: panelText.includes("chế độ thị trường là đi ngang"),
  leak: leak ? leak[0] : null,
};
console.log(JSON.stringify(checks));

await page.getByTestId("copilot-analysis-summary").scrollIntoViewIfNeeded();
await page.screenshot({ path: outPath });
await browser.close();

if (!checks.summary || !checks.guardrail || !checks.condition || !checks.stream || checks.leak) {
  console.error("i18n regression: English backend text visible in the analysis panel");
  process.exit(1);
}
console.log(outPath);
