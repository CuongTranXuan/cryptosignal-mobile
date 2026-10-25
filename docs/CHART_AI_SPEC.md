# Chart AI (Copilot backend)

Experimental chart-AI contract for `apps/copilot`. Frontend wire format for `PatternShape` is unchanged.

## Analyze request

Optional `intent`: `{ style, bias?, requested_pattern? }` (default style `classic`). Unknown style/pattern → **422** `{code,message,detail}`.

Optional `session_id`: when set without request `intent`, session `intent` is used for analyze only (not mutated).

## GET `/v1/copilot/styles`

`{ "styles": [ { "id": "<style>", "patterns": [ { "id": "<pattern>" } ] } ] }` — ids only; only patterns with live detectors.

## Analyze SSE

- **meta**: includes `intent_check`, `intent_source`, `feature_sheet` summary fields, `prompt_candle_reduction_pct`, `candidates` short list.
- **shapes**: each drawing includes stable `id` and `guardrail` `{ regime, confidence, evidence_against, invalidation }`.
- **skipped**: `[{ reason_code, count }]`; **skipped_count** deprecated duplicate total.

## POST `/v1/copilot/feedback`

Body: `{ session_id, message_id?, drawing_id, action: keep|reject|edit|delete, before?, after?, client_ts? }` → **201** `{ id }`.

## GET `/v1/copilot/feedback/export`

`{ "rows": [ ... ] }` for eval.

## LLM output (internal)

Models return `drawing_intents` referencing `candidate_id` from the feature sheet; server resolves to `PatternShape` geometry.
