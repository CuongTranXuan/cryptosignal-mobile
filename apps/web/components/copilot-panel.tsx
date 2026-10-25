"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { CopilotApiClient } from "../lib/copilot-api";
import { modelLabelForSession } from "../lib/copilot-model-defaults";
import { findCachedModel, getDefaultModelId, getModelsList } from "../lib/copilot-models-cache";
import {
  COPILOT_ACTION_DRAW_ON_CHART,
  COPILOT_ACTION_EDIT_COORDS,
  COPILOT_ACTION_FIND_TRIANGLES,
  COPILOT_ACTION_HEAD_SHOULDERS,
  COPILOT_EMPTY_STATE,
  COPILOT_INPUT_PLACEHOLDER,
  COPILOT_LOADING,
  COPILOT_OFFLINE,
  COPILOT_SEND,
  COPILOT_TAB_AUTO_DRAW,
  COPILOT_TAB_MANUAL,
  COPILOT_TITLE,
  HEAD_SHOULDERS_PROMPT,
  HEAD_SHOULDERS_QUICK_INTENT,
  TRIANGLES_PROMPT,
  TRIANGLES_QUICK_INTENT,
  copilotRoleLabel,
} from "../lib/copilot-strings";
import { isDrawDisabled, isSendDisabled } from "../lib/terminal-controls";
import { type CopilotClient } from "../lib/use-copilot";
import { useAiStore } from "../lib/stores/ai-store";
import { useChartStore } from "../lib/stores/chart-store";
import { useCopilotSessionStore } from "../lib/stores/copilot-session-store";
import { useShapeStore } from "../lib/stores/shape-store";
import { CopilotAnalyzeProgress } from "./copilot/copilot-analyze-progress";
import { CopilotCandleControl } from "./copilot/copilot-candle-control";
import { CopilotModelPicker } from "./copilot/copilot-model-picker";
import { CopilotReasoningControl } from "./copilot/copilot-reasoning-control";
import { CopilotBiasConflictBanner } from "./copilot/copilot-bias-conflict-banner";
import { CopilotIntentControls } from "./copilot/copilot-intent-controls";
import { CopilotSessionSidebar } from "./copilot/copilot-session-sidebar";

type CopilotPanelProps = {
  client: CopilotClient | null;
  api: CopilotApiClient;
};

export function CopilotPanel({ client, api }: CopilotPanelProps) {
  const mode = useAiStore((s) => s.mode);
  const messages = useAiStore((s) => s.messages);
  const inFlight = useAiStore((s) => s.inFlight);
  const lastError = useAiStore((s) => s.lastError);
  const health = useAiStore((s) => s.health);
  const setMode = useAiStore((s) => s.setMode);

  const sessions = useCopilotSessionStore((s) => s.sessions);
  const activeSessionId = useCopilotSessionStore((s) => s.activeSessionId);
  const modelId = useCopilotSessionStore((s) => s.modelId);
  const candleCount = useCopilotSessionStore((s) => s.candleCount);
  const customCandleCount = useCopilotSessionStore((s) => s.customCandleCount);
  const lastAnalyzeMeta = useCopilotSessionStore((s) => s.lastAnalyzeMeta);
  const candleClampHint = useCopilotSessionStore((s) => s.candleClampHint);
  const setModelId = useCopilotSessionStore((s) => s.setModelId);
  const setCandleCountPreset = useCopilotSessionStore((s) => s.setCandleCountPreset);
  const setCustomCandleCount = useCopilotSessionStore((s) => s.setCustomCandleCount);
  const createSession = useCopilotSessionStore((s) => s.createSession);
  const switchSession = useCopilotSessionStore((s) => s.switchSession);
  const renameSession = useCopilotSessionStore((s) => s.renameSession);
  const deleteSession = useCopilotSessionStore((s) => s.deleteSession);
  const reasoningEffort = useCopilotSessionStore((s) => s.reasoningEffort);
  const setReasoningEffort = useCopilotSessionStore((s) => s.setReasoningEffort);
  const sessionsError = useCopilotSessionStore((s) => s.sessionsError);
  const setSessionIntent = useCopilotSessionStore((s) => s.setSessionIntent);

  const connection = useChartStore((s) => s.connection);
  const shapes = useShapeStore((s) => s.shapes);
  const commitPreview = useShapeStore((s) => s.commitPreview);
  const select = useShapeStore((s) => s.select);
  const previews = shapes.filter((s) => s.status === "preview");

  const selectedModel = useMemo(() => findCachedModel(modelId), [modelId]);
  const headerModelLabel = useMemo(
    () => modelLabelForSession(getModelsList(), modelId, getDefaultModelId()),
    [modelId],
  );

  const [prompt, setPrompt] = useState("");
  const sendDisabled = isSendDisabled(connection, inFlight) || !client;
  const drawDisabled = isDrawDisabled(previews.length);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !client || sendDisabled) return;
    void client.analyze(trimmed);
  };

  const sendWithIntent = (text: string, intent: typeof TRIANGLES_QUICK_INTENT) => {
    void setSessionIntent(intent).then(() => send(text));
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

  const sessionRows = useMemo(
    () =>
      sessions.map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: new Date(s.updated_at * 1000).toISOString(),
        modelKey: s.model_id,
      })),
    [sessions],
  );

  return (
    <aside className="flex h-full min-h-0 flex-col bg-[#181a20]">
      <div className="flex h-10 flex-none items-center justify-between border-b border-[#2b313a] px-3">
        <span className="text-sm font-semibold text-white">{COPILOT_TITLE}</span>
        <span className="font-[family-name:var(--font-plex-mono)] text-[11px] text-[#848e9c]">
          {health?.ok ? headerModelLabel : COPILOT_OFFLINE}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <CopilotSessionSidebar
          sessions={sessionRows}
          activeSessionId={activeSessionId}
          onSelect={(id) => void switchSession(id)}
          onCreate={() => void createSession()}
          onRename={(id, title) => void renameSession(id, title)}
          onDelete={(id) => void deleteSession(id)}
          disabled={inFlight}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-none gap-2 border-b border-[#2b313a] p-2">
            <CopilotModelPicker
              api={api}
              selectedModelId={modelId}
              onSelect={setModelId}
              disabled={inFlight}
            />
          </div>

          <div className="flex flex-none flex-col gap-2 border-b border-[#2b313a] p-2">
            <CopilotReasoningControl
              model={selectedModel}
              reasoningEffort={reasoningEffort}
              onChange={setReasoningEffort}
              disabled={inFlight}
            />
            <CopilotCandleControl
              value={candleCount}
              customValue={customCandleCount}
              selectedModel={selectedModel}
              lastMeta={lastAnalyzeMeta}
              clampHint={candleClampHint}
              onPreset={setCandleCountPreset}
              onCustom={setCustomCandleCount}
              disabled={inFlight}
            />
            <CopilotIntentControls api={api} sessionId={activeSessionId} disabled={inFlight} />
          </div>

          <div className="flex flex-none gap-1 border-b border-[#2b313a] p-2">
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={`rounded px-2 py-1 text-xs ${
                mode === "manual" ? "bg-[#2b313a] text-[#f0b90b]" : "text-[#848e9c] hover:bg-[#2b313a]"
              }`}
            >
              {COPILOT_TAB_MANUAL}
            </button>
            <button
              type="button"
              onClick={() => setMode("auto")}
              className={`rounded px-2 py-1 text-xs ${
                mode === "auto" ? "bg-[#2b313a] text-[#f0b90b]" : "text-[#848e9c] hover:bg-[#2b313a]"
              }`}
            >
              {COPILOT_TAB_AUTO_DRAW}
            </button>
          </div>

          <div className="flex flex-none flex-wrap gap-1 border-b border-[#2b313a] p-2">
            <button
              type="button"
              disabled={sendDisabled}
              onClick={() => sendWithIntent(TRIANGLES_PROMPT, TRIANGLES_QUICK_INTENT)}
              className="rounded border border-[#2b313a] px-2 py-1 text-xs text-[#eaecef] hover:border-[#f0b90b] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {COPILOT_ACTION_FIND_TRIANGLES}
            </button>
            <button
              type="button"
              disabled={sendDisabled}
              onClick={() => sendWithIntent(HEAD_SHOULDERS_PROMPT, HEAD_SHOULDERS_QUICK_INTENT)}
              className="rounded border border-[#2b313a] px-2 py-1 text-xs text-[#eaecef] hover:border-[#f0b90b] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {COPILOT_ACTION_HEAD_SHOULDERS}
            </button>
            <button
              type="button"
              disabled={drawDisabled}
              onClick={() => commitPreview()}
              className="rounded border border-[#2b313a] px-2 py-1 text-xs text-[#0ecb81] hover:border-[#0ecb81] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {COPILOT_ACTION_DRAW_ON_CHART}
            </button>
            <button
              type="button"
              onClick={onEditCoords}
              className="rounded border border-[#2b313a] px-2 py-1 text-xs text-[#f0b90b] hover:border-[#f0b90b]"
            >
              {COPILOT_ACTION_EDIT_COORDS}
            </button>
          </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-sm">
        {sessionsError && (
          <div
            className="rounded border border-[#f0b90b]/40 bg-[#f0b90b]/10 px-2 py-1.5 text-xs text-[#f0b90b]"
            role="status"
          >
            {sessionsError}
          </div>
        )}
        <CopilotBiasConflictBanner intentCheck={lastAnalyzeMeta?.intent_check} />
        <CopilotAnalyzeProgress inFlight={inFlight} />
        {messages.length === 0 && (
              <p className="text-xs text-[#474d57]">{COPILOT_EMPTY_STATE}</p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`rounded px-2 py-1.5 text-xs leading-relaxed ${
                  m.role === "user" ? "bg-[#295238]/40 text-[#eaecef]" : "bg-[#1e2329] text-[#eaecef]"
                }`}
              >
                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-[#848e9c]">
                  {copilotRoleLabel(m.role, m.modelLabel)}
                </div>
                <div className="whitespace-pre-wrap">
                  {m.content || (inFlight ? COPILOT_LOADING : "")}
                </div>
              </div>
            ))}
            {lastError && (
              <div
                className="rounded border border-[#f6465d]/40 bg-[#f6465d]/10 px-2 py-1.5 text-xs text-[#f6465d]"
                role="alert"
              >
                {lastError}
              </div>
            )}
          </div>

          <form onSubmit={onSubmit} className="flex flex-none gap-2 border-t border-[#2b313a] p-2">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={COPILOT_INPUT_PLACEHOLDER}
              disabled={sendDisabled}
              className="min-w-0 flex-1 rounded border border-[#2b313a] bg-[#1e2329] px-2 py-1.5 text-xs text-white outline-none focus:border-[#f0b90b] disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={sendDisabled || !prompt.trim()}
              className="rounded bg-[#f0b90b] px-3 py-1.5 text-xs font-semibold text-[#0b0e14] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {COPILOT_SEND}
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
