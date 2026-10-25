/**
 * Screenshot chart with C.13 neutral "Neo" drawing anchors (stub analyze + session reload).
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = "/opt/cursor/artifacts/chart-neo-anchor.png";
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";
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

async function postAnalyze(candles, sessionId) {
  const body = {
    symbol: fixture.symbol,
    interval: fixture.interval,
    from: candles[0].time,
    to: candles[candles.length - 1].time,
    closedCandles: candles,
    existingShapes: [],
    prompt: analyzePrompt,
    candle_count: candles.length,
    session_id: sessionId,
  };
  const res = await fetch(`${base}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`analyze ${res.status}`);
  await res.text();
}

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
const { id: sessionId } = await sessionRes.json();
await postAnalyze(fixture.candles, sessionId);

const browser = await chromium.launch({ headless: true });
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
await page.getByTestId("chart-canvas").waitFor({ state: "visible", timeout: 120_000 });
await page.waitForTimeout(3000);

const chart = page.getByTestId("chart-canvas");
await chart.screenshot({ path: outPath });

await browser.close();
console.log(outPath);
