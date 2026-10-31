"use client";

import { formatDetectedRegimeLabel } from "../../lib/copilot-chart-ai";
import { COPILOT_DETECTED_REGIME_EARLY } from "../../lib/copilot-strings";
import type { DrawingRegime } from "../../lib/copilot-schema";

type CopilotRegimeEarlyBadgeProps = {
  regime: DrawingRegime | null | undefined;
};

export function CopilotRegimeEarlyBadge({ regime }: CopilotRegimeEarlyBadgeProps) {
  if (!regime) return null;
  return (
    <div
      className="rounded border border-[#2b313a] bg-[#1e2329] px-2 py-1.5 text-xs text-[#eaecef]"
      role="status"
      data-testid="copilot-regime-early"
    >
      <span className="text-[#848e9c]">{COPILOT_DETECTED_REGIME_EARLY}: </span>
      <span className="font-medium text-[#f0b90b]">{formatDetectedRegimeLabel(regime)}</span>
    </div>
  );
}
