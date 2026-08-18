# CryptoSignal Mobile — Interface Design Plan

## Product role

CryptoSignal Mobile is a **read-only companion** to a Telegram-controlled crypto OHLCV signal system. Telegram remains the authoritative interface for configuration and control. The mobile app gives a user one-handed, portrait-oriented access to service health, recent signal explanations, a configuration mirror, and an entry point back to Telegram. It does not calculate signals, place orders, collect exchange API keys, or make investment recommendations.

## Mobile layout principles

The interface is designed for a 9:16 portrait screen and iOS conventions. The most-used status and latest-signal content appears in the upper half of the Overview screen. Bottom navigation uses four concise tabs with native iconography: Overview, Signals, Configuration, and Health. Each screen uses a safe-area-aware layout, standard iOS sheet presentations for detail, 44-point minimum touch targets, system typography, clear loading/unknown states, and restrained haptics only after a confirmed interaction.

## Screen list

| Screen | Primary content and functionality |
|---|---|
| Welcome and Telegram Link | Explains that Telegram controls the bot, displays the signals-only risk boundary, and opens a Telegram deep link. It never requests exchange credentials. |
| Overview | Displays service status, feed freshness, active watchlist count, latest signal state, and a clear “Open Telegram controls” action. No market values are hardcoded. |
| Signals | A filterable history of immutable signal snapshots. Each row shows asset, timeframe, directional state, score/confidence when available, timestamp, and data-quality badge. |
| Signal Detail | Shows evidence grouped by trend, momentum, volume, candlestick, and methodology; also displays conflicts, invalidation, data source, detector version, and a Telegram deep link to `/why`. |
| Configuration Mirror | Shows the currently active Telegram-owned settings, including watchlist, timeframes, alert threshold, cooldown, quiet hours, and enabled rule families. An edit action opens Telegram rather than editing in-app. |
| Health | Shows last successful candle refresh, stale-feed state, last analysis run, last Telegram delivery result, and incident/help documentation links. |
| Documentation | Provides links to the product design, architecture diagram, risks, command reference, and implementation roadmap included in the project documentation package. |

## Key user flows

The first-use path is: **Open app → Read safety boundary → Tap “Connect in Telegram” → Complete bot onboarding in Telegram → Return to app → Review synchronized status**. The core monitoring path is: **Overview → Tap latest signal → Review evidence and invalidation → Tap “Ask Telegram for full explanation” → Telegram opens the matching `/why` command**. The configuration path is: **Configuration Mirror → Tap “Manage in Telegram” → Telegram opens → User completes a validated command/wizard → App refreshes the mirror on return**.

## Color choices

The visual system uses a calm research-terminal identity rather than a “get rich” trading aesthetic. The light background is **Cloud #F6F8FC**, card surface is **White #FFFFFF**, primary ink is **Midnight #172033**, and secondary text is **Slate #64748B**. The controlling accent is **Signal Blue #246BFD**, representing navigation and verified actions. Positive informational states use **Teal #0F9D8A**, caution uses **Amber #D97706**, and negative or stale/error states use **Crimson #D14343**. Directional colors are always paired with text labels and icons; color alone never conveys a signal state.

## Content and interaction specification

Signal direction is framed as “bullish setup,” “bearish setup,” “neutral,” or “conflicted,” rather than as an order recommendation. Score and confidence are visually distinct: score indicates the balance of bullish/bearish evidence, while confidence indicates evidence completeness and agreement. Data freshness stays visible on every data-bearing screen. When the backend is unavailable, all live fields use explicit `Unknown` or `Stale` labels rather than examples or fabricated values.

The app uses compact cards with 12–16 point corner radii, 16-point horizontal margins, 12-point internal spacing, and readable system font sizes. The critical action to open Telegram is a full-width primary button placed within thumb reach. Secondary actions use text buttons or inline rows. Charts are not planned for the first mobile companion release; the app will link to a future server-rendered evidence chart so that the client does not recreate signal logic.

## Accessibility and safety

All status states must have text alternatives, strong contrast, dynamic type support, VoiceOver labels, and non-color state indicators. The onboarding and signal-detail screens carry a short disclosure that the product provides research signals only and that market activity carries risk. The app must not show account balances, leverage, “guaranteed” language, countdown pressure, or trading-execution actions.
