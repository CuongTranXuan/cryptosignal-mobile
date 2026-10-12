"use client";

import { memo, useCallback, useId, useState } from "react";
import {
  COPILOT_SESSION_DELETE,
  COPILOT_SESSION_DELETE_CONFIRM,
  COPILOT_SESSION_EMPTY,
  COPILOT_SESSION_NEW,
  COPILOT_SESSION_RENAME,
  COPILOT_SESSIONS_TITLE,
} from "../../lib/copilot-strings";
export type CopilotSessionListItem = {
  id: string;
  title: string;
  updatedAt: string;
  modelKey: string | null;
};

type CopilotSessionSidebarProps = {
  sessions: CopilotSessionListItem[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
};

function CopilotSessionSidebarInner({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  disabled,
}: CopilotSessionSidebarProps) {
  const listId = useId();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const startRename = useCallback((session: CopilotSessionListItem) => {
    setRenamingId(session.id);
    setRenameDraft(session.title);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId && renameDraft.trim()) {
      onRename(renamingId, renameDraft);
    }
    setRenamingId(null);
  }, [onRename, renameDraft, renamingId]);

  return (
    <nav
      className="flex w-[9.5rem] shrink-0 flex-col border-r border-[#2b313a] bg-[#14161a]"
      aria-label={COPILOT_SESSIONS_TITLE}
    >
      <div className="flex items-center justify-between border-b border-[#2b313a] px-2 py-1.5">
        <span className="text-[11px] font-semibold text-[#eaecef]">{COPILOT_SESSIONS_TITLE}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={onCreate}
          className="rounded px-1.5 py-0.5 text-[10px] text-[#f0b90b] hover:bg-[#2b313a] disabled:opacity-40"
        >
          {COPILOT_SESSION_NEW}
        </button>
      </div>
      <ul id={listId} className="min-h-0 flex-1 overflow-y-auto p-1" role="listbox" aria-label={COPILOT_SESSIONS_TITLE}>
        {sessions.length === 0 && (
          <li className="px-1 py-2 text-[10px] leading-snug text-[#474d57]">{COPILOT_SESSION_EMPTY}</li>
        )}
        {sessions.map((session) => {
          const active = session.id === activeSessionId;
          const renaming = renamingId === session.id;
          return (
            <li key={session.id} role="presentation" className="mb-0.5">
              {renaming ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  className="w-full rounded border border-[#f0b90b] bg-[#1e2329] px-1 py-0.5 text-[11px] text-white outline-none"
                  aria-label={COPILOT_SESSION_RENAME}
                />
              ) : (
                <div className="group flex items-stretch gap-0.5">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={disabled}
                    onClick={() => onSelect(session.id)}
                    className={`min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-[11px] ${
                      active ? "bg-[#2b313a] text-[#f0b90b]" : "text-[#eaecef] hover:bg-[#2b313a]/50"
                    }`}
                  >
                    {session.title}
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => startRename(session)}
                    className="rounded px-1 text-[9px] text-[#848e9c] opacity-0 hover:text-[#f0b90b] group-hover:opacity-100 focus:opacity-100"
                    aria-label={COPILOT_SESSION_RENAME}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (window.confirm(COPILOT_SESSION_DELETE_CONFIRM)) onDelete(session.id);
                    }}
                    className="rounded px-1 text-[9px] text-[#848e9c] opacity-0 hover:text-[#f6465d] group-hover:opacity-100 focus:opacity-100"
                    aria-label={COPILOT_SESSION_DELETE}
                  >
                    ×
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export const CopilotSessionSidebar = memo(CopilotSessionSidebarInner);
