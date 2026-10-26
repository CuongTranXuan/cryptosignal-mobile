# Model selection & candle budget spec (Copilot)

Branch `feat/copilot-actionable-drawings` (PR #5). Scope: user picks a model from their own OpenAI-compatible provider, switches mid-session, sessions persist with chart context, candle count comes from presets instead of fixed 186 × 1h.

## 0. User decisions (2026-10-25, locked)
| Topic | Decision |
|---|---|
| Default model | `agentrouter/deepseek-v4-flash` (`LLM_MODEL` env; also always injected into the list if healthy) |
| Default candles | **100** (`COPILOT_DEFAULT_CANDLE_COUNT=100`, already `config.DEFAULT_CANDLE_COUNT`) |
| Presets | **50 / 100 / 200 / 300 / custom**. Custom = any integer, clamped by the §2.2 budget formula (still **54 tok/candle**) and by the per-model hard max |
| Reasoning level | **User-selectable.** UI shows tiers from `capabilities.effort_tiers`; default **`low`**; on empty output the server falls back one tier lower automatically |
| Model list | **Only available models.** OmniRoute exposes only active-account models (`modelVisibilityAllowlist` + `hideAutoCombos=true`, see `docs/OMNIROUTE_CONFIG.md`) **and** the backend filters again (§3.1.1) |

## 1. Model discovery

### 1.1 OpenAI-compatible baseline
`GET {LLM_BASE_URL}/models` → `{"object":"list","data":[{"id","object":"model","created","owned_by"}]}` (https://platform.openai.com/docs/api-reference/models/list). No limits in the baseline.

### 1.2 OmniRoute extended fields (measured, local OmniRoute `http://127.0.0.1:20128/v1/models`, 2026-10-13, 1626 models)
| Field | Example | Notes |
|---|---|---|
| `id`, `object`, `created`, `owned_by` | `agentrouter/deepseek-v4-flash`, `agentrouter` | `owned_by` = upstream provider or `combo` |
| `root`, `parent`, `permission` | `deepseek-v4-flash`, `null`, `[]` | `root` = upstream model id |
| `name` | `deepseek-v4-flash` | display label (optional) |
| `context_length`, `max_input_tokens` | `1000000` | optional, often missing (some only `context_length: 128000`) |
| `max_output_tokens` | `384000` | optional |
| `capabilities.reasoning` / `.thinking` / `.supportsThinking` | `true` | also top-level `thinking`, `supportsThinking` on some |
| `capabilities.effort_tiers` | `["none","low","medium","high","xhigh","max"]` | present on agentrouter reasoning models → `reasoning_effort` accepted |
| `capabilities.tool_calling`, `.vision`, `.temperature` | bool | tool_calling = structured output path we use |
| `input_modalities`, `output_modalities`, `pricing{input,cached,output}` | | optional |

Caveat: OmniRoute flags are per-route, not always true to the upstream (e.g. `dva/deepseek-v4-flash-*` say `reasoning:false`). Treat flags as hints.

### 1.3 OpenRouter-style fields (https://openrouter.ai/docs/api-reference/list-available-models)
`context_length`, `top_provider.max_completion_tokens`, `top_provider.context_length`, `supported_parameters` (contains `reasoning`, `include_reasoning`, `response_format`, `structured_outputs`, `tools`).

### 1.4 Normalization & fallback chain (first non-null wins, per field)
| Normalized | 1. provider fields | 2. built-in table (id regex on `id` or `root`) | 3. default |
|---|---|---|---|
| `context_window` | `context_length` → `max_input_tokens` → `top_provider.context_length` | table | **32 000** |
| `max_output_tokens` | `max_output_tokens` → `top_provider.max_completion_tokens` | table | **4 096** |
| `supports_reasoning` | `capabilities.reasoning\|thinking\|supportsThinking`, `thinking`, `"reasoning" in supported_parameters` | table | **true** (unknown = assume reasoning) |
| `reasoning_efforts` | `capabilities.effort_tiers` | table | `[]` (don't send effort) |
| `supports_json` | `capabilities.tool_calling`, `"tools"/"response_format"/"structured_outputs" in supported_parameters` | table | **true** (tool output mode already used) |
`source` = the lowest tier used for any of the four (`provider` \| `table` \| `default`).

Built-in table (single module, server-side only), starting rows:
| pattern | ctx | max_out | reasoning | efforts |
|---|---|---|---|---|
| `deepseek-v4-(flash\|pro)` | 1 000 000 | 384 000 | true | none..max |
| `deepseek-r1\|reasoner` | 128 000 | 32 000 | true | — |
| `gpt-4o\|gpt-4\.1` | 128 000 | 16 384 | false | — |
| `o[134]\|gpt-5` | 200 000 | 100 000 | true | low/medium/high |
| `claude-` | 200 000 | 64 000 | true | — |
| `gemini-2\.5` | 1 000 000 | 65 536 | true | — |

## 2. Token budget & candle policy

### 2.1 Measured costs (current serializer `agent._build_user_prompt`, candles embedded as Python-dict repr of `AnalyzeRequest`)
| Item | Value | How |
|---|---|---|
| tokens per candle | **54** (measured) | live `agentrouter/deepseek-v4-flash` call, `usage.prompt_tokens` 3 075 @50 vs 8 475 @150 → 5 400/100 |
| user-prompt overhead (0 candles) | ~375 (measured) | 3 075 − 50×54 |
| system prompt | ~1 255 (tiktoken o200k estimate) | `agent.py` instructions |
| tool/output schema + existingShapes | budget **2 400** (estimate) | |
| `system_overhead` total | **4 000** (rounded up) | |
Quick win: serializing candles as compact rows `[t,o,h,l,c,v]` should cut to ~25–30 tokens/candle (not measured).

### 2.2 Formula
```
reserved_output = max_tokens_sent           # covers reasoning + JSON answer
max_candles = floor((context_window - 4000 - history_tokens - reserved_output) / 54)
safe_max = largest preset <= min(max_candles, analysis_window_bars, 1000 /*Binance limit*/)
presets = [50, 100, 200, 300] + custom     # §0
hard_max = min(max_candles, analysis_window_bars, 1000 /*Binance limit*/)
custom   = clamp(requested, 1, hard_max)      # response meta.clamped=true if changed
```
Presets above `hard_max` are hidden in the UI; `custom` input shows `max = hard_max`. `CANDLE_PRESETS` in `candle_budget.py` must change from `(50,100,150,200,300,500)` to `(50,100,200,300)`; `previous_preset()` (retry) uses the same tuple, and a custom value retries at the largest preset below it.
`history_tokens`: estimate `len(text)/3` for messages actually sent (cap at 4 000, see §4).

### 2.3 max_tokens & reasoning
| Case | `max_tokens` sent | reasoning control |
|---|---|---|
| reasoning model with `effort_tiers` | min(16 384, max_out) | user's `reasoning_effort` (default `"low"`); must be one of `effort_tiers`, else coerced to `low` (or first tier) |
| reasoning model, no effort control | min(16 384, max_out) | provider budget param if known (Anthropic `thinking.budget_tokens: 4096`), else none |
| non-reasoning | min(4 096, max_out) | — |
| unknown (defaults) | 4 096 | assume reasoning; no param |
JSON answer itself is ≤ ~2 000 tokens (≤ 10 shapes + VI summary).

Reasoning tiers exposed to the user: exactly `capabilities.effort_tiers` (normalized `reasoning_efforts`), in provider order. Models without tiers show no picker (server sends no effort). UI labels: `none`=Tắt, `low`=Thấp (mặc định), `medium`=Vừa, `high`=Cao, `xhigh`/`max`=Rất cao/Tối đa, with a hint that high tiers are slower and may run out of output budget.

Retry rule (fallback to lower tier): on empty text / `UnexpectedModelBehavior` / finish_reason=`length` with no output → retry **once** with `reasoning_effort` = next lower tier present in `effort_tiers` (`max→xhigh→high→medium→low→none`), and `candle_count` = previous preset below the current value (≥50), `max_tokens` unchanged. Second failure → `empty_model_output`. `meta` reports `reasoning_effort_requested`, `reasoning_effort_used`, `retried:true`. (`run_settings.lower_reasoning_effort` today maps high→low and has no xhigh/max step — coder should switch it to the generic "next lower tier in the list" rule.)

### 2.4 deepseek-v4-flash (agentrouter) concrete
- ctx 1 000 000 / max_out 384 000 (provider). Context is never the bind; output is.
- Root cause of the bug: 8 192 default output fully used by thinking at 299 candles.
- Decision: default model, `max_tokens = 16 384`, `reasoning_effort = "low"` (user may change), default **100** candles (≈5.4k candle tokens + ~4k overhead ≈ 9.8k input). Presets 50/100/200/300 all fit; custom hard max **1000** (Binance limit; 1000×54 = 54k input, fine for a 1M context — latency is the limit). Retry: e.g. 300→200 and `medium`→`low`, or 100→50 and `low`→`none`.
- Same model via defaults path (unknown metadata, 32k/4k): (32 000−4 000−4 000−4 096)/54 = 368 → preset **300**.

## 3. API contract (all paths stay under `/v1/copilot/*`; existing fields unchanged)

### 3.1 `GET /v1/copilot/models`
Server calls `{LLM_BASE_URL}/models`, normalizes, caches 10 min.
```json
{
  "default_model": "agentrouter/deepseek-v4-flash",
  "fetched_at": 1791843996,
  "models": [{
    "id": "agentrouter/deepseek-v4-flash",
    "label": "deepseek-v4-flash",
    "provider": "agentrouter",
    "context_window": 1000000,
    "max_output_tokens": 384000,
    "supports_reasoning": true,
    "reasoning_efforts": ["none","low","medium","high","xhigh","max"],
    "supports_json": true,
    "source": "provider",
    "default_reasoning_effort": "low",
    "request_max_tokens": 16384,
    "recommended_candles": 100,
    "recommended_max_candles": 1000,
    "presets": [50,100,200,300],
    "allow_custom_candles": true
  }]
}
```
#### 3.1.1 Availability filter (decided: show only available models)
Two layers; both required.
1. **OmniRoute side** (ops): `modelVisibilityAllowlist` = models verified on active accounts, `hideAutoCombos=true` (done 2026-10-13, 1626 → 182 entries; see `docs/OMNIROUTE_CONFIG.md`). Re-run the "Reply OK" probe when accounts change.
2. **Backend side** (`model_availability.filter_available_models`, already on the branch):
   - drop `owned_by == "combo"` / `combo/*` / `auto/*` routes unless `COPILOT_MODEL_INCLUDE_COMBO=true` **and** the route passed a health probe;
   - drop media models (image/video/audio by metadata or id pattern, e.g. `aihorde/*`, `veo*`, `cursor/composer-2` mislabelled as image);
   - drop ids in the **negative cache** (`model_negative_cache`, TTL 300 s, `COPILOT_MODEL_NEGATIVE_CACHE_TTL_S`): any model that returned 402 quota / 404 not_found / "empty turn" / repeated `empty_model_output` is marked unavailable and hidden until TTL expiry;
   - optional `COPILOT_MODEL_VISIBILITY_ALLOWLIST` / `COPILOT_MODEL_PROVIDERS` to narrow further; overrides file `hide`/`force_include`;
   - the default model is always kept unless it is itself in the negative cache (then `default_model` falls back to the first remaining entry).
With the filter the list is small (<20), so a plain dropdown is enough; keep `?q=` as optional.

#### 3.1.2 Live probe (only models that answer now)
`/models` lists what a gateway knows, not what its accounts can serve. The backend (`model_probe.py`) sends each candidate one tiny chat completion and lists only `ok` ones. Contract (additive; every existing field above is kept):
```ts
// GET /v1/copilot/models[?refresh=1]
type ModelsResponse = {
  models: (ExistingModel & { latency_ms: number; status: "ok" })[]; // healthy only
  default_model: string | null;      // effective default (healthy) or null
  requested_default: string;         // LLM_MODEL
  default_fallback: boolean;         // true when default_model !== requested_default
  fetched_at: number | null;         // unix s of the /models fetch used
  probed_at: string | null;          // ISO-8601 UTC
  ttl_s: number;
  stale: boolean;                    // cached report past TTL; refresh running
  probe_in_progress: boolean;        // true → `models` holds the healthy ids found so far
  upstream_reachable: boolean;
  upstream_error: { code: string; message: string } | null;
};
// GET|POST /v1/copilot/models/probe (POST forces; 429 + Retry-After + retry_after_s when too soon)
type ProbeReport = {
  probed_at: string | null; ttl_s: number;
  provider: "omniroute" | "gemini" | "openai_compat";
  upstream_reachable: boolean; upstream_error: { code: string; message: string } | null;
  skipped_count: number;             // = skipped_ids.length (0 with the default MAX_MODELS=0)
  skipped_ids: string[];             // candidates over COPILOT_MODEL_PROBE_MAX_MODELS, never probed
  complete: boolean;                 // false → partial report of a running probe
  probe_in_progress: boolean;
  results: { id: string;             // completion order of the running/last probe
    status: "ok"|"auth_error"|"quota_or_rate_limited"|"not_found"|"provider_unconfigured"|"timeout"|"upstream_error";
    latency_ms: number | null; http_status: number | null;
    error_code: string | null; message: string | null }[];
};
```
Probe order: requested default, then `COPILOT_MODEL_VISIBILITY_ALLOWLIST` order, then ids healthy in the previous report, then the rest by id. `COPILOT_MODEL_PROBE_MAX_MODELS=0` (default) probes every listed id at `COPILOT_MODEL_PROBE_CONCURRENCY=8`. Results are published as each probe finishes. `GET /models` and `GET /models/probe` wait at most `COPILOT_MODEL_PROBE_FIRST_WAIT_S` (3 s) for a probe they had to start and then answer with the partial view (`probe_in_progress:true`, report `complete:false`); a stale reachable report triggers a refresh that is also awaited up to `first_wait_s` (a stopped gateway fails fast, so the unreachable report wins); `POST /models/probe` waits for the full run.

Stale / unreachable rules: once the current report says `upstream_reachable:false`, `/models` returns `models: []`, `default_model: null`, `default_fallback: false`, the configured `requested_default` and `upstream_error` — never the last healthy list. A stale report (past TTL, refresh still running) may still list its models with `stale: true`, but its `default_model` is only `requested_default` when that model passed in it, otherwise `null`; a substitute default (`default_fallback: true`) only ever comes from a current report. `POST /analyze` without `model` follows the same rule. With the gateway unreachable (last probe says so, or the catalog fetch fails) `POST /analyze` returns `503 {code: "upstream_unreachable", message, detail}` instead of a bare 500.

Status meanings: `not_found` = the gateway does not know the model id; `provider_unconfigured` = the gateway knows the route but its provider backend is not installed / logged in / wired (OmniRoute e.g. "Auggie CLI not found… install/login", "Cloudflare Playground needs Playwright", "Codex app-server transport is not configured"); `message` then carries a short (≤120 chars) key-free reason. `auth_error` includes OmniRoute "No active credentials".

`upstream_error.code`: `connect_error|timeout|http_error|auth_error|quota_or_rate_limited|network_error|invalid_response|config_missing`. Analyze: absent `model` → `default_model` from the last probe; a `model` whose last probe failed → `422` with body `{code: "model_unavailable", message, detail, model: string, probe_status: "auth_error"|"quota_or_rate_limited"|"not_found"|"provider_unconfigured"|"timeout"|"upstream_error"}` (`detail` keeps the human-readable string; fixture `apps/copilot/tests/fixtures/wire/analyze_model_unavailable.json`). The same body arrives as an SSE `error` event if the model fails between the pre-check and the stream. Env vars and behaviour: `apps/copilot/DEPLOY.md` § Model probe endpoints. Fixtures: `apps/copilot/tests/fixtures/wire/models_*.json`.

### 3.2 `POST /v1/copilot/analyze` (additions, both optional)
| Field | Type | Rule |
|---|---|---|
| `model` | string | must be in discovered list; absent → `LLM_MODEL` |
| `candle_count` | int | preset or custom; clamp to `[1, hard_max]` (§2.2); server keeps the **last N** of `closedCandles` (server-side trim) |
| `reasoning_effort` | string \| null | one of the model's `reasoning_efforts`; null/absent → `low`; unknown → soft-coerced (`schema.normalize_session_reasoning_effort`) |
Response/SSE adds a `meta` event first: `{"model":"…","candle_count_requested":299,"candle_count_used":200,"clamped":true,"max_tokens":16384,"reasoning_effort_requested":"medium","reasoning_effort_used":"low"}`; also `retried:true` if §2.3 retry ran.
`AnalyzeRequest` keeps `extra="forbid"` → add the two fields explicitly.

Error codes (SSE `error` event `{code, message(VI), detail}`; HTTP 4xx before stream):
| code | HTTP | when |
|---|---|---|
| `unknown_model` | 400 | `model` not in list |
| `over_budget` | 422 | even 50 candles + history don't fit |
| `empty_model_output` | 502 (SSE) | empty after retry |
| `provider_error` | 502 | existing provider HTTP errors |
| `models_unavailable` | 503 | `/models` fetch failed and no cache |

### 3.3 Session schema (client `localStorage`, key `copilot.sessions.v1`; server stays stateless, no DB)
```ts
type CopilotSession = {
  id: string; title: string; created_at: number; updated_at: number; // unix s
  model_id: string;                       // current
  chart: { symbol: string; interval: string; from: number; to: number; candle_count: number };
  messages: { id: string; role: "user"|"assistant"; content: string;
              model_id: string | null; shapes: PatternShape[]; created_at: number;
              meta?: { candle_count_used: number; clamped: boolean } }[];
};
```
Limits: keep 50 sessions, 200 messages each, evict LRU. Candles are NOT stored; refetch by chart context. Mid-session switch = change `model_id`; each message keeps its own.

## 4. Best practices checklist (final optimization pass)
**Clean code**
- [ ] One typed schema source: pydantic models → generated TS types (or shared JSON schema); no hand-copied types.
- [ ] One limits table (server `model_catalog.py`); client only reads `/models` output.
- [ ] Normalizer is a pure function with unit tests per provider shape (OmniRoute, OpenRouter, bare OpenAI).
**Performance**
- [ ] Cache `/models` 10 min TTL in-process; client caches same TTL.
- [ ] Don't resend full history: last 6 messages, text only, shapes as short summary; ≤4 000 tokens.
- [ ] Trim candles server-side to `candle_count_used`; consider compact row serialization.
**Caching / storage**
- [ ] Cache normalized metadata, never raw provider dumps.
- [ ] Sessions in localStorage only; versioned key; no candles stored.
- [ ] No API keys or base URL secrets client-side; server proxies everything.
**Error handling**
- [ ] Typed `code` on every error; client maps to clear VI messages (e.g. `empty_model_output` → "Mô hình không trả lời, thử ít nến hơn hoặc mô hình khác").
- [ ] One automatic retry with fewer candles / lower reasoning on empty output.
- [ ] Timeouts: `/models` 10 s, analyze `LLM_TIMEOUT_S` (60 s; raise to 120 s for reasoning models).
- [ ] No silent drops: clamps, retries, gate rejects all surfaced via `meta`/`dropped`.

## 5. Open questions (resolved 2026-10-25)
1. ~~Hide OmniRoute `combo`/`auto/*`?~~ **Resolved:** hidden by default (OmniRoute `hideAutoCombos=true` + backend filter); shown only with `COPILOT_MODEL_INCLUDE_COMBO=true` and a passing health probe.
2. ~~User-chosen reasoning effort?~~ **Resolved:** user-selectable from `effort_tiers`, default `low`, auto-fallback one tier lower on empty output (§2.3).
3. Provider per user vs server env — **still open**; spec keeps server env only.
4. Compact candle serialization — **superseded** by `docs/CHART_AI_SPEC.md` §6 (compact input: last 20–30 candles + swing list + HTF summary). Budget formula here keeps 54 tok/candle until that ships.
5. ~~Per-interval presets?~~ **Resolved:** no; one preset set 50/100/200/300 + custom, clamped by budget/hard max.
