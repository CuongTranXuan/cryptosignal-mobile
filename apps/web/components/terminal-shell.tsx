"use client";

import { useEffect, useMemo, useRef } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { ChartCoordinateApi } from "../lib/chart-api";
import { useAiStore } from "../lib/stores/ai-store";
import { useBinanceMarket } from "../lib/use-binance-market";
import { createCopilotClient, type CopilotClient } from "../lib/use-copilot";
import { ChartCanvas } from "./chart-canvas";
import { CopilotPanel } from "./copilot-panel";
import { PatternsTable } from "./patterns-table";
import { TopBar } from "./top-bar";

export function TerminalShell() {
  const { closedTimes } = useBinanceMarket();
  const panelWidth = useAiStore((s) => s.panelWidth);
  const setPanelWidth = useAiStore((s) => s.setPanelWidth);

  const coordApiRef = useRef<ChartCoordinateApi | null>(null);
  const clientRef = useRef<CopilotClient | null>(null);
  const prevClosedRef = useRef<Set<number>>(new Set());
  const closedTimesRef = useRef(closedTimes);
  closedTimesRef.current = closedTimes;

  const client = useMemo(() => {
    const c = createCopilotClient({
      getClosedTimes: () => closedTimesRef.current,
      getCoordApi: () => coordApiRef.current,
    });
    clientRef.current = c;
    return c;
  }, []);

  useEffect(() => {
    client.watchShapesReset();
    void client.pollHealth();
    const healthTimer = window.setInterval(() => {
      void client.pollHealth();
    }, 30_000);
    return () => {
      window.clearInterval(healthTimer);
      client.dispose();
      clientRef.current = null;
    };
  }, [client]);

  useEffect(() => {
    const prev = prevClosedRef.current;
    let sawNew = false;
    for (const t of closedTimes) {
      if (!prev.has(t)) {
        sawNew = true;
        break;
      }
    }
    prevClosedRef.current = new Set(closedTimes);
    if (sawNew && prev.size > 0) {
      client.onClosedKline();
    }
  }, [closedTimes, client]);

  const defaultCopilotPct = Math.min(45, Math.max(18, (panelWidth / 1200) * 100));

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0b0e14] text-[#eaecef]">
      <TopBar />
      <Group
        orientation="horizontal"
        className="min-h-0 flex-1"
        onLayoutChanged={(layout) => {
          const copilotKey = Object.keys(layout).find((k) => k.includes("copilot")) ?? Object.keys(layout)[1];
          if (!copilotKey) return;
          const pct = layout[copilotKey];
          if (typeof pct === "number") {
            setPanelWidth(Math.round((pct / 100) * (window.innerWidth || 1200)));
          }
        }}
      >
        <Panel id="chart" minSize="40%" defaultSize={`${100 - defaultCopilotPct}%`} className="min-w-0">
          <div className="flex h-full min-h-0 flex-col">
            <ChartCanvas coordApiRef={coordApiRef} />
            <PatternsTable />
          </div>
        </Panel>
        <Separator className="w-1 bg-[#2b313a] hover:bg-[#f0b90b]" />
        <Panel
          id="copilot"
          minSize="18%"
          defaultSize={`${defaultCopilotPct}%`}
          onResize={(size) => {
            setPanelWidth(Math.round(size.inPixels));
          }}
          className="min-w-0"
        >
          <CopilotPanel client={client} />
        </Panel>
      </Group>
    </div>
  );
}
