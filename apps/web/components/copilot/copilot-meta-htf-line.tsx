"use client";

import { formatMetaHtfLine } from "../../lib/htf-format";
import type { AnalyzeMetaEvent } from "../../lib/copilot-schema";

type CopilotMetaHtfLineProps = {
  meta: AnalyzeMetaEvent | null | undefined;
};

export function CopilotMetaHtfLine({ meta }: CopilotMetaHtfLineProps) {
  const line = formatMetaHtfLine(meta);
  if (!line) return null;
  return (
    <p className="text-xs text-[#848e9c]" role="status" data-testid="copilot-meta-htf">
      {line}
    </p>
  );
}
