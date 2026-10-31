/**
 * Copilot requests carry the backend's httpOnly `csm_device` cookie (device identity /
 * session ownership). The web app calls the copilot same-origin through the Next proxy
 * (`/v1/copilot/*`), so `credentials: "same-origin"` is enough; it is set explicitly so a
 * custom fetch or a future cross-origin base URL cannot silently drop the cookie.
 */
export function withCopilotCredentials(fetchImpl: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchImpl(input, { ...init, credentials: init?.credentials ?? "same-origin" })) as typeof fetch;
}
