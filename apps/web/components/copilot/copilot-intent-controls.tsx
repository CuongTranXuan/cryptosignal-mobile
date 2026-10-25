"use client";

import { useEffect, useMemo, useState } from "react";
import type { CopilotApiClient } from "../../lib/copilot-api";
import {
  displaySessionIntent,
  labelForBias,
  labelForPattern,
  labelForStyle,
  sanitizeIntentForStyle,
} from "../../lib/copilot-chart-ai";
import type { AnalyzeIntent, ChartBias, ChartStyleId } from "../../lib/copilot-schema";
import {
  COPILOT_BIAS_LABEL,
  COPILOT_BIAS_NONE,
  COPILOT_PATTERN_ANY,
  COPILOT_PATTERN_LABEL,
  COPILOT_STYLE_LABEL,
  COPILOT_STYLE_NO_PATTERNS,
} from "../../lib/copilot-strings";
import { useCopilotSessionStore } from "../../lib/stores/copilot-session-store";

type CopilotIntentControlsProps = {
  api: CopilotApiClient;
  sessionId: string | null;
  disabled?: boolean;
};

const BIAS_OPTIONS: (ChartBias | null)[] = [null, "bullish", "bearish", "neutral"];

const FALLBACK_STYLE_IDS: ChartStyleId[] = ["classic", "smc", "elliott", "wyckoff"];

export function CopilotIntentControls({ api, sessionId, disabled }: CopilotIntentControlsProps) {
  const sessionIntent = useCopilotSessionStore((s) =>
    sessionId ? (s.sessionCache[sessionId]?.intent ?? null) : null,
  );
  const setSessionIntent = useCopilotSessionStore((s) => s.setSessionIntent);

  const [styles, setStyles] = useState<{ id: string; patterns: { id: string }[] }[]>([]);
  const [stylesError, setStylesError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.fetchStyles().then(
      (res) => {
        if (!cancelled) {
          setStyles(res.styles);
          setStylesError(false);
        }
      },
      () => {
        if (!cancelled) setStylesError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  const display = useMemo(() => displaySessionIntent(sessionIntent), [sessionIntent]);

  const styleOptions = useMemo(() => {
    if (styles.length > 0) {
      return styles.map((s) => ({
        id: s.id as ChartStyleId,
        label: labelForStyle(s.id),
      }));
    }
    return FALLBACK_STYLE_IDS.map((id) => ({ id, label: labelForStyle(id) }));
  }, [styles]);

  const patternOptions = useMemo(() => {
    const entry = styles.find((s) => s.id === display.style);
    return entry?.patterns ?? [];
  }, [styles, display.style]);

  const patternsAvailable = patternOptions.length > 0;

  const commitIntent = (next: AnalyzeIntent) => {
    if (!sessionId) return;
    const patternIds = patternOptions.map((p) => p.id);
    const sanitized = sanitizeIntentForStyle(next, patternIds);
    void setSessionIntent(sanitized);
  };

  return (
    <div className="flex flex-col gap-2 text-xs">
      {stylesError && (
        <p className="text-[#f6465d]" role="status">
          Không tải được danh sách phong cách từ máy chủ.
        </p>
      )}
      <label className="flex flex-col gap-1 text-[#848e9c]">
        <span>{COPILOT_STYLE_LABEL}</span>
        <select
          disabled={disabled || !sessionId}
          value={display.style}
          onChange={(e) => {
            const style = e.target.value as ChartStyleId;
            const entry = styles.find((s) => s.id === style);
            const patternIds = entry?.patterns.map((p) => p.id) ?? [];
            commitIntent(
              sanitizeIntentForStyle(
                { style, bias: display.bias, requested_pattern: display.requested_pattern },
                patternIds,
              ),
            );
          }}
          className="rounded border border-[#2b313a] bg-[#1e2329] px-2 py-1.5 text-[#eaecef] disabled:opacity-40"
        >
          {styleOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[#848e9c]">
        <span>{COPILOT_BIAS_LABEL}</span>
        <select
          disabled={disabled || !sessionId}
          value={display.bias ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            const bias = raw === "" ? undefined : (raw as ChartBias);
            commitIntent({ ...display, bias });
          }}
          className="rounded border border-[#2b313a] bg-[#1e2329] px-2 py-1.5 text-[#eaecef] disabled:opacity-40"
        >
          {BIAS_OPTIONS.map((bias) => (
            <option key={bias ?? "none"} value={bias ?? ""}>
              {bias ? labelForBias(bias) : COPILOT_BIAS_NONE}
            </option>
          ))}
        </select>
      </label>

      {patternsAvailable ? (
        <label className="flex flex-col gap-1 text-[#848e9c]">
          <span>{COPILOT_PATTERN_LABEL}</span>
          <select
            disabled={disabled || !sessionId}
            value={display.requested_pattern ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              commitIntent({
                ...display,
                requested_pattern: raw === "" ? undefined : raw,
              });
            }}
            className="rounded border border-[#2b313a] bg-[#1e2329] px-2 py-1.5 text-[#eaecef] disabled:opacity-40"
          >
            <option value="">{COPILOT_PATTERN_ANY}</option>
            {patternOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {labelForPattern(p.id)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-[#848e9c]" role="status">{COPILOT_STYLE_NO_PATTERNS}</p>
      )}
    </div>
  );
}
