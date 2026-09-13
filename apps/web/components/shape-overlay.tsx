"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ChartCoordinateApi } from "../lib/chart-api";
import { mapShapeToPixels, mapZoneToRect, pixelsToPoint } from "../lib/overlay-map";
import type { PatternShape } from "../lib/pattern-shape";
import { useShapeStore } from "../lib/stores/shape-store";

const NODE_R = 5;
const NODE_HIT = 8;
const PREVIEW_STROKE = "#f0b90b";
const COMMITTED_STROKE = "#0ecb81";
const ZONE_FILL = "rgba(240, 185, 11, 0.18)";

type ShapeOverlayProps = {
  coordApiRef: MutableRefObject<ChartCoordinateApi | null>;
  overlayTick: number;
};

type DragState =
  | { kind: "point"; shapeId: string; index: number; points: PatternShape["points"] }
  | { kind: "zone-edge"; shapeId: string; edge: "high" | "low"; low: number; high: number };

export function ShapeOverlay({ coordApiRef, overlayTick }: ShapeOverlayProps) {
  const shapes = useShapeStore((s) => s.shapes);
  const selectedId = useShapeStore((s) => s.selectedId);
  const patchPoints = useShapeStore((s) => s.patchPoints);
  const patchZone = useShapeStore((s) => s.patchZone);
  const select = useShapeStore((s) => s.select);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<DragState | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const api = coordApiRef.current;
  void overlayTick;

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current;
      const coord = coordApiRef.current;
      if (!drag || !coord || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (drag.kind === "point") {
        const next = pixelsToPoint(x, y, coord);
        if (next == null) return;
        const points = drag.points.map((p, i) => (i === drag.index ? next : p));
        drag.points = points;
        patchPoints(drag.shapeId, points);
        bump((n) => n + 1);
        return;
      }

      const price = coord.coordinateToPrice(y);
      if (price == null) return;
      let low = drag.low;
      let high = drag.high;
      if (drag.edge === "high") high = price;
      else low = price;
      if (!(low < high)) return;
      drag.low = low;
      drag.high = high;
      patchZone(drag.shapeId, low, high);
      bump((n) => n + 1);
    },
    [coordApiRef, patchPoints, patchZone],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const committed = shapes.filter((s) => s.status === "committed");
  const previews = shapes.filter((s) => s.status === "preview");

  return (
    <div className="pointer-events-none absolute inset-0">
      {(committed.length > 0 || previews.length > 0) && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded border border-[#2b313a] bg-[#181a20]/90 p-2 text-xs backdrop-blur">
          {committed.length > 0 && (
            <div className="mb-1 text-[#848e9c]">Active Layers ({committed.length}):</div>
          )}
          {committed.map((s) => (
            <div key={s.id} className="flex items-center gap-1 text-[#0ecb81]">
              <span>
                • {s.name} ({Math.round(s.confidence * 100)}%)
              </span>
            </div>
          ))}
          {previews.length > 0 && (
            <div className="mt-1 text-[#f0b90b]">Ghost preview ({previews.length})</div>
          )}
        </div>
      )}

      <svg
        ref={svgRef}
        className="pointer-events-auto absolute inset-0 h-full w-full"
        width={size.w}
        height={size.h}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        {shapes.map((shape) => {
          if (!api) return null;
          if (shape.kind === "zone") {
            return renderZone(shape, api, size.w, selectedId, dragRef, select);
          }
          return renderPath(shape, api, selectedId, dragRef, select);
        })}
      </svg>
    </div>
  );
}

function renderZone(
  shape: PatternShape,
  api: ChartCoordinateApi,
  paneWidth: number,
  selectedId: string | null,
  dragRef: MutableRefObject<DragState | null>,
  select: (id: string | null) => void,
) {
  const rect = mapZoneToRect(shape, api, paneWidth);
  if (!rect || rect.height <= 0) return null;
  const stroke = shape.status === "preview" ? PREVIEW_STROKE : COMMITTED_STROKE;
  const dash = shape.status === "preview" ? "6 4" : undefined;
  const selected = selectedId === shape.id;

  return (
    <g key={shape.id}>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        fill={ZONE_FILL}
        stroke={stroke}
        strokeWidth={selected ? 2 : 1}
        strokeDasharray={dash}
        onPointerDown={(e) => {
          e.stopPropagation();
          select(shape.id);
        }}
      />
      {selected && shape.priceHigh != null && shape.priceLow != null && (
        <>
          <circle
            cx={rect.x + rect.width / 2}
            cy={rect.y}
            r={NODE_R}
            fill={stroke}
            stroke="#0b0e14"
            strokeWidth={1}
            style={{ cursor: "ns-resize" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              dragRef.current = {
                kind: "zone-edge",
                shapeId: shape.id,
                edge: "high",
                low: shape.priceLow!,
                high: shape.priceHigh!,
              };
            }}
          />
          <circle
            cx={rect.x + rect.width / 2}
            cy={rect.y + rect.height}
            r={NODE_R}
            fill={stroke}
            stroke="#0b0e14"
            strokeWidth={1}
            style={{ cursor: "ns-resize" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              dragRef.current = {
                kind: "zone-edge",
                shapeId: shape.id,
                edge: "low",
                low: shape.priceLow!,
                high: shape.priceHigh!,
              };
            }}
          />
        </>
      )}
    </g>
  );
}

function renderPath(
  shape: PatternShape,
  api: ChartCoordinateApi,
  selectedId: string | null,
  dragRef: MutableRefObject<DragState | null>,
  select: (id: string | null) => void,
) {
  const pixels = mapShapeToPixels(shape, api);
  if (pixels.length < 2) return null;
  const stroke = shape.status === "preview" ? PREVIEW_STROKE : COMMITTED_STROKE;
  const dash = shape.status === "preview" ? "6 4" : undefined;
  const selected = selectedId === shape.id;
  const d = pixels.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <g key={shape.id}>
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeDasharray={dash}
        onPointerDown={(e) => {
          e.stopPropagation();
          select(shape.id);
        }}
      />
      {pixels.map((p, index) => (
        <circle
          key={`${shape.id}-${index}`}
          cx={p.x}
          cy={p.y}
          r={Math.max(NODE_R, NODE_HIT / 2)}
          fill={selected ? stroke : "transparent"}
          stroke={stroke}
          strokeWidth={1.5}
          style={{ cursor: selected ? "grab" : "pointer" }}
          onPointerDown={(e) => {
            e.stopPropagation();
            select(shape.id);
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = {
              kind: "point",
              shapeId: shape.id,
              index,
              points: shape.points.slice(),
            };
          }}
        />
      ))}
    </g>
  );
}
