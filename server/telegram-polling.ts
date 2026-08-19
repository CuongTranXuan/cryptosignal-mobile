import { getBotConfig, getTelegramUpdateOffset, hasRecentSignalAlert, listSignalSnapshots, recordAuditEvent, setBotPaused, setTelegramUpdateOffset, updateBotConfig } from "./db";
import type { SignalSnapshotInput } from "../shared/signal-types";

type TelegramMessage = {
  chat: { id: number };
  from?: { id: number };
  text?: string;
};

type TelegramUpdate = { update_id: number; message?: TelegramMessage };

let pollingStarted = false;
let localOffset = 0;
let botLinkCache: string | null | undefined;
const WEB_DASHBOARD_URL = "https://cryptosig-3gv3ybwa.manus.space";

function allowedUserIds() {
  return new Set(
    (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function parseTelegramCommand(text: string) {
  const [rawCommand, ...args] = text.trim().split(/\s+/);
  return { command: rawCommand.toLowerCase().split("@")[0], args };
}

export function normalizeConfiguredSymbol(value: string) {
  const compact = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!["BTCUSDT", "ETHUSDT", "BNBUSDT"].includes(compact)) return null;
  return compact.replace("USDT", "/USDT");
}

function parseCooldownMinutes(value: string) {
  const matched = /^(\d{1,4})(m|h)?$/i.exec(value.trim());
  if (!matched) return null;
  const amount = Number(matched[1]);
  const minutes = matched[2]?.toLowerCase() === "h" ? amount * 60 : amount;
  return minutes >= 1 && minutes <= 1440 ? minutes : null;
}

async function telegramRequest(method: string, payload: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!response.ok || !body.ok) throw new Error(`Telegram ${method} failed with ${response.status}: ${body.description ?? "unknown error"}`);
  return body;
}

export async function getTelegramBotLink() {
  if (botLinkCache !== undefined) return botLinkCache;
  try {
    const result = (await telegramRequest("getMe", {})) as { ok: boolean; result?: { username?: string } };
    botLinkCache = result.ok && result.result?.username ? `https://t.me/${result.result.username}` : null;
  } catch {
    botLinkCache = null;
  }
  return botLinkCache;
}

export function getCachedTelegramBotLink() {
  return botLinkCache ?? null;
}

async function sendMessage(chatId: number, text: string) {
  return telegramRequest("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
}

export async function deliverSignalAlert(snapshot: SignalSnapshotInput) {
  const config = await getBotConfig();
  if (config.isPaused) return { delivered: false, reason: "PAUSED" as const };
  if (Math.abs(snapshot.score) < config.alertThreshold) return { delivered: false, reason: "BELOW_THRESHOLD" as const };
  const alertKey = `${snapshot.assetSymbol}:${snapshot.timeframe}:${snapshot.state}`;
  if (await hasRecentSignalAlert(alertKey, config.cooldownMinutes)) {
    return { delivered: false, reason: "COOLDOWN" as const };
  }
  const recipients = [...allowedUserIds()].map(Number).filter(Number.isSafeInteger);
  if (recipients.length === 0) return { delivered: false, reason: "NO_ALLOWED_RECIPIENT" as const };
  const findingText = snapshot.findings.map((finding) => finding.ruleId).join(", ") || "No confirming pattern";
  const message = `Signal snapshot\n${snapshot.assetSymbol} · ${snapshot.timeframe}\n${snapshot.state.replaceAll("_", " ")} | score ${snapshot.score.toFixed(2)} | confidence ${Math.round(snapshot.confidence * 100)}%\nFindings: ${findingText}\nData: ${snapshot.dataQualityState}\nSignals-only: no order was placed.`;
  const outcomes = await Promise.allSettled(recipients.map((chatId) => sendMessage(chatId, message)));
  const deliveredRecipients = recipients.filter((_chatId, index) => outcomes[index]?.status === "fulfilled");
  const failures = outcomes
    .map((outcome, index) => ({ outcome, chatId: recipients[index] }))
    .filter((entry) => entry.outcome.status === "rejected")
    .map((entry) => ({ chatId: entry.chatId, error: String((entry.outcome as PromiseRejectedResult).reason) }));
  if (deliveredRecipients.length > 0) {
    await recordAuditEvent("SIGNAL_ALERT_SENT", "TELEGRAM", "gateway", { alertKey, signalId: snapshot.id, recipients: deliveredRecipients, failures });
    return { delivered: true, reason: "SENT" as const };
  }
  await recordAuditEvent("SIGNAL_ALERT_FAILED", "TELEGRAM", "gateway", { alertKey, signalId: snapshot.id, failures });
  return { delivered: false, reason: "DELIVERY_FAILED" as const };
}

async function handleCommand(message: TelegramMessage) {
  const text = message.text?.trim();
  const actorId = String(message.from?.id ?? "");
  if (!text || !message.from) return;
  if (!allowedUserIds().has(actorId)) {
    await sendMessage(message.chat.id, "Access denied. This bot accepts commands only from its configured owner allowlist.");
    return;
  }

  const { command, args } = parseTelegramCommand(text);
  if (command === "/start" || command === "/help") {
    await sendMessage(
      message.chat.id,
      "CryptoSignal is in signals-only mode. Commands: /status, /signal [SYMBOL], /watchlist [add|remove] SYMBOL, /timeframes [add|remove] 30m|1h|4h, /threshold 0.55, /cooldown 60m, /methodology [enable|disable] FAMILY, /pause, /resume, /web, /help. Telegram and the web dashboard share the same configuration. It does not place orders or use exchange private keys.",
    );
    return;
  }

  if (command === "/status") {
    const [config, latest] = await Promise.all([getBotConfig(), listSignalSnapshots(1)]);
    const last = latest[0];
    await sendMessage(
      message.chat.id,
      `Status: ${config.isPaused ? "PAUSED" : "MONITORING"}\nWatchlist: ${config.watchlist.join(", ")}\nLatest: ${last ? `${last.assetSymbol} ${last.timeframe} ${last.state} (${last.score.toFixed(2)})` : "No closed-candle signal recorded yet."}`,
    );
    return;
  }

  if (command === "/web") {
    await sendMessage(message.chat.id, `Dashboard: ${WEB_DASHBOARD_URL}\nTelegram and dashboard controls share the same watchlist, timeframe, alert policy, methodology, pause, and resume configuration.`);
    return;
  }

  if (command === "/watchlist") {
    const config = await getBotConfig();
    const action = args[0]?.toLowerCase();
    if (action === "add" || action === "remove") {
      const symbol = normalizeConfiguredSymbol(args[1] ?? "");
      if (!symbol) {
        await sendMessage(message.chat.id, "Supported symbols: BTCUSDT, ETHUSDT, and BNBUSDT. Example: /watchlist add ETHUSDT");
        return;
      }
      const includes = config.watchlist.includes(symbol);
      if (action === "add" && includes) {
        await sendMessage(message.chat.id, `${symbol} is already in the watchlist.`);
        return;
      }
      if (action === "remove" && !includes) {
        await sendMessage(message.chat.id, `${symbol} is not in the watchlist.`);
        return;
      }
      if (action === "remove" && config.watchlist.length === 1) {
        await sendMessage(message.chat.id, "At least one symbol must remain in the watchlist.");
        return;
      }
      const watchlist = action === "add" ? [...config.watchlist, symbol] : config.watchlist.filter((item) => item !== symbol);
      const next = await updateBotConfig({ watchlist }, actorId, config);
      await sendMessage(message.chat.id, `Watchlist v${next.configVersion}: ${next.watchlist.join(", ")}`);
      return;
    }
    await sendMessage(message.chat.id, `Watchlist: ${config.watchlist.join(", ")}\nTimeframes: ${config.timeframes.join(", ")}`);
    return;
  }

  if (command === "/threshold") {
    const threshold = Number(args[0]);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      await sendMessage(message.chat.id, "Use a threshold from 0 to 1. Example: /threshold 0.55");
      return;
    }
    const next = await updateBotConfig({ alertThreshold: threshold }, actorId);
    await sendMessage(message.chat.id, `Alert threshold set to ${Math.round(next.alertThreshold * 100)}% (v${next.configVersion}).`);
    return;
  }

  if (command === "/timeframes") {
    const config = await getBotConfig();
    const action = args[0]?.toLowerCase();
    const timeframe = args[1]?.toLowerCase();
    const allowed = new Set(["30m", "1h", "4h"]);
    if ((action === "add" || action === "remove") && timeframe && allowed.has(timeframe)) {
      const enabled = config.timeframes.includes(timeframe);
      if (action === "add" && enabled) return void await sendMessage(message.chat.id, `${timeframe} is already enabled.`);
      if (action === "remove" && !enabled) return void await sendMessage(message.chat.id, `${timeframe} is not enabled.`);
      if (action === "remove" && config.timeframes.length === 1) return void await sendMessage(message.chat.id, "At least one timeframe must remain enabled.");
      const timeframes = action === "add" ? [...config.timeframes, timeframe] : config.timeframes.filter((item) => item !== timeframe);
      const next = await updateBotConfig({ timeframes }, actorId, config);
      await sendMessage(message.chat.id, `Timeframes v${next.configVersion}: ${next.timeframes.join(", ")}`);
      return;
    }
    await sendMessage(message.chat.id, `Timeframes: ${config.timeframes.join(", ")}\nUse /timeframes add 30m or /timeframes remove 4h.`);
    return;
  }

  if (command === "/cooldown") {
    const cooldownMinutes = parseCooldownMinutes(args[0] ?? "");
    if (!cooldownMinutes) {
      await sendMessage(message.chat.id, "Use 1m–1440m or 1h–24h. Example: /cooldown 60m");
      return;
    }
    const next = await updateBotConfig({ cooldownMinutes }, actorId);
    await sendMessage(message.chat.id, `Alert cooldown set to ${next.cooldownMinutes} minutes (v${next.configVersion}).`);
    return;
  }

  if (command === "/methodology") {
    const config = await getBotConfig();
    const action = args[0]?.toLowerCase();
    const family = args[1]?.toUpperCase();
    const allowedFamilies = new Set(["TREND", "MOMENTUM", "VOLUME", "CANDLE_PATTERN", "WYCKOFF", "SMC", "ELLIOTT_EXPERIMENTAL"]);
    if ((action === "enable" || action === "disable") && family) {
      if (!allowedFamilies.has(family)) {
        await sendMessage(message.chat.id, `Unknown family. Supported: ${[...allowedFamilies].join(", ")}`);
        return;
      }
      const enabled = config.ruleFamilies.includes(family);
      const ruleFamilies = action === "enable" ? (enabled ? config.ruleFamilies : [...config.ruleFamilies, family]) : config.ruleFamilies.filter((item) => item !== family);
      const next = await updateBotConfig({ ruleFamilies }, actorId, config);
      await sendMessage(message.chat.id, `Rule families v${next.configVersion}: ${next.ruleFamilies.join(", ") || "none"}`);
      return;
    }
    await sendMessage(message.chat.id, `Enabled families: ${config.ruleFamilies.join(", ")}\nUse /methodology enable CANDLE_PATTERN or /methodology disable ELLIOTT_EXPERIMENTAL.`);
    return;
  }

  if (command === "/signal") {
    const requested = args[0]?.toUpperCase();
    const signals = await listSignalSnapshots(30);
    const latest = requested ? signals.find((signal) => signal.assetSymbol.replace("/", "") === requested.replace("/", "")) : signals[0];
    await sendMessage(
      message.chat.id,
      latest
        ? `${latest.assetSymbol} ${latest.timeframe}\n${latest.state} | score ${latest.score.toFixed(2)} | confidence ${latest.confidence.toFixed(2)}\nData: ${latest.dataQualityState}\nFindings: ${(latest.findings as Array<{ ruleId?: string }>).map((finding) => finding.ruleId ?? "rule").join(", ") || "none"}`
        : "No matching closed-candle signal has been recorded yet. Run the local signal cycle first.",
    );
    return;
  }

  if (command === "/pause" || command === "/resume") {
    const config = await setBotPaused(command === "/pause", actorId);
    await sendMessage(message.chat.id, `Signal alerts are now ${config.isPaused ? "paused" : "resumed"}. No trading action was taken.`);
    return;
  }

  await sendMessage(message.chat.id, "Unknown command. Use /help for the supported signals-only controls.");
}

async function pollLoop() {
  localOffset = Math.max(localOffset, await getTelegramUpdateOffset());
  while (pollingStarted) {
    try {
      const result = (await telegramRequest("getUpdates", {
        offset: localOffset,
        timeout: 25,
        allowed_updates: ["message"],
      })) as { ok: boolean; result?: TelegramUpdate[] };
      for (const update of result.result ?? []) {
        if (update.update_id < localOffset) continue;
        await handleCommand(update.message ?? { chat: { id: 0 } });
        localOffset = update.update_id + 1;
        await setTelegramUpdateOffset(localOffset);
      }
    } catch (error) {
      console.error("[TelegramPolling]", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

export function startTelegramPolling() {
  if (pollingStarted || !process.env.TELEGRAM_BOT_TOKEN) return;
  pollingStarted = true;
  void getTelegramBotLink();
  void pollLoop();
}
