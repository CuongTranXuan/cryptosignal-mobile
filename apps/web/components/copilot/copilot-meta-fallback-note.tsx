"use client";

import { COPILOT_SERVER_PICKED_SHAPES } from "../../lib/copilot-strings";
import type { AnalyzeMetaEvent } from "../../lib/copilot-schema";

type CopilotMetaFallbackNoteProps = {
  meta: AnalyzeMetaEvent | null | undefined;
};

export function metaShowsServerPickedShapes(meta: AnalyzeMetaEvent | null | undefined): boolean {
  return Boolean(meta?.validator_fallback || meta?.intent_budget_fallback);
}

export function CopilotMetaFallbackNote({ meta }: CopilotMetaFallbackNoteProps) {
  if (!metaShowsServerPickedShapes(meta)) return null;
  return (
    <p className="text-xs text-[#848e9c]" role="status" data-testid="copilot-meta-fallback-note">
      {COPILOT_SERVER_PICKED_SHAPES}
    </p>
  );
}
