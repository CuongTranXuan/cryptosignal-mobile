# Browser Dashboard and Telegram Control Surface

## Product split

CryptoSignal uses a **browser-first, read-only research dashboard** and a **Telegram-first operational surface**. The dashboard is available at [cryptosig-3gv3ybwa.manus.space](https://cryptosig-3gv3ybwa.manus.space). It is intentionally not a mobile application and contains no write controls, exchange credentials, account data, or order-execution feature.

| Surface | Purpose | Available actions |
|---|---|---|
| Web dashboard | Review persisted signal history, OHLCV charts, indicator overlays, conditional scenarios, service status, and the latest signal evidence. | Inspect; choose chart pair/timeframe; open the Telegram bot. |
| Telegram bot | Operate the signals-only system from an owner allowlist. | Check status, review signal summaries, configure watchlist and alert policy, enable/disable rule families, pause/resume delivery, and open the dashboard. |

## Web dashboard behavior

The dashboard is a single responsive page rather than a native mobile application. It places closed-candle market history and the interactive chart in the primary browser column, while the latest persisted signal and Telegram command reference remain adjacent on wider screens and stack naturally on narrow screens. The web client uses server-calculated data only; it does not run strategy rules or write configuration.

> The page presents historical evidence and conditional research scenarios. It does not provide an entry, target price, position size, personalized recommendation, or a route to place a trade.

## Telegram command reference

| Command | Behavior |
|---|---|
| `/start` or `/help` | Shows the supported signals-only command surface. |
| `/status` | Returns monitoring/paused state, current watchlist, and latest stored signal summary. |
| `/signal [SYMBOL]` | Returns the latest matching persisted signal evidence. |
| `/watchlist [add\|remove] SYMBOL` | Views or changes the approved BTC, ETH, and BNB public-market watchlist. |
| `/threshold 0.55` | Sets the alert evidence threshold from 0 to 1. |
| `/cooldown 60m` | Sets the per-signal alert cooldown. |
| `/methodology [enable\|disable] FAMILY` | Changes enabled rule families, including trend, momentum, volume, candle pattern, Wyckoff, SMC, and experimental Elliott rules. |
| `/pause` or `/resume` | Controls Telegram alert delivery without changing the engine’s no-trade boundary. |
| `/web` | Returns the read-only browser dashboard link. |

The bot accepts commands only from `TELEGRAM_ALLOWED_USER_IDS`. Each allowed user should open the bot and send `/start` before alerts can be delivered because Telegram bots cannot initiate a private conversation.

## Operating boundary

Run exactly **one** long-polling worker for a bot token. Telegram returns a `409 Conflict` when a second concurrent `getUpdates` session uses the same token. The browser dashboard may run independently, but configuration mutations remain Telegram-owned and versioned in the database.

## References

[1] [Telegram Bot API — Getting updates](https://core.telegram.org/bots/api#getupdates).  
[2] [Telegram Bot API — sendMessage](https://core.telegram.org/bots/api#sendmessage).  
