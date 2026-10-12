"use client";

import { memo, useEffect, useState } from "react";
import { COPILOT_ANALYZING_ELAPSED, COPILOT_LOADING } from "../../lib/copilot-strings";

type CopilotAnalyzeProgressProps = {
  inFlight: boolean;
};

function CopilotAnalyzeProgressInner({ inFlight }: CopilotAnalyzeProgressProps) {
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!inFlight) {
      setElapsedSec(0);
      return;
    }
    const started = Date.now();
    setElapsedSec(0);
    const timer = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [inFlight]);

  if (!inFlight) return null;

  const elapsedLabel = COPILOT_ANALYZING_ELAPSED.replace("{seconds}", String(elapsedSec));

  return (
    <div
      className="flex items-center gap-2 rounded border border-[#2b313a] bg-[#1e2329] px-2 py-1.5 text-xs text-[#eaecef]"
      role="status"
      aria-live="polite"
    >
      <span
        className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#848e9c] border-t-[#f0b90b]"
        aria-hidden
      />
      <span>{COPILOT_LOADING}</span>
      <span className="text-[#848e9c]">{elapsedLabel}</span>
    </div>
  );
}

export const CopilotAnalyzeProgress = memo(CopilotAnalyzeProgressInner);
