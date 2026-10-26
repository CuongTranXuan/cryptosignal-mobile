"use client";

import { formatAnalysisSummaryVi } from "../../lib/copilot-chart-ai";
import { COPILOT_ANALYSIS_CARD_TITLE } from "../../lib/copilot-strings";
import type { AnalysisSseEvent } from "../../lib/copilot-schema";
import { useChartStore } from "../../lib/stores/chart-store";

type CopilotAnalysisSummaryProps = {
  analysis: AnalysisSseEvent | null | undefined;
};

export function CopilotAnalysisSummary({ analysis }: CopilotAnalysisSummaryProps) {
  const symbol = useChartStore((s) => s.symbol);
  if (!analysis) return null;
  const body = formatAnalysisSummaryVi(analysis, symbol);
  if (!body) return null;
  return (
    <div
      className="rounded border border-[#2b313a] bg-[#1e2329] px-2 py-1.5 text-xs leading-relaxed text-[#eaecef]"
      role="status"
      data-testid="copilot-analysis-summary"
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#848e9c]">
        {COPILOT_ANALYSIS_CARD_TITLE}
      </div>
      <div className="whitespace-pre-wrap">{body}</div>
    </div>
  );
}
