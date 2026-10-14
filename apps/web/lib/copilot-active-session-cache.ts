/** Only persisted client hint: last active server session id. */
export const ACTIVE_SESSION_STORAGE_KEY = "copilot.active_session_id";

export function loadActiveSessionId(): string | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    if (!raw?.trim()) return null;
    return raw.trim();
  } catch {
    return null;
  }
}

export function saveActiveSessionId(sessionId: string | null): void {
  try {
    if (!sessionId) {
      localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
  } catch {
    /* ignore quota / private mode */
  }
}
