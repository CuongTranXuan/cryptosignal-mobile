"use client";

import { useDrawToolStore, type DrawTool } from "../lib/stores/draw-tool-store";
import { useShapeStore } from "../lib/stores/shape-store";

const TOOLS: { id: DrawTool; label: string; title: string }[] = [
  { id: "none", label: "Select", title: "Select / pan (no draw)" },
  { id: "trendline", label: "Trend", title: "Trendline — click 2 points" },
  { id: "polyline", label: "Poly", title: "Polyline — click points, Finish when >= 3" },
  { id: "zone", label: "Zone", title: "Zone — click 2 corners" },
];

export function DrawToolbar({
  onFinishPolyline,
}: {
  onFinishPolyline?: () => void;
}) {
  const tool = useDrawToolStore((s) => s.tool);
  const draftPoints = useDrawToolStore((s) => s.draftPoints);
  const setTool = useDrawToolStore((s) => s.setTool);
  const clearDraft = useDrawToolStore((s) => s.clearDraft);
  const undoDraftPoint = useDrawToolStore((s) => s.undoDraftPoint);
  const selectedId = useShapeStore((s) => s.selectedId);
  const remove = useShapeStore((s) => s.remove);

  return (
    <div
      role="toolbar"
      aria-label="Draw tools"
      className="pointer-events-auto absolute right-3 top-3 z-30 flex items-center gap-1.5 rounded-md border-2 border-[#f0b90b] bg-[#0b0e14] px-2 py-1.5 text-xs shadow-[0_0_0_1px_rgba(240,185,11,0.35),0_8px_24px_rgba(0,0,0,0.55)]"
    >
      <span className="mr-1 rounded bg-[#f0b90b] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0b0e14]">
        Draw
      </span>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.title}
          onClick={() => setTool(t.id)}
          className={`rounded px-2.5 py-1 font-semibold transition ${
            tool === t.id
              ? "bg-[#f0b90b] text-[#0b0e14]"
              : "bg-[#1e2329] text-[#eaecef] hover:bg-[#2b313a]"
          }`}
        >
          {t.label}
        </button>
      ))}
      {tool === "polyline" && draftPoints.length >= 3 && (
        <button
          type="button"
          onClick={() => onFinishPolyline?.()}
          className="rounded bg-[#0ecb81] px-2.5 py-1 font-semibold text-[#0b0e14]"
        >
          Finish
        </button>
      )}
      {draftPoints.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => undoDraftPoint()}
            className="rounded bg-[#1e2329] px-2 py-1 font-medium text-[#eaecef] hover:bg-[#2b313a]"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => clearDraft()}
            className="rounded bg-[#1e2329] px-2 py-1 font-medium text-[#eaecef] hover:bg-[#2b313a]"
          >
            Cancel
          </button>
        </>
      )}
      {tool === "none" && selectedId && (
        <button
          type="button"
          onClick={() => remove(selectedId)}
          className="rounded bg-[#1e2329] px-2 py-1 font-medium text-[#f6465d] hover:bg-[#2b313a]"
        >
          Delete
        </button>
      )}
      {tool !== "none" && (
        <span className="ml-1 max-w-[9rem] truncate text-[10px] font-medium text-[#f0b90b]">
          {tool === "trendline" && "Click 2 points"}
          {tool === "polyline" && `${draftPoints.length} pts · Finish when ≥3`}
          {tool === "zone" && "Click 2 corners"}
        </span>
      )}
    </div>
  );
}
