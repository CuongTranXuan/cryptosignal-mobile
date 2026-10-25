"use client";

import type { IntentCheck } from "../../lib/copilot-schema";
import { formatBiasConflictNotice } from "../../lib/copilot-chart-ai";

type CopilotBiasConflictBannerProps = {
  intentCheck: IntentCheck | null | undefined;
};

export function CopilotBiasConflictBanner({ intentCheck }: CopilotBiasConflictBannerProps) {
  if (!intentCheck?.bias_conflict) return null;
  const text = formatBiasConflictNotice(intentCheck.message).replace(/^\n+/, "").trim();
  return (
    <div
      className="rounded border border-[#f0b90b]/50 bg-[#f0b90b]/10 px-2 py-1.5 text-xs text-[#f0b90b]"
      role="status"
      data-testid="copilot-bias-conflict"
    >
      {text}
    </div>
  );
}
