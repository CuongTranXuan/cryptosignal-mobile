"use client";

import { COPILOT_INTENT_BUDGET_FALLBACK } from "../../lib/copilot-strings";
import type { AnalyzeMetaEvent } from "../../lib/copilot-schema";

type CopilotIntentBudgetNoteProps = {
  meta: AnalyzeMetaEvent | null | undefined;
};

export function CopilotIntentBudgetNote({ meta }: CopilotIntentBudgetNoteProps) {
  if (!meta?.intent_budget_fallback) return null;
  return (
    <p
      className="text-xs text-[#848e9c]"
      role="status"
      data-testid="copilot-intent-budget-fallback"
    >
      {COPILOT_INTENT_BUDGET_FALLBACK.replace(/^\n+/, "").trim()}
    </p>
  );
}
