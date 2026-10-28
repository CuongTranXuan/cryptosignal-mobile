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

## Ownership (device cookie)

Every session-scoped route is scoped to the calling device: session create, list, get,
patch and delete, `POST /analyze` with a `session_id`, and all chart routes.

- Auth is a cookie only, never a header: `csm_device=<device_id>.<hmac>`, `HttpOnly`,
  `SameSite=Lax`, `Path=/`, `Max-Age` 400 days, `Secure` in production. The HMAC key is
  `COPILOT_DEVICE_SECRET`.
- The backend sets it on the response to any `/v1/copilot/*` request that arrives without
  a valid cookie (a missing or forged cookie = a new device). Clients only need to keep
  cookies: a same-origin `fetch` does; a cross-origin one needs `credentials: "include"`.
  A proxy in front (the Next route) must forward `Cookie` and `Set-Cookie`.
- Another device's session, or any session hit without the cookie, is the usual
  `404 {"error": "session not found"}` (analyze autosave: `chart_state_error:
  "session_not_found"`). Never 401/403, so existence does not leak.
- `GET /sessions` lists only the caller's sessions. `MAX_SESSIONS` (50) eviction is per
  device, so one device never evicts another's sessions.
- Analyze coalescing ("superseded") is per device too.
- Legacy sessions created before ownership (`owner_id` NULL) are not listed; the first
  device that opens one by id adopts it, and from then on it is that device's.
- Dev only: `COPILOT_DEVICE_COOKIE_OPTIONAL=1` serves cookie-less requests unscoped (every
  session, as before ownership), for a proxy that does not forward cookies yet.

Storage: `copilot_sessions.owner_id` (nullable, indexed), alembic `20261028_0004`.

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
| over a limit | `413 {code: "chart_state_too_large", message, field, limit}` (see Limits) |
| bad body / a shape or marker for another symbol/interval | `422 {code: "invalid_chart_state" \| "chart_key_mismatch", message, detail}` |
| a `NaN`/`Infinity` literal or an overflowing number (`1e999`) anywhere | `422 {code: "invalid_number", message, detail: <token>}` |
| `view.from > view.to` (equal is fine) | `422 {code: "invalid_view_range", message, detail: {from, to}}` |
| two shapes with the same `id` | `422 {code: "duplicate_shape_id", message, detail: {ids}}` |

Limits are checked before per-item validation, so an oversized body is 413, not 422.
All 422 `message`s are Vietnamese. A chart PUT never answers 400; a body that is not JSON
at all is `422 invalid_chart_state` (unchanged). Order: `invalid_interval`/`invalid_symbol`
(path), `invalid_number`/not JSON, 413 caps, `invalid_chart_state` (schema),
`invalid_view_range`, `duplicate_shape_id`, `chart_key_mismatch`. Stored docs never
contain NaN.

### Limits

Every 413 uses the error envelope plus `field` (which cap) and `limit` (a number), with a
Vietnamese `message`:

| code | `field` | `limit` |
|---|---|---|
| `request_too_large` | `body_bytes` | raw request body, any `/v1/copilot` POST/PUT/PATCH: `COPILOT_MAX_BODY_BYTES`, default 1572864 (1.5 MiB) |
| `chart_state_too_large` | `shapes` | 200 shapes |
| | `markers` | 300 markers |
| | `points` | 500 points in one shape |
| | `string_bytes` | 2048 UTF-8 bytes for any string inside a shape or marker (names, labels, text) |
| | `summary_text_bytes` | 16384 UTF-8 bytes |
| | `analysis_bytes` | 65536 (compact JSON) |
| | `doc_bytes` | 1048576, the stored doc |
| | `charts` | 50 saved charts per session (a new `(symbol, interval)` beyond it; updates are fine) |

Example bodies (413, 422 and 503): `apps/copilot/tests/fixtures/wire/api_errors.json`.

### Database unavailable

When the database is unreachable or busy past its timeouts, every route that needs it
(sessions, charts, analyze with a `session_id`) answers
`503 {code: "db_unavailable", message}` with `Retry-After: 5`. It is retryable: keep the
local state and try again. `/health` answers the same 503 with `db: "unavailable"` (and
adds `db: "ok"` to its normal body). Analyze without a `session_id` does not touch the
database. A failed autosave never fails the analyze: the final `meta` carries
`chart_state_error: "db_unavailable"` and the stream still ends with `done`.
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
  (`session_not_found`, `chart_state_too_large` + `field` + `limit`, `db_unavailable`,
  `chart_state_save_failed`).
- A run that ends with an `error` event saves nothing.

Without `session_id`, nothing is saved and no `chart_state_revision` is sent.

## Storage

`chart_states(id PK, session_id FK→copilot_sessions.id ON DELETE CASCADE, symbol,
interval, revision INT, doc TEXT (JSON), updated_at FLOAT, analyzed_at FLOAT NULL,
UNIQUE(session_id, symbol, interval))`, index on `session_id`. Same database as the
sessions (SQLite locally, Postgres or Turso/libSQL in deploy), via SQLAlchemy + alembic.
`doc` holds `shapes`, `markers`, `analysis`, `summary_text`, `model`, `view`; the other
doc fields are columns. `shape_count` and `has_analysis` columns (alembic `20261028_0005`)
serve the index, which never parses the docs.

## Fixtures and tests

- `apps/copilot/tests/fixtures/wire/chart_state.json`: a doc after an analyze run on top
  of user, kept, edited and plain AI shapes.
- `apps/copilot/tests/fixtures/wire/chart_index.json`: `GET …/charts`.
- `apps/copilot/tests/fixtures/wire/chart_conflict_409.json`: PUT with a stale revision.
- `apps/copilot/tests/fixtures/wire/api_errors.json`: one body per new error code
  (`request_too_large`, `chart_state_too_large`, `db_unavailable`, `invalid_number`,
  `invalid_view_range`, `duplicate_shape_id`, `invalid_interval`), asserted against live
  responses in `test_size_caps.py`, `test_db_unavailable.py`, `test_chart_validation.py`.
- `tests/test_device_ownership.py`: cookie, per-device scoping, adoption, eviction.
- `tests/test_chart_state.py` (CRUD, 404/409/413/422, cascade, merge) and
  `tests/test_chart_autosave.py` (analyze save, fixtures, web Zod via `chart-state.ts`).
