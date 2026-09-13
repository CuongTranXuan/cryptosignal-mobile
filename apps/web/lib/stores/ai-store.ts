import { create } from "zustand";

export type AiMode = "manual" | "auto";

export type AiMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
};

export type CopilotHealth = {
  ok: boolean;
  style: string;
  model: string;
  baseHost: string;
};

type AiState = {
  mode: AiMode;
  messages: AiMessage[];
  inFlight: boolean;
  lastError: string | null;
  panelWidth: number;
  health: CopilotHealth | null;
  setMode: (mode: AiMode) => void;
  setPanelWidth: (panelWidth: number) => void;
  appendUser: (content: string) => void;
  startAgent: () => void;
  appendText: (delta: string) => void;
  fail: (message: string) => void;
  finish: () => void;
  setHealth: (health: CopilotHealth | null) => void;
};

let messageSeq = 0;
const nextId = (prefix: string) => {
  messageSeq += 1;
  return `${prefix}-${messageSeq}`;
};

export const useAiStore = create<AiState>((set, get) => ({
  mode: "manual",
  messages: [],
  inFlight: false,
  lastError: null,
  panelWidth: 360,
  health: null,

  setMode: (mode) => set({ mode }),
  setPanelWidth: (panelWidth) => set({ panelWidth }),

  appendUser: (content) =>
    set({
      messages: [...get().messages, { id: nextId("user"), role: "user", content }],
      lastError: null,
    }),

  startAgent: () =>
    set({
      inFlight: true,
      lastError: null,
      messages: [...get().messages, { id: nextId("agent"), role: "agent", content: "" }],
    }),

  appendText: (delta) => {
    const messages = get().messages.slice();
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role === "agent") {
        messages[i] = { ...msg, content: msg.content + delta };
        set({ messages });
        return;
      }
    }
  },

  fail: (message) => set({ inFlight: false, lastError: message }),

  finish: () => set({ inFlight: false }),

  setHealth: (health) => set({ health }),
}));
