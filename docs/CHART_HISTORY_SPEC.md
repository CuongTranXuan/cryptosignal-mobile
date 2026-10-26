# Chart history per session (contract, FINAL)

Agreed between backend (apps/copilot) and web (apps/web). Each copilot session keeps one
saved chart per `(symbol, interval)`: the shapes on it, their anchor markers, the last
analysis and the visible range. Reopening a session restores the chart exactly as left.

Web client module: `apps/web/lib/chart-state.ts`. Backend: `cryptosignal_copilot/chart_state.py`
(store + models), `chart_autosave.py` (analyze), routes in `app.py`, table `chart_states`
(alembic `20261026_0003`).

## Doc

```ts
type ChartStateDoc = {
  symbol: string;                 // uppercased, from the path
  interval: "1m" | "15m" | "30m" | "1h" | "4h" | "1d";
  revision: number;               // starts at 1, +1 on every write
  updated_at: number;             // unix seconds (float), server clock
  shapes: WireShape[];            // single array, user and AI shapes together (≤ 200)
  markers: AgentMarker[];         // anchors etc. (≤ 300)
  analysis: object | null;        // last `analysis` SSE payload (≤ 64 KB as compact JSON)
  summary_text: string | null;    // assistant text streamed by the last analyze run
  model: string | null;           // model id of the last analyze run
  analyzed_at: number | null;     // unix seconds of the last analyze save
  view: { from: number; to: number } | null;   // unix seconds, stored as sent
  chart_state_revision: number;   // = revision (also sent on every doc response)
};
```

`WireShape` is the analyze wire shape (`PatternShape` incl. `guardrail`, `id`, optional
`drawing_id`) plus three chart-history flags:

| field | type | meaning |
|---|---|---|
| `origin` | `"ai" \| "user"` | who made it. Missing on PUT → `"user"` if `source=="human"`, else `"ai"` |
| `kept` | `boolean` | user pressed "Giữ" on an AI shape (default `false`) |
| `edited` | `boolean` | user moved/resized it (default `false`) |

**Pinned** = `origin == "user" || kept || edited`. There is no `pinned_ids` list and no
separate `user_shapes` array.

## Endpoints

All under `/v1/copilot/sessions/{sid}`. An unknown session is
`404 {"error": "session not found"}` on every route, the same as the existing session
routes. `{symbol}` is uppercased; `{interval}` outside the enum is
`422 {code: "invalid_interval"}`.

| method | path | success | errors |
|---|---|---|---|
| GET | `/charts` | `{charts: IndexEntry[]}` newest `updated_at` first | 404 session |
| GET | `/charts/{symbol}/{interval}` | doc | 404 `chart_state_not_found` (nothing saved) |
| PUT | `/charts/{symbol}/{interval}` | saved doc | 404, 409, 413, 422 (below) |
| DELETE | `/charts/{symbol}/{interval}` | `{ok: true}` | 404 `chart_state_not_found` (the web ignores it) |

```ts
type IndexEntry = {
  symbol: string; interval: Interval; updated_at: number; revision: number;
  analyzed_at: number | null; shape_count: number; has_analysis: boolean;
};
```

### PUT

Body = the doc minus `updated_at`, plus `revision` = the revision the client based its
edit on. `shapes` is required; `markers`, `analysis`, `summary_text`, `model`,
`analyzed_at` and `view` keep their stored value when omitted, and `null` clears them.
Echoed `symbol`, `interval`, `updated_at` and `chart_state_revision` are accepted and
ignored (the path is the key; the server owns the timestamps).

| case | result |
|---|---|
| no doc, no `revision` | create, `revision: 1` |
| no doc, `revision` given | `404 {code: "chart_state_not_found"}` |
| doc exists, `revision` == stored | save, `revision + 1` |
| doc exists, `revision` ≠ stored | `409 {code: "revision_conflict", message, current: <doc>}` |
| doc exists, no `revision` | `409 {code: "revision_conflict", message, current: <doc>}` (create-only) |
| over a limit | `413 {code: "chart_state_too_large", message, limit: {shapes: 200} \| {markers: 300} \| {analysis_bytes: 65536}}` |
| bad body / a shape or marker for another symbol/interval | `422 {code: "invalid_chart_state" \| "chart_key_mismatch", message, detail}` |

Limits are checked before per-item validation, so an oversized body is 413, not 422.
Writes are optimistic: `UPDATE … WHERE revision = base`, so two writers never both win.

### Session delete

Deleting a session deletes all its charts in the same transaction (explicit delete; the
FK is also `ON DELETE CASCADE` for databases that enforce it). Session eviction
(`MAX_SESSIONS`) cascades the same way.

## Analyze auto-save

When `POST /v1/copilot/analyze` carries `session_id` (+ the request's `symbol` and
`interval`), the server saves the run itself after the runner's last event, in one
transaction:

1. Load the doc for `(session_id, SYMBOL, interval)` (or start empty).
2. Keep the pinned shapes as they are, and markers whose `drawing_id` is a pinned shape's
   `id`/`drawing_id`. A new shape with a pinned shape's id is dropped (the pinned one wins).
3. Replace every unpinned AI shape and every other marker with the run's shapes/markers.
   An empty run therefore clears the unpinned AI shapes.
4. Keep `view`. Set `analysis`, `summary_text`, `model`, `analyzed_at`; `revision + 1`.

Stream changes (additive):

- `shapes` event: every shape carries `origin: "ai", kept: false, edited: false`, and the
  event adds `labels: {<id>: <Vietnamese name>}`.
- A final `meta` event right before `done` carries `chart_state_revision` (the saved
  revision). If the save fails, that `meta` carries `chart_state_error` instead
  (`session_not_found`, `chart_state_too_large` + `limit`, `chart_state_save_failed`).
- A run that ends with an `error` event saves nothing.

Without `session_id`, nothing is saved and no `chart_state_revision` is sent.

## Storage

`chart_states(id PK, session_id FK→copilot_sessions.id ON DELETE CASCADE, symbol,
interval, revision INT, doc TEXT (JSON), updated_at FLOAT, analyzed_at FLOAT NULL,
UNIQUE(session_id, symbol, interval))`, index on `session_id`. Same database as the
sessions (SQLite locally, Postgres or Turso/libSQL in deploy), via SQLAlchemy + alembic.
`doc` holds `shapes`, `markers`, `analysis`, `summary_text`, `model`, `view`; the other
doc fields are columns.

## Fixtures and tests

- `apps/copilot/tests/fixtures/wire/chart_state.json`: a doc after an analyze run on top
  of user, kept, edited and plain AI shapes.
- `apps/copilot/tests/fixtures/wire/chart_index.json`: `GET …/charts`.
- `apps/copilot/tests/fixtures/wire/chart_conflict_409.json`: PUT with a stale revision.
- `tests/test_chart_state.py` (CRUD, 404/409/413/422, cascade, merge) and
  `tests/test_chart_autosave.py` (analyze save, fixtures, web Zod via `chart-state.ts`).
