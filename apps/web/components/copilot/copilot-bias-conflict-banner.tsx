"use client";

import type { ChartBias, IntentCheck } from "../../lib/copilot-schema";
import { formatBiasConflictBannerText } from "../../lib/copilot-display";
import { translateBackendText } from "../../lib/vi-evidence";

type CopilotBiasConflictBannerProps = {
  intentCheck: IntentCheck | null | undefined;
  userBias?: ChartBias | null;
};

export function CopilotBiasConflictBanner({
  intentCheck,
  userBias,
}: CopilotBiasConflictBannerProps) {
  if (!intentCheck?.bias_conflict) return null;
  const text = formatBiasConflictBannerText(intentCheck, userBias);
  const message = intentCheck.message?.trim();
  const detail = message ? translateBackendText(message) : undefined;
  return (
    <div
      className="rounded border border-[#f0b90b]/50 bg-[#f0b90b]/10 px-2 py-1.5 text-xs text-[#f0b90b]"
      role="status"
      data-testid="copilot-bias-conflict"
      title={detail && detail !== text ? detail : undefined}
    >
      {text}
    </div>
  );
}
