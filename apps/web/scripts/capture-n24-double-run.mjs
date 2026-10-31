/**
 * N24 check: analyze the same window twice from the chat input (stub runner), then assert
 * and screenshot that the chart, Active Layers and patterns table show 6 unique shapes.
 * APP_URL must use `localhost` (Next 16 dev does not hydrate on 127.0.0.1).
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = process.env.OUT_PATH ?? "/opt/cursor/artifacts/n24-double-run.png";
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const base = process.env.BASE_URL ?? "http://127.0.0.1:3000/v1/copilot";
const prompt = "e2e real candles cap budget";
const placeholder = "Hỏi về cửa sổ này…";

const fixture = JSON.parse(
  readFileSync(path.join(root, "tests/fixtures/e2e/btcusdt_1h_300.json"), "utf8"),
);
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
    title: "n24-double-run",
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

const page = await context.newPage();
await page.addInitScript((sid) => localStorage.setItem("copilot.active_session_id", sid), sessionId);
await page.goto(appUrl, { waitUntil: "networkidle" });
await page.getByTestId("chart-canvas").locator("canvas").first().waitFor({ timeout: 120_000 });

const input = page.getByPlaceholder(placeholder);
async function analyzeOnce(run) {
  await page.waitForFunction((ph) => {
    const el = document.querySelector(`input[placeholder="${ph}"]`);
    return el instanceof HTMLInputElement && !el.disabled;
  }, placeholder);
  await input.fill(prompt);
  await input.press("Enter");
  await page.waitForFunction(
    (n) => (document.body.innerText.match(/Đã đặt \d+ điểm neo/g) ?? []).length >= n,
    run,
    { timeout: 120_000 },
  );
}
await analyzeOnce(1);
await analyzeOnce(2);
await page.waitForTimeout(1500);

const counts = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    activeLayers: Number(/(?:Active Layers|Lớp đang hiển thị) \((\d+)\)/.exec(text)?.[1] ?? -1),
    tableTotal: Number(/Hình đang hoạt động: (\d+)/.exec(text)?.[1] ?? -1),
    tableRows: document.querySelectorAll('[data-testid="patterns-guardrail-cell"]').length,
    anchorLines: (text.match(/Đã đặt \d+ điểm neo/g) ?? []).length,
  };
});
console.log(JSON.stringify(counts));

await page.screenshot({ path: outPath });
await browser.close();

if (counts.activeLayers !== 6 || counts.tableTotal !== 6 || counts.tableRows !== 6) {
  console.error("N24 regression: expected 6 unique shapes after two identical runs");
  process.exit(1);
}
console.log(outPath);
