# OmniRoute config (local dev, Cường's Mac)

## 2026-10-13 05:46 (UTC+7): model visibility allowlist

**What changed:** the OmniRoute 3.8.51 setting `modelVisibilityAllowlist`. It was `[]`. It is now:

```json
["agentrouter/deepseek-v4-flash","cursor/auto","cursor/auto-balance","cursor/auto-cost","cursor/auto-intelligence","cursor/composer-2.5","cursor/composer-2.5-fast"]
```

`modelVisibilityDenylist`, `hidePaidModels` and `hideAutoCombos` were not changed.

**How it was set:** through the OmniRoute CLI, which signs in to the local server with the machine's own CLI token:
`omniroute --base-url http://127.0.0.1:20128 api settings patch-api-settings --body @allow.json`
The database was not edited directly.

**Backup:** `~/.omniroute/backups/storage-pre-allowlist-202610130545.sqlite`

**Evidence:** one "Reply OK" call per model, 2026-10-13.
- Working (200 with text): agentrouter/deepseek-v4-flash, and cursor auto, auto-balance, auto-cost, auto-intelligence, composer-2.5, composer-2.5-fast.
- agentrouter claude-opus-4-8, claude-opus-5, gpt-6-astra: 402 "Budget pool quota has been exhausted".
- cursor claude-*, gpt-5.6-*, cursor-grok-4.6, glm-5.2, kimi-k3: 502 "cursor-agent ... not_found" after about 18s each.
- cursor claude-4.5-haiku, gemini-3.x, kimi-k2.7-code: 502 "empty turn (usage/quota exhausted)".
- cursor composer-2: 400, because OmniRoute treats it as an image-generation model.

**Result:** `/v1/models` went from 1,625 to 228 entries. Two groups are still listed despite the allowlist:
- the `auto/*` combo routes (45);
- image and video catalogs: `aihorde/*` (164), `veo*` (4), and `cursor/composer-2`.

The copilot backend must still filter `/v1/copilot/models` on its own side.

**Revert:**
- Through the API: `omniroute --base-url http://127.0.0.1:20128 api settings patch-api-settings --body '{"modelVisibilityAllowlist":[]}'`
- Full restore: stop OmniRoute, copy the backup over `~/.omniroute/storage.sqlite` and remove the `-wal`/`-shm` files, then start it again.

## 2026-10-13 05:52 (UTC+7): hideAutoCombos = true

`hideAutoCombos` was set to `true` with the same CLI command, using the body `{"hideAutoCombos":true}`. The allowlist and other settings were not changed, and the backup above still covers this. All 45 `auto/*` combo routes are now hidden, and `/v1/models` went from 228 to **182** entries. Still listed: 164 `aihorde/*` image models, 4 `veo*` video models, and `cursor/composer-2`, which OmniRoute treats as an image model. To revert: `omniroute --base-url http://127.0.0.1:20128 api settings patch-api-settings --body '{"hideAutoCombos":false}'`
