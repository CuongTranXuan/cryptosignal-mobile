/**
 * Chart history screenshots (stub runner): (a) 1h analysis, (b) 4h analysis after switching,
 * (c) back on 1h with its drawings restored, (d) timeframe history chips, (e) N25 note.
 * APP_URL must use `localhost` (Next 16 dev does not hydrate on 127.0.0.1).
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.OUT_DIR ?? "/tmp/chart-history-shots";
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const base = process.env.BASE_URL ?? "http://127.0.0.1:3000/v1/copilot";
const prompt = "e2e real candles cap budget";
const placeholder = "Hỏi về cửa sổ này…";
const N25_NOTE = "Không vẽ được hình mới nào (nến chưa đóng) — giữ các hình trước.";

const fixture = JSON.parse(
  readFileSync(path.join(root, "tests/fixtures/e2e/btcusdt_1h_300.json"), "utf8"),
);

/** 1h fixture → 4h bars, so each timeframe gets its own candles. */
function aggregate(candles, factor) {
  const out = [];
  for (let i = 0; i + factor <= candles.length; i += factor) {
    const g = candles.slice(i, i + factor);
    out.push({
      time: g[0].time,
      open: g[0].open,
      high: Math.max(...g.map((c) => c.high)),
      low: Math.min(...g.map((c) => c.low)),
      close: g.at(-1).close,
      volume: g.reduce((s, c) => s + c.volume, 0),
    });
  }
  return out;
}
const series = { "1h": fixture.candles, "4h": aggregate(fixture.candles, 4) };
const barMs = { "1h": 3_600_000, "4h": 14_400_000 };
const klines = (tf) =>
  (series[tf] ?? series["1h"]).map((c) => [
    c.time * 1000,
    String(c.open),
    String(c.high),
    String(c.low),
    String(c.close),
    String(c.volume),
    c.time * 1000 + (barMs[tf] ?? barMs["1h"]) - 1,
    "0",
    0,
    "0",
    "0",
    "0",
  ]);

mkdirSync(outDir, { recursive: true });

const sessionRes = await fetch(`${base}/sessions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "chart-history",
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
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await context.route("**/api/v3/klines**", (route) => {
  const tf = new URL(route.request().url()).searchParams.get("interval") ?? "1h";
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(klines(tf)) });
});
await context.route("**/api/v3/ticker/24hr**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ symbol: "BTCUSDT", priceChangePercent: "1.23" }),
  }),
);
// N25: push every streamed shape far past the last closed candle (all dropped client-side).
let shiftShapes = false;
await context.route("**/v1/copilot/analyze**", async (route) => {
  if (!shiftShapes) return route.continue();
  const res = await route.fetch();
  const text = await res.text();
  const body = text
    .split("\n\n")
    .map((block) => {
      if (!block.startsWith("event: shapes")) return block;
      const [head, ...rest] = block.split("\n");
      const data = JSON.parse(rest.join("\n").replace(/^data: ?/, ""));
      for (const s of data.shapes ?? []) {
        for (const p of s.points ?? []) p.time += 3600 * 5000;
      }
      return `${head}\ndata: ${JSON.stringify(data)}`;
    })
    .join("\n\n");
  return route.fulfill({ response: res, body });
});

const page = await context.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.addInitScript((sid) => localStorage.setItem("copilot.active_session_id", sid), sessionId);
await page.goto(appUrl, { waitUntil: "networkidle" });
await page.getByTestId("chart-canvas").locator("canvas").first().waitFor({ timeout: 120_000 });

const input = page.getByPlaceholder(placeholder);
const layerCount = () =>
  page.evaluate(() => Number(/Lớp đang hiển thị \((\d+)\)/.exec(document.body.innerText)?.[1] ?? 0));
async function waitIdle() {
  await page.waitForFunction((ph) => {
    const el = document.querySelector(`input[placeholder="${ph}"]`);
    return el instanceof HTMLInputElement && !el.disabled;
  }, placeholder);
}
async function analyze(tf) {
  await waitIdle();
  await input.fill(prompt);
  await input.press("Enter");
  await page.getByTestId(`chart-history-chip-BTCUSDT-${tf}`).waitFor({ timeout: 120_000 });
  await waitIdle();
  await page.waitForTimeout(800);
}
async function switchTf(tf) {
  await page.getByTestId(`tf-${tf}`).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="chart-history-loading"]'));
  await page.waitForTimeout(1200);
}
const shot = (name) => page.screenshot({ path: path.join(outDir, name) });

await analyze("1h");
const h1 = await layerCount();
await shot("a-1h-analysis.png");

await switchTf("4h");
const h4Before = await layerCount();
await analyze("4h");
const h4 = await layerCount();
await shot("b-4h-analysis.png");

await switchTf("1h");
const h1Restored = await layerCount();
await shot("c-1h-restored.png");

await page.screenshot({ path: path.join(outDir, "d-history-chips.png"), clip: { x: 0, y: 0, width: 1000, height: 110 } });
const chips = await page.$$eval('[data-testid^="chart-history-chip-"]', (els) =>
  els.map((e) => `${e.textContent}${e.getAttribute("aria-pressed") === "true" ? " [active]" : ""}`),
);
const dots = await page.$$eval('[data-testid^="tf-dot-"]', (els) => els.map((e) => e.dataset.testid));

shiftShapes = true;
await waitIdle();
await input.fill(prompt);
await input.press("Enter");
await page.waitForFunction((note) => document.body.innerText.includes(note), N25_NOTE, { timeout: 120_000 });
await waitIdle();
await page.waitForTimeout(1500);
const n25Layers = await layerCount();
await page.getByText(N25_NOTE).first().scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await shot("e-n25-note.png");

// Reload: 1h drawings come back from the server doc.
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => /Lớp đang hiển thị \(\d+\)/.test(document.body.innerText), null, { timeout: 60_000 });
const afterReload = await layerCount();
const banner = await page.evaluate(() => document.body.innerText.includes("Không lưu được phiên"));

const result = { h1, h4Before, h4, h1Restored, n25Layers, afterReload, banner, chips, dots, errors: errors.slice(0, 5) };
console.log(JSON.stringify(result, null, 2));
await browser.close();

const ok = h1 > 0 && h4Before === 0 && h4 > 0 && h1Restored === h1 && n25Layers === h1 && afterReload === h1 && !banner;
if (!ok) {
  console.error("chart history capture: unexpected counts");
  process.exit(1);
}
