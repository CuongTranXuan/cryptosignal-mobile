"use client";

import { memo, useMemo } from "react";
import type { CopilotModelRecord } from "../../lib/copilot-schema";
import {
  allowedUiReasoningLevels,
  apiReasoningToUi,
  modelShowsReasoningSelector,
  uiReasoningToApi,
  type UiReasoningLevel,
} from "../../lib/copilot-reasoning";
import {
  COPILOT_REASONING_HIGH,
  COPILOT_REASONING_LABEL,
  COPILOT_REASONING_LOW,
  COPILOT_REASONING_MEDIUM,
  COPILOT_REASONING_OFF,
} from "../../lib/copilot-strings";

const LABELS: Record<UiReasoningLevel, string> = {
  off: COPILOT_REASONING_OFF,
  low: COPILOT_REASONING_LOW,
  medium: COPILOT_REASONING_MEDIUM,
  high: COPILOT_REASONING_HIGH,
};

type CopilotReasoningControlProps = {
  model: CopilotModelRecord | null;
  reasoningEffort: string | null;
  onChange: (apiEffort: string | null) => void;
  disabled?: boolean;
};

function CopilotReasoningControlInner({
  model,
  reasoningEffort,
  onChange,
  disabled,
}: CopilotReasoningControlProps) {
  const visible = modelShowsReasoningSelector(model);
  const levels = useMemo(() => allowedUiReasoningLevels(model), [model]);
  const currentUi =
    apiReasoningToUi(reasoningEffort) ??
    (levels.includes("low") ? "low" : levels[0] ?? "off");

  if (!visible || levels.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-[#848e9c]">
        {COPILOT_REASONING_LABEL}
      </span>
      <div
        className="flex flex-wrap gap-1"
        role="group"
        aria-label={COPILOT_REASONING_LABEL}
      >
        {levels.map((level) => {
          const active = currentUi === level;
          return (
            <button
              key={level}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => {
                const api = uiReasoningToApi(level);
                onChange(api === "none" ? "none" : api);
              }}
              className={`rounded border px-2 py-0.5 text-[11px] ${
                active
                  ? "border-[#f0b90b] text-[#f0b90b]"
                  : "border-[#2b313a] text-[#eaecef] hover:border-[#848e9c]"
              } disabled:opacity-40`}
            >
              {LABELS[level]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const CopilotReasoningControl = memo(CopilotReasoningControlInner);
