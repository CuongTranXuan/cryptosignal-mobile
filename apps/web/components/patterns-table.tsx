"use client";

import { labelForRegime } from "../lib/copilot-chart-ai";
import { formatInvalidationLine } from "../lib/guardrail-format";
import { shapeDisplayName } from "../lib/shape-labels";
import { evidenceItemRaw, evidenceItemText, preferEvidenceItems } from "../lib/vi-evidence";
import { getCopilotFeedbackClient } from "../lib/copilot-feedback-host";
import { shapeFeedbackSnapshot } from "../lib/copilot-shape-snapshot";
import {
  COPILOT_FEEDBACK_KEEP,
  COPILOT_FEEDBACK_REJECT,
  COPILOT_GUARDRAIL_EVIDENCE,
  COPILOT_GUARDRAIL_INVALIDATION,
  COPILOT_GUARDRAIL_NONE,
  COPILOT_GUARDRAIL_NO_EVIDENCE,
  PATTERNS_TABLE_ACTIONS,
  PATTERNS_TABLE_CONFIDENCE,
  PATTERNS_TABLE_GUARDRAIL,
  PATTERNS_TABLE_INTERVAL,
  PATTERNS_TABLE_KIND,
  PATTERNS_TABLE_PATTERN,
  PATTERNS_TABLE_DELETE,
  PATTERNS_TABLE_EDIT,
  PATTERNS_TABLE_EMPTY,
  PATTERNS_TABLE_TITLE,
  PATTERNS_TABLE_TOTAL,
  SHAPE_KIND_LABELS,
} from "../lib/copilot-strings";
import type { PatternShape } from "../lib/pattern-shape";
import { useChartStore } from "../lib/stores/chart-store";
import { useMarkerStore } from "../lib/stores/marker-store";
import { useShapeStore } from "../lib/stores/shape-store";

function GuardrailDetails({ shape }: { shape: PatternShape }) {
  const symbol = useChartStore((s) => s.symbol);
  const g = shape.guardrail;
  if (!g) {
    return <span className="text-[#474d57]">{COPILOT_GUARDRAIL_NONE}</span>;
  }
  const shapeSymbol = shape.symbol || symbol;
  const inv = formatInvalidationLine(g.invalidation, shapeSymbol);
  const against = preferEvidenceItems(g.evidence_against_items, g.evidence_against);
  return (
    <div className="space-y-1 text-[#848e9c]">
      <div className="text-[#eaecef]">
        {labelForRegime(g.regime)} · {Math.round(g.confidence * 100)}%
      </div>
      <div>
        <span className="text-[#848e9c]">{COPILOT_GUARDRAIL_EVIDENCE}: </span>
        {against.length > 0 ? (
          <ul className="mt-0.5 list-disc pl-4 text-[#eaecef]">
            {against.map((item, index) => (
              <li key={`${index}:${evidenceItemRaw(item)}`}>{evidenceItemText(item, shapeSymbol)}</li>
            ))}
          </ul>
        ) : (
          <span className="text-[#474d57]">{COPILOT_GUARDRAIL_NO_EVIDENCE}</span>
        )}
      </div>
      <div>
        <span className="text-[#848e9c]">{COPILOT_GUARDRAIL_INVALIDATION}: </span>
        <span className="text-[#eaecef]">{inv ?? "—"}</span>
      </div>
    </div>
  );
}

export function PatternsTable() {
  const shapes = useShapeStore((s) => s.shapes);
  const selectedId = useShapeStore((s) => s.selectedId);
  const select = useShapeStore((s) => s.select);
  const remove = useShapeStore((s) => s.remove);
  const keep = useShapeStore((s) => s.keep);
  const removeMarkersForDrawing = useMarkerStore((s) => s.removeLinkedToDrawing);

  const committed = shapes.filter((s) => s.status === "committed");

  const onKeep = (shape: PatternShape) => {
    getCopilotFeedbackClient()?.keep(shape.id, shapeFeedbackSnapshot(shape));
    keep(shape.id);
  };

  const onReject = (shape: PatternShape) => {
    getCopilotFeedbackClient()?.reject(shape.id, shapeFeedbackSnapshot(shape));
    removeMarkersForDrawing(shape.id);
    remove(shape.id);
  };

  const onDelete = (shape: PatternShape) => {
    getCopilotFeedbackClient()?.deleteShape(shape.id, shapeFeedbackSnapshot(shape));
    removeMarkersForDrawing(shape.id);
    remove(shape.id);
  };

  return (
    <div className="flex h-44 flex-none flex-col border-t border-[#2b313a] bg-[#181a20]">
      <div className="flex h-7 items-center justify-between border-b border-[#2b313a] px-3 text-xs text-[#848e9c]">
        <span className="font-semibold text-white">{PATTERNS_TABLE_TITLE}</span>
        <span>
          {PATTERNS_TABLE_TOTAL}: {committed.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 font-[family-name:var(--font-plex-mono)] text-xs">
        <table className="w-full text-left">
          <thead className="border-b border-[#2b313a] text-[#848e9c]">
            <tr>
              <th className="pb-1 font-medium">{PATTERNS_TABLE_PATTERN}</th>
              <th className="pb-1 font-medium">{PATTERNS_TABLE_INTERVAL}</th>
              <th className="pb-1 font-medium">{PATTERNS_TABLE_KIND}</th>
              <th className="pb-1 font-medium">{PATTERNS_TABLE_CONFIDENCE}</th>
              <th className="pb-1 font-medium">{PATTERNS_TABLE_GUARDRAIL}</th>
              <th className="pb-1 font-medium">{PATTERNS_TABLE_ACTIONS}</th>
            </tr>
          </thead>
          <tbody>
            {committed.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-[#474d57]">
                  {PATTERNS_TABLE_EMPTY}
                </td>
              </tr>
            )}
            {committed.map((s) => (
              <tr
                key={s.id}
                className={`border-b border-[#2b313a]/60 ${
                  selectedId === s.id ? "bg-[#2b313a]/60" : ""
                } ${s.kept ? "opacity-70" : ""}`}
              >
                <td className="py-1.5 text-white">{shapeDisplayName(s)}</td>
                <td className="py-1.5">{s.interval}</td>
                <td className="py-1.5">{SHAPE_KIND_LABELS[s.kind] ?? s.kind}</td>
                <td className="py-1.5 text-[#0ecb81]">{Math.round(s.confidence * 100)}%</td>
                <td className="max-w-[12rem] py-1.5" data-testid="patterns-guardrail-cell">
                  <GuardrailDetails shape={s} />
                </td>
                <td className="py-1.5 whitespace-nowrap" data-testid="patterns-feedback-cell">
                  {s.source === "agent" && !s.kept && (
                    <>
                      <button
                        type="button"
                        data-testid="feedback-keep"
                        className="mr-2 text-[#0ecb81] hover:underline"
                        onClick={() => onKeep(s)}
                      >
                        {COPILOT_FEEDBACK_KEEP}
                      </button>
                      <button
                        type="button"
                        data-testid="feedback-reject"
                        className="mr-2 text-[#f6465d] hover:underline"
                        onClick={() => onReject(s)}
                      >
                        {COPILOT_FEEDBACK_REJECT}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="mr-2 text-[#eaecef] hover:underline"
                    onClick={() => select(s.id)}
                  >
                    {PATTERNS_TABLE_EDIT}
                  </button>
                  <button
                    type="button"
                    className="text-[#f6465d] hover:underline"
                    onClick={() => onDelete(s)}
                  >
                    {PATTERNS_TABLE_DELETE}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
