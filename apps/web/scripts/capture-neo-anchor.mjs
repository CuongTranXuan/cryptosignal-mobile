/**
 * Screenshot chart with C.13 neutral "Neo" drawing anchors: drives a real analyze from the
 * chat input (stub runner) and waits for the "Đã đặt N điểm neo" chat line before capturing.
 *
 * APP_URL must use `localhost`: Next 16 dev blocks cross-origin dev resources for
 * 127.0.0.1, so the page never hydrates there and the chart stays blank.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = process.env.OUT_PATH ?? "/opt/cursor/artifacts/chart-neo-anchor.png";
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const base = process.env.BASE_URL ?? "http://127.0.0.1:3000/v1/copilot";
const analyzePrompt = "e2e real candles cap budget";
const ACTIVE_SESSION_KEY = "copilot.active_session_id";

const fixture = JSON.parse(
  readFileSync(path.join(root, "tests/fixtures/e2e/btcusdt_1h_300.json"), "utf8"),
);

function toBinanceKlineRow(candle) {
  const openMs = candle.time * 1000;
  const closeMs = openMs + 3_599_999;
  return [
    openMs,
    String(candle.open),
    String(candle.high),
    String(candle.low),
    String(candle.close),
    String(candle.volume),
    closeMs,
    "0",
    0,
    "0",
    "0",
    "0",
  ];
}

const klinesBody = fixture.candles.map(toBinanceKlineRow);
const tickerBody = { symbol: "BTCUSDT", priceChangePercent: "1.23" };
mkdirSync(path.dirname(outPath), { recursive: true });

const sessionRes = await fetch(`${base}/sessions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "neo-anchor-shot",
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

const browser = await chromium.launch({
  headless: true,
  channel: process.env.PW_CHANNEL || undefined,
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await context.route("**/api/v3/klines**", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(klinesBody),
  });
});
await context.route("**/api/v3/ticker/24hr**", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(tickerBody),
  });
});

const page = await context.newPage();
await page.addInitScript(
  ({ key, sid }) => {
    localStorage.setItem(key, sid);
  },
  { key: ACTIVE_SESSION_KEY, sid: sessionId },
);

await page.goto(appUrl, { waitUntil: "networkidle" });
await page.getByTestId("chart-canvas").locator("canvas").first().waitFor({ timeout: 120_000 });
const input = page.getByPlaceholder("Hỏi về cửa sổ này…");
await input.waitFor({ timeout: 60_000 });
await page.waitForFunction(() => {
  const el = document.querySelector('input[placeholder="Hỏi về cửa sổ này…"]');
  return el instanceof HTMLInputElement && !el.disabled;
});
await input.fill(analyzePrompt);
await input.press("Enter");
const anchorLine = page.getByText(/Đã đặt \d+ điểm neo/);
await anchorLine.waitFor({ timeout: 120_000 });
await anchorLine.scrollIntoViewIfNeeded();
await page.waitForTimeout(1500);

await page.screenshot({ path: outPath });

await browser.close();
console.log(outPath);
