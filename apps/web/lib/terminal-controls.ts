import type { ConnectionStatus } from "./stores/chart-store";

export function isSendDisabled(connection: ConnectionStatus, inFlight: boolean): boolean {
  return connection === "pair-unavailable" || inFlight;
}

export function isDrawDisabled(previewCount: number): boolean {
  return previewCount === 0;
}

/** Human-readable feed badge copy (spec table), not raw enum ids. */
export function feedBadgeLabel(connection: ConnectionStatus): string {
  switch (connection) {
    case "live":
      return "Live";
    case "reconnecting":
      return "Reconnecting";
    case "history-error":
      return "History unavailable";
    case "pair-unavailable":
      return "Pair not available";
    default: {
      const _exhaustive: never = connection;
      return _exhaustive;
    }
  }
}
