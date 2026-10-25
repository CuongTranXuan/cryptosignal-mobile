/**
 * Targeted screenshots from real analyze SSE + one live UI crop (Elliott intent).
 */
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = "/opt/cursor/artifacts/screenshots";
mkdirSync(outDir, { recursive: true });

const fixture = JSON.parse(
  readFileSync(path.join(root, "tests/fixtures/e2e/btcusdt_1h_300.json"), "utf8"),
);
const base = process.env.BASE_URL ?? "http://127.0.0.1:3000/v1/copilot";
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 12);
}

function parseSse(text) {
  const events = [];
  for (const part of text.split("\n\n")) {
    if (!part.trim()) continue;
    let event = "message";
    const dataLines = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length) events.push({ event, data: JSON.parse(dataLines.join("\n")) });
  }
  return events;
}

async function postAnalyze(candles, sessionId) {
  const body = {
    symbol: fixture.symbol,
    interval: fixture.interval,
    from: candles[0].time,
    to: candles[candles.length - 1].time,
    closedCandles: candles,
    existingShapes: [],
    prompt: "screenshot capture",
    candle_count: candles.length,
    session_id: sessionId,
  };
  const res = await fetch(`${base}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  return await res.text();
}

async function createSession(intent) {
  const res = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "shot",
      model_id: "agentrouter/deepseek-v4-flash",
      chart: {
        symbol: "BTCUSDT",
        interval: "1h",
        from: fixture.candles[0].time,
        to: fixture.candles.at(-1).time,
        candle_count: fixture.candles.length,
      },
      intent,
    }),
  });
  return (await res.json()).id;
}

async function shotLocator(page, locator, filename) {
  await locator.waitFor({ state: "visible", timeout: 30_000 });
  const out = path.join(outDir, filename);
  try {
    unlinkSync(out);
  } catch {
    /* fresh capture */
  }
  await locator.screenshot({ path: out });
  return { out, size: statSync(out).size, hash: sha256(out) };
}

function cardHtml(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
  body{margin:0;background:#0b0e14;color:#eaecef;font:12px system-ui,sans-serif}
  .card{border:1px solid #2b313a;background:#1e2329;border-radius:4px;padding:8px;max-width:360px}
  .muted{color:#848e9c}.warn{color:#f0b90b;border:1px solid rgba(240,185,11,.5);background:rgba(240,185,11,.1);padding:6px;border-radius:4px}
  .btn{margin-right:8px}.keep{color:#0ecb81}.reject{color:#f6465d}
  </style></head><body><div class="card">${title}${body}</div></body></html>`;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 320 } });
const results = [];

const shapeSid = await createSession({ style: "classic" });
const shapeSse = await postAnalyze(fixture.candles, shapeSid);
writeFileSync("/tmp/capture-shape.sse", shapeSse);
const shapeEvents = parseSse(shapeSse);
const shapesPayload = shapeEvents.find((e) => e.event === "shapes")?.data ?? {};
const shape = (shapesPayload.shapes ?? [])[0];
const skipped = shapesPayload.skipped ?? [];
const metaFallback = shapeEvents.some(
  (e) => e.event === "meta" && e.data?.intent_budget_fallback,
);

const sl = fixture.bias_conflict_slice;
const biasSid = await createSession({ style: "classic", bias: "bearish" });
const biasCandles = fixture.candles.slice(sl.start, sl.start + sl.count);
const biasSse = await postAnalyze(biasCandles, biasSid);
const biasMeta = parseSse(biasSse).find((e) => e.event === "meta")?.data?.intent_check;

const { formatInvalidationLine } = await import("../lib/guardrail-format.ts");
const { displayShapeName, formatBiasConflictBannerText } = await import(
  "../lib/copilot-display.ts",
);
const { formatSkippedBreakdown } = await import("../lib/copilot-chart-ai.ts");

const guard = shape?.guardrail ?? {};
const inv = formatInvalidationLine(guard.invalidation, "BTCUSDT") ?? "—";
const evidence =
  (guard.evidence_against ?? []).length > 0
    ? guard.evidence_against.map((l) => `<li>${l}</li>`).join("")
    : `<p class='muted'>Không có bằng chứng trái</p>`;

await page.setContent(
  cardHtml(
    `<div><strong>${displayShapeName(shape?.name ?? "Shape")}</strong> · ${Math.round((shape?.confidence ?? 0) * 100)}%</div>`,
    `<div class="muted" style="margin-top:6px">Bằng chứng trái:</div><ul>${evidence}</ul>
     <div class="muted">Vô hiệu hóa: <span style="color:#eaecef">${inv}</span></div>`,
  ),
);
results.push(await shotLocator(page, page.locator(".card"), "chart-ai-guardrail-evidence.png"));

const feedbackTitle = displayShapeName(shape?.name ?? "Shape");
await page.setContent(
  cardHtml(
    `<div><strong>${feedbackTitle}</strong></div>`,
    `<button class="btn keep">Giữ</button><button class="btn reject">Bỏ</button>`,
  ),
);
results.push(await shotLocator(page, page.locator(".card"), "chart-ai-feedback-buttons.png"));

const biasMsg = formatBiasConflictBannerText(
  { detected_regime: biasMeta?.detected_regime ?? "trend_up", bias_conflict: true },
  "bearish",
);
await page.setContent(cardHtml("", `<div class="warn">${biasMsg}</div>`));
results.push(await shotLocator(page, page.locator(".warn"), "chart-ai-bias-conflict.png"));

const skipFromSse = formatSkippedBreakdown(skipped)?.trim() ?? "";
const skipText =
  skipFromSse ||
  (metaFallback ? "Hình do máy chủ chọn." : "Bỏ qua 0 hình.");
await page.setContent(
  cardHtml(
    `<div class="muted">Tin nhắn Copilot</div>`,
    `<p style="margin-top:8px;max-width:320px">${skipText.replace(/^\n+/, "")}</p>`,
  ),
);
results.push(await shotLocator(page, page.locator("p"), "chart-ai-skipped-breakdown.png"));

const uiPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await uiPage.goto(appUrl, { waitUntil: "networkidle" });
const elliottId = await createSession({ style: "elliott" });
await uiPage.evaluate((id) => {
  localStorage.setItem("copilot.active_session_id", id);
}, elliottId);
await uiPage.reload({ waitUntil: "networkidle" });
await uiPage.waitForTimeout(2000);
results.push(
  await shotLocator(
    uiPage,
    uiPage.locator('[data-testid="copilot-intent-controls"]'),
    "chart-ai-intent-controls-elliott.png",
  ),
);

await browser.close();
console.log(JSON.stringify(results, null, 2));
const hashes = new Set(results.map((r) => r.hash));
if (hashes.size < results.length) {
  console.error("duplicate screenshot hashes");
  process.exit(1);
}
