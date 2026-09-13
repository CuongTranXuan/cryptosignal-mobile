"use client";

import { useShapeStore } from "../lib/stores/shape-store";

export function PatternsTable() {
  const shapes = useShapeStore((s) => s.shapes);
  const selectedId = useShapeStore((s) => s.selectedId);
  const select = useShapeStore((s) => s.select);
  const remove = useShapeStore((s) => s.remove);

  const committed = shapes.filter((s) => s.status === "committed");

  return (
    <div className="flex h-36 flex-none flex-col border-t border-[#2b313a] bg-[#181a20]">
      <div className="flex h-7 items-center justify-between border-b border-[#2b313a] px-3 text-xs text-[#848e9c]">
        <span className="font-semibold text-white">Detected Patterns & Drawings</span>
        <span>Total Active Shapes: {committed.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 font-[family-name:var(--font-plex-mono)] text-xs">
        <table className="w-full text-left">
          <thead className="border-b border-[#2b313a] text-[#848e9c]">
            <tr>
              <th className="pb-1 font-medium">Pattern</th>
              <th className="pb-1 font-medium">TF</th>
              <th className="pb-1 font-medium">Kind</th>
              <th className="pb-1 font-medium">Confidence</th>
              <th className="pb-1 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {committed.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-[#474d57]">
                  No committed shapes yet
                </td>
              </tr>
            )}
            {committed.map((s) => (
              <tr
                key={s.id}
                className={`border-b border-[#2b313a]/60 ${
                  selectedId === s.id ? "bg-[#2b313a]/60" : ""
                }`}
              >
                <td className="py-1.5 text-white">{s.name}</td>
                <td className="py-1.5">{s.interval}</td>
                <td className="py-1.5">{s.kind}</td>
                <td className="py-1.5 text-[#0ecb81]">{Math.round(s.confidence * 100)}%</td>
                <td className="py-1.5">
                  <button
                    type="button"
                    className="mr-2 text-[#f0b90b] hover:underline"
                    onClick={() => select(s.id)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-[#f6465d] hover:underline"
                    onClick={() => remove(s.id)}
                  >
                    Delete
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
