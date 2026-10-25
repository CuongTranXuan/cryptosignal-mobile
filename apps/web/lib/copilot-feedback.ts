import type { CopilotApiClient } from "./copilot-api";
import type { FeedbackRequest } from "./copilot-schema";
import { COPILOT_FEEDBACK_FAILED } from "./copilot-strings";

export type FeedbackContext = {
  getSessionId: () => string | null;
  getMessageId: () => string | null;
  onError?: (message: string) => void;
};

type PendingEdit = {
  drawingId: string;
  before: unknown;
  after: unknown;
  timer: ReturnType<typeof setTimeout> | null;
};

export type CopilotFeedbackClient = {
  keep: (drawingId: string, snapshot?: unknown) => void;
  reject: (drawingId: string, snapshot?: unknown) => void;
  deleteShape: (drawingId: string, before?: unknown) => void;
  scheduleEdit: (drawingId: string, before: unknown, after: unknown) => void;
  flush: () => Promise<void>;
  dispose: () => void;
};

export const COPILOT_FEEDBACK_EDIT_DEBOUNCE_MS = 400;

function dedupeKey(req: FeedbackRequest): string {
  if (req.action === "edit") {
    return `${req.drawing_id}:edit:${JSON.stringify(req.after)}`;
  }
  return `${req.drawing_id}:${req.action}`;
}

export function createCopilotFeedbackClient(
  api: CopilotApiClient,
  ctx: FeedbackContext,
): CopilotFeedbackClient {
  const sent = new Set<string>();
  const pendingEdits = new Map<string, PendingEdit>();
  let lastErrorShownAt = 0;

  const notifyError = () => {
    const now = Date.now();
    if (now - lastErrorShownAt < 3000) return;
    lastErrorShownAt = now;
    ctx.onError?.(COPILOT_FEEDBACK_FAILED);
  };

  const submit = async (partial: Omit<FeedbackRequest, "session_id" | "client_ts">) => {
    const sessionId = ctx.getSessionId();
    if (!sessionId) return;
    const req: FeedbackRequest = {
      session_id: sessionId,
      message_id: ctx.getMessageId() ?? undefined,
      client_ts: Math.floor(Date.now() / 1000),
      ...partial,
    };
    const key = dedupeKey(req);
    if (sent.has(key)) return;
    sent.add(key);
    try {
      await api.submitFeedback(req);
    } catch {
      sent.delete(key);
      notifyError();
    }
  };

  const flushEdit = async (drawingId: string) => {
    const pending = pendingEdits.get(drawingId);
    if (!pending) return;
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    pendingEdits.delete(drawingId);
    await submit({
      drawing_id: drawingId,
      action: "edit",
      before: pending.before,
      after: pending.after,
    });
  };

  return {
    keep: (drawingId, snapshot) => {
      void submit({ drawing_id: drawingId, action: "keep", after: snapshot });
    },
    reject: (drawingId, snapshot) => {
      void submit({ drawing_id: drawingId, action: "reject", before: snapshot });
    },
    deleteShape: (drawingId, before) => {
      void submit({ drawing_id: drawingId, action: "delete", before });
    },
    scheduleEdit: (drawingId, before, after) => {
      const existing = pendingEdits.get(drawingId);
      const baseBefore = existing?.before ?? before;
      if (existing?.timer) clearTimeout(existing.timer);
      const entry: PendingEdit = {
        drawingId,
        before: baseBefore,
        after,
        timer: setTimeout(() => {
          void flushEdit(drawingId);
        }, COPILOT_FEEDBACK_EDIT_DEBOUNCE_MS),
      };
      pendingEdits.set(drawingId, entry);
    },
    flush: async () => {
      const ids = [...pendingEdits.keys()];
      for (const id of ids) {
        await flushEdit(id);
      }
    },
    dispose: () => {
      for (const pending of pendingEdits.values()) {
        if (pending.timer) clearTimeout(pending.timer);
      }
      pendingEdits.clear();
    },
  };
}

