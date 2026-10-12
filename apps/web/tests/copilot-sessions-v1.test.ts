import { beforeEach, describe, expect, it } from "vitest";
import {
  SESSIONS_STORAGE_KEY,
  createEmptySession,
  loadSessionsBlob,
  saveSessionsBlob,
} from "../lib/copilot-sessions-v1";

describe("copilot.sessions.v1", () => {
  beforeEach(() => {
    localStorage.removeItem(SESSIONS_STORAGE_KEY);
  });

  it("persists under copilot.sessions.v1", () => {
    const session = createEmptySession("agentrouter/deepseek-v4-flash", "Test");
    saveSessionsBlob({ active_session_id: session.id, sessions: [session] });
    const blob = loadSessionsBlob();
    expect(blob.sessions[0]?.title).toBe("Test");
    expect(localStorage.getItem(SESSIONS_STORAGE_KEY)).toContain('"title":"Test"');
  });
});
