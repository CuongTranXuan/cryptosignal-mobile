# CryptoSignal Chart Terminal

Research terminal for drawing candle patterns on live public market data. **No orders**, no exchange private keys, no portfolio or execution.

Two processes:

| App | Role | Default port |
|---|---|---|
| `apps/web` | Next.js UI + TradingView Lightweight Charts | `3000` |
| `apps/copilot` | FastAPI + Pydantic AI agent | `8000` |

## Market data (chart)

Live candles and the 24h ticker come from **public Binance REST + WebSocket** in the browser/chart store.

- REST history: `GET https://api.binance.com/api/v3/klines`
- Live updates: Binance kline WebSocket
- Ticker %: `GET https://api.binance.com/api/v3/ticker/24hr`

**MCP is not used for live candles.** The chart must keep updating even if the copilot is down.

## Copilot (patterns)

The LLM runs only in `apps/copilot`. The browser never sees `LLM_API_KEY`.

For **extra history** during analysis, the agent may call a FastMCP-style `get_klines` tool (public Binance REST only). That path is for extending the analysis window, not for driving the live chart.

## Run

### 1. Copilot (`apps/copilot`)

```bash
cd apps/copilot
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env   # fill LLM_* below
uvicorn cryptosignal_copilot.app:app --app-dir src --reload --port 8000
```

### 2. Web (`apps/web`)

```bash
cd apps/web
pnpm install
cp .env.example .env.local   # optional; default URL is fine
pnpm dev
```

Open `http://127.0.0.1:3000` — not `preview/terminal.html`.

Web alone can show the live chart. Copilot actions fail visibly until `apps/copilot` is up with a valid LLM env.

## Environment

### Web (`apps/web/.env.example`)

| Variable | Example |
|---|---|
| `NEXT_PUBLIC_COPILOT_URL` | `http://127.0.0.1:8000` |

### Copilot (`apps/copilot/.env.example`)

| Variable | Required | Meaning |
|---|---|---|
| `LLM_API_STYLE` | yes | `openai` or `anthropic` |
| `LLM_BASE_URL` | yes | Provider SDK `base_url` (passed through) |
| `LLM_API_KEY` | yes | Never logged; never sent to the browser |
| `LLM_MODEL` | yes | Model id as the vendor expects |
| `LLM_TIMEOUT_S` | no | Default `60` |

Provider examples (documentation only):

| Provider | `LLM_API_STYLE` | `LLM_BASE_URL` | `LLM_MODEL` (example) |
|---|---|---|---|
| OpenAI | `openai` | `https://api.openai.com/v1` | `gpt-4.1` |
| DeepSeek | `openai` | `https://api.deepseek.com` | `deepseek-chat` |
| GLM (Zhipu) | `openai` | `https://open.bigmodel.cn/api/paas/v4` | `glm-4` |
| Claude official | `anthropic` | `https://api.anthropic.com` | `claude-sonnet-4-5` |
| Claude via OpenRouter | `openai` | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4.5` |

Change only these env vars and restart `apps/copilot` to switch providers. No web rebuild.

## Boundary

- Public market data only — no depth/order book in v1
- No trading MCP, place/cancel, balances, or Binance API keys
- Keys stay on the copilot host

## Definition of done

Manual acceptance (14 steps) is in:

[`docs/superpowers/specs/2026-09-13-chart-terminal-design.md`](docs/superpowers/specs/2026-09-13-chart-terminal-design.md)

Without a real `LLM_API_KEY`, chart/market smoke still works; **DoD steps 6–14** (analyze, preview/commit, Auto-Draw, fail-visible copilot, extra `get_klines` history) need a configured provider. Do not fake the LLM.
