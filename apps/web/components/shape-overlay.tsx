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
import { buildHumanShape, shouldAutoCommit } from "../lib/human-draw";
import { mapShapeToPixels, mapZoneToRect, pixelsToPoint } from "../lib/overlay-map";
import type { PatternShape } from "../lib/pattern-shape";
import { useChartStore } from "../lib/stores/chart-store";
import { useDrawToolStore } from "../lib/stores/draw-tool-store";
import { useShapeStore } from "../lib/stores/shape-store";
import { DrawToolbar } from "./draw-toolbar";

const NODE_R = 5;
/** Hit-target radius in px (diameter ≥ 16) so nodes are easy to grab. */
const NODE_HIT_R = 8;
const PREVIEW_STROKE = "#f0b90b";
const COMMITTED_STROKE = "#0ecb81";
const HUMAN_STROKE = "#3b82f6";
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
  const addCommitted = useShapeStore((s) => s.addCommitted);

  const tool = useDrawToolStore((s) => s.tool);
  const draftPoints = useDrawToolStore((s) => s.draftPoints);
  const addDraftPoint = useDrawToolStore((s) => s.addDraftPoint);
  const clearDraft = useDrawToolStore((s) => s.clearDraft);
  const setTool = useDrawToolStore((s) => s.setTool);

  const symbol = useChartStore((s) => s.symbol);
  const interval = useChartStore((s) => s.interval);

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

  const finishWithPoints = useCallback(
    (points: PatternShape["points"], activeTool: typeof tool) => {
      if (activeTool === "none") return;
      const shape = buildHumanShape({ tool: activeTool, points, symbol, interval });
      if (!shape) return;
      addCommitted(shape);
      clearDraft();
      setTool("none");
    },
    [addCommitted, clearDraft, interval, setTool, symbol],
  );

  const onFinishPolyline = useCallback(() => {
    const points = useDrawToolStore.getState().draftPoints;
    finishWithPoints(points, "polyline");
  }, [finishWithPoints]);

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

  const onSvgPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (tool === "none") return;
      if (e.button !== 0) return;
      const coord = coordApiRef.current;
      if (!coord || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const point = pixelsToPoint(e.clientX - rect.left, e.clientY - rect.top, coord);
      if (point == null) return;
      e.stopPropagation();
      e.preventDefault();

      const nextPoints = [...useDrawToolStore.getState().draftPoints, point];
      addDraftPoint(point);
      if (shouldAutoCommit(tool, nextPoints.length)) {
        finishWithPoints(nextPoints, tool);
      }
    },
    [addDraftPoint, coordApiRef, finishWithPoints, tool],
  );

  const committed = shapes.filter((s) => s.status === "committed");
  const previews = shapes.filter((s) => s.status === "preview");
  const drawing = tool !== "none";

  const draftPixels =
    api && draftPoints.length > 0
      ? draftPoints
          .map((p) => {
            const x = api.timeToCoordinate(p.time);
            const y = api.priceToCoordinate(p.price);
            if (x == null || y == null) return null;
            return { x, y };
          })
          .filter((p): p is { x: number; y: number } => p != null)
      : [];

  return (
    <div className={`absolute inset-0 ${drawing ? "pointer-events-auto" : "pointer-events-none"}`}>
      {(committed.length > 0 || previews.length > 0) && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded border border-[#2b313a] bg-[#181a20]/90 p-2 text-xs backdrop-blur">
          {committed.length > 0 && (
            <div className="mb-1 text-[#848e9c]">Active Layers ({committed.length}):</div>
          )}
          {committed.map((s) => (
            <div
              key={s.id}
              className={`flex items-center gap-1 ${s.source === "human" ? "text-[#3b82f6]" : "text-[#0ecb81]"}`}
            >
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
        className={`absolute inset-0 h-full w-full ${drawing ? "pointer-events-auto cursor-crosshair" : "pointer-events-none"}`}
        width={size.w || "100%"}
        height={size.h || "100%"}
        style={drawing ? { touchAction: "none" } : undefined}
        onPointerDown={onSvgPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        {shapes.map((shape) => {
          if (!api) return null;
          if (shape.kind === "zone") {
            return renderZone(shape, api, size.w, selectedId, dragRef, !drawing);
          }
          return renderPath(shape, api, selectedId, dragRef, select, !drawing);
        })}
        {draftPixels.length >= 2 && (
          <path
            d={draftPixels.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")}
            fill="none"
            stroke={HUMAN_STROKE}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            className="pointer-events-none"
          />
        )}
        {draftPixels.map((p, i) => (
          <circle
            key={`draft-${i}`}
            cx={p.x}
            cy={p.y}
            r={NODE_R}
            fill={HUMAN_STROKE}
            className="pointer-events-none"
          />
        ))}
      </svg>

      <DrawToolbar onFinishPolyline={onFinishPolyline} />
    </div>
  );
}

function shapeStroke(shape: PatternShape): string {
  if (shape.status === "preview") return PREVIEW_STROKE;
  if (shape.source === "human") return HUMAN_STROKE;
  return COMMITTED_STROKE;
}

function renderZone(
  shape: PatternShape,
  api: ChartCoordinateApi,
  paneWidth: number,
  selectedId: string | null,
  dragRef: MutableRefObject<DragState | null>,
  interactive: boolean,
) {
  const rect = mapZoneToRect(shape, api, paneWidth);
  if (!rect || rect.height <= 0) return null;
  const stroke = shapeStroke(shape);
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
        className="pointer-events-none"
      />
      {interactive && selected && shape.priceHigh != null && shape.priceLow != null && (
        <>
          <circle
            cx={rect.x + rect.width / 2}
            cy={rect.y}
            r={NODE_HIT_R}
            fill={stroke}
            stroke="#0b0e14"
            strokeWidth={1}
            className="pointer-events-auto"
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
            r={NODE_HIT_R}
            fill={stroke}
            stroke="#0b0e14"
            strokeWidth={1}
            className="pointer-events-auto"
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
  interactive: boolean,
) {
  const pixels = mapShapeToPixels(shape, api);
  if (pixels.length < 2) return null;
  const stroke = shapeStroke(shape);
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
        className={interactive ? "pointer-events-auto" : "pointer-events-none"}
        style={{ cursor: interactive ? "pointer" : "default" }}
        onPointerDown={(e) => {
          if (!interactive) return;
          e.stopPropagation();
          select(shape.id);
        }}
      />
      {pixels.map((p, index) => (
        <circle
          key={`${shape.id}-${index}`}
          cx={p.x}
          cy={p.y}
          r={Math.max(NODE_R, NODE_HIT_R)}
          fill={selected ? stroke : "transparent"}
          stroke={stroke}
          strokeWidth={1.5}
          className={interactive ? "pointer-events-auto" : "pointer-events-none"}
          style={{ cursor: interactive ? (selected ? "grab" : "pointer") : "default" }}
          onPointerDown={(e) => {
            if (!interactive) return;
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
