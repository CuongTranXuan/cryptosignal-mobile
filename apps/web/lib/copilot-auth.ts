/**
 * Device-token / ownership auth for copilot requests (backend support is coming).
 *
 * Nothing sends a token yet: once the backend defines the header and how a device gets its
 * token, register a provider with `setCopilotDeviceTokenProvider` and every request that
 * spreads `copilotAuthHeaders()` (chart-state API today) carries it.
 */

/** Header name is provisional — confirm with the backend before shipping a provider. */
export const COPILOT_DEVICE_TOKEN_HEADER = "X-Device-Token";

let tokenProvider: (() => string | null) | null = null;

export function setCopilotDeviceTokenProvider(provider: (() => string | null) | null): void {
  tokenProvider = provider;
}

export function copilotAuthHeaders(): Record<string, string> {
  const token = tokenProvider?.()?.trim();
  return token ? { [COPILOT_DEVICE_TOKEN_HEADER]: token } : {};
}
