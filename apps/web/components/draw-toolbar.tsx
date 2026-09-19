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
    <div className="pointer-events-auto absolute bottom-3 left-3 z-20 flex items-center gap-1 rounded border border-[#2b313a] bg-[#181a20]/95 p-1 text-xs shadow-lg backdrop-blur">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.title}
          onClick={() => setTool(t.id)}
          className={`rounded px-2 py-1 font-medium transition ${
            tool === t.id
              ? "bg-[#f0b90b] text-[#0b0e14]"
              : "text-[#848e9c] hover:bg-[#2b313a] hover:text-white"
          }`}
        >
          {t.label}
        </button>
      ))}
      {tool === "polyline" && draftPoints.length >= 3 && (
        <button
          type="button"
          onClick={() => onFinishPolyline?.()}
          className="rounded bg-[#0ecb81] px-2 py-1 font-medium text-[#0b0e14]"
        >
          Finish
        </button>
      )}
      {draftPoints.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => undoDraftPoint()}
            className="rounded px-2 py-1 text-[#848e9c] hover:bg-[#2b313a] hover:text-white"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => clearDraft()}
            className="rounded px-2 py-1 text-[#848e9c] hover:bg-[#2b313a] hover:text-white"
          >
            Cancel
          </button>
        </>
      )}
      {tool === "none" && selectedId && (
        <button
          type="button"
          onClick={() => remove(selectedId)}
          className="rounded px-2 py-1 text-[#f6465d] hover:bg-[#2b313a]"
        >
          Delete
        </button>
      )}
      {tool !== "none" && (
        <span className="ml-1 max-w-[10rem] truncate text-[10px] text-[#474d57]">
          {tool === "trendline" && "2 clicks"}
          {tool === "polyline" && `${draftPoints.length} pts`}
          {tool === "zone" && "2 corners"}
        </span>
      )}
    </div>
  );
}
