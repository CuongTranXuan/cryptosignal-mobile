"use client";

import { useState, type FormEvent } from "react";
import { isDrawDisabled, isSendDisabled } from "../lib/terminal-controls";
import {
  HEAD_SHOULDERS_PROMPT,
  TRIANGLES_PROMPT,
  type CopilotClient,
} from "../lib/use-copilot";
import { useAiStore } from "../lib/stores/ai-store";
import { useChartStore } from "../lib/stores/chart-store";
import { useShapeStore } from "../lib/stores/shape-store";

type CopilotPanelProps = {
  client: CopilotClient | null;
};

export function CopilotPanel({ client }: CopilotPanelProps) {
  const mode = useAiStore((s) => s.mode);
  const messages = useAiStore((s) => s.messages);
  const inFlight = useAiStore((s) => s.inFlight);
  const lastError = useAiStore((s) => s.lastError);
  const health = useAiStore((s) => s.health);
  const setMode = useAiStore((s) => s.setMode);

  const connection = useChartStore((s) => s.connection);
  const shapes = useShapeStore((s) => s.shapes);
  const commitPreview = useShapeStore((s) => s.commitPreview);
  const select = useShapeStore((s) => s.select);
  const previews = shapes.filter((s) => s.status === "preview");

  const [prompt, setPrompt] = useState("");
  const sendDisabled = isSendDisabled(connection, inFlight) || !client;
  const drawDisabled = isDrawDisabled(previews.length);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !client || sendDisabled) return;
    void client.analyze(trimmed);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(prompt);
    setPrompt("");
  };

  const onEditCoords = () => {
    const lastPreview = [...previews].reverse()[0];
    const lastCommitted = [...shapes].reverse().find((s) => s.status === "committed");
    const target = lastPreview ?? lastCommitted;
    if (target) select(target.id);
  };

  return (
    <aside className="flex h-full min-h-0 flex-col bg-[#181a20]">
      <div className="flex h-10 flex-none items-center justify-between border-b border-[#2b313a] px-3">
        <span className="text-sm font-semibold text-white">Copilot</span>
        <span className="font-[family-name:var(--font-plex-mono)] text-[11px] text-[#848e9c]">
          {health ? (
            <>
              {health.style}/{health.model}
            </>
          ) : (
            "offline"
          )}
        </span>
      </div>

      <div className="flex flex-none gap-1 border-b border-[#2b313a] p-2">
        <button
          type="button"
          onClick={() => setMode("manual")}
          className={`rounded px-2 py-1 text-xs ${
            mode === "manual" ? "bg-[#2b313a] text-[#f0b90b]" : "text-[#848e9c] hover:bg-[#2b313a]"
          }`}
        >
          Manual
        </button>
        <button
          type="button"
          onClick={() => setMode("auto")}
          className={`rounded px-2 py-1 text-xs ${
            mode === "auto" ? "bg-[#2b313a] text-[#f0b90b]" : "text-[#848e9c] hover:bg-[#2b313a]"
          }`}
        >
          Auto-Draw
        </button>
      </div>

      <div className="flex flex-none flex-wrap gap-1 border-b border-[#2b313a] p-2">
        <button
          type="button"
          disabled={sendDisabled}
          onClick={() => send(TRIANGLES_PROMPT)}
          className="rounded border border-[#2b313a] px-2 py-1 text-xs text-[#eaecef] hover:border-[#f0b90b] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Find triangles
        </button>
        <button
          type="button"
          disabled={sendDisabled}
          onClick={() => send(HEAD_SHOULDERS_PROMPT)}
          className="rounded border border-[#2b313a] px-2 py-1 text-xs text-[#eaecef] hover:border-[#f0b90b] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Head & shoulders
        </button>
        <button
          type="button"
          disabled={drawDisabled}
          onClick={() => commitPreview()}
          className="rounded border border-[#2b313a] px-2 py-1 text-xs text-[#0ecb81] hover:border-[#0ecb81] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Draw on chart
        </button>
        <button
          type="button"
          onClick={onEditCoords}
          className="rounded border border-[#2b313a] px-2 py-1 text-xs text-[#f0b90b] hover:border-[#f0b90b]"
        >
          Edit coords
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-sm">
        {messages.length === 0 && (
          <p className="text-xs text-[#474d57]">Ask the copilot to find patterns in the closed window.</p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded px-2 py-1.5 text-xs leading-relaxed ${
              m.role === "user" ? "bg-[#295238]/40 text-[#eaecef]" : "bg-[#1e2329] text-[#eaecef]"
            }`}
          >
            <div className="mb-0.5 text-[10px] uppercase tracking-wide text-[#848e9c]">{m.role}</div>
            <div className="whitespace-pre-wrap">{m.content || (inFlight ? "…" : "")}</div>
          </div>
        ))}
        {lastError && (
          <div className="rounded border border-[#f6465d]/40 bg-[#f6465d]/10 px-2 py-1.5 text-xs text-[#f6465d]">
            {lastError}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex flex-none gap-2 border-t border-[#2b313a] p-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask about this window…"
          disabled={sendDisabled}
          className="min-w-0 flex-1 rounded border border-[#2b313a] bg-[#1e2329] px-2 py-1.5 text-xs text-white outline-none focus:border-[#f0b90b] disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={sendDisabled || !prompt.trim()}
          className="rounded bg-[#f0b90b] px-3 py-1.5 text-xs font-semibold text-[#0b0e14] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </aside>
  );
}
