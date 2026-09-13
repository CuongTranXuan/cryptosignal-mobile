import type { ConnectionStatus } from "./stores/chart-store";

export function isSendDisabled(connection: ConnectionStatus, inFlight: boolean): boolean {
  return connection === "pair-unavailable" || inFlight;
}

export function isDrawDisabled(previewCount: number): boolean {
  return previewCount === 0;
}
