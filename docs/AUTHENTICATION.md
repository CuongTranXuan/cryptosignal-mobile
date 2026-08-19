# Dashboard Authentication

The browser dashboard uses first-party **username/password authentication**. It protects chart history, signal evidence, bot status, and scenario data. Telegram remains separately protected by its numeric owner allowlist.

| Property | Implementation |
|---|---|
| Password storage | Salted PBKDF2-SHA-256 with 310,000 iterations. |
| Session storage | Random 256-bit opaque browser token in an HTTP-only cookie; only its SHA-256 hash is persisted. |
| Session lifetime | 14 days; the session is checked against an expiry timestamp on every protected tRPC request. |
| Initial owner | A one-time bootstrap page requiring `DASHBOARD_BOOTSTRAP_TOKEN`, username, and password. |
| Authorization | Dashboard data uses `dashboardProtectedProcedure`; unauthenticated callers receive `UNAUTHORIZED`. |

## Owner setup

1. Set `DASHBOARD_BOOTSTRAP_TOKEN` to a random value of at least 32 characters in the persistent host’s protected environment file.
2. Deploy the API and static dashboard behind HTTPS.
3. Open the dashboard. If no credentials exist, the bootstrap screen appears.
4. Create the first administrator username and password with the bootstrap key.
5. Verify the dashboard loads after refresh, then store the password and bootstrap key in a password manager.

The bootstrap endpoint stops accepting setup as soon as the first credential is persisted. The development-only bootstrap validation endpoint is disabled when `NODE_ENV=production`.

## Security operations

Use HTTPS at the reverse proxy. Keep the dashboard and `/api/` on one browser origin where possible. Rotate the bootstrap key after initial setup, although it cannot create another owner after bootstrap completes. If a session must be revoked, remove its corresponding hashed row from `dashboard_sessions` through a reviewed operational procedure; do not expose session-administration controls in the read-only browser UI.

Passwords, bootstrap keys, raw session tokens, Telegram tokens, and ingestion tokens must never appear in browser bundles, logs, error messages, tests, screenshots, source code, or documentation examples.
