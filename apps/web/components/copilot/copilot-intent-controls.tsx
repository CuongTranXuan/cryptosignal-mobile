"use client";

import { useEffect, useMemo, useState } from "react";
import type { CopilotApiClient } from "../../lib/copilot-api";
import { MOCK_STYLES_RESPONSE } from "../../lib/copilot-api";
import {
  labelForBias,
  labelForPattern,
  labelForStyle,
} from "../../lib/copilot-chart-ai";
import { getIntentForSession, setIntentForSession } from "../../lib/copilot-intent-cache";
import type { AnalyzeIntent, ChartBias, ChartStyleId } from "../../lib/copilot-schema";
import {
  COPILOT_BIAS_LABEL,
  COPILOT_BIAS_NONE,
  COPILOT_PATTERN_ANY,
  COPILOT_PATTERN_LABEL,
  COPILOT_STYLE_LABEL,
} from "../../lib/copilot-strings";

type CopilotIntentControlsProps = {
  api: CopilotApiClient;
  sessionId: string | null;
  disabled?: boolean;
};

const BIAS_OPTIONS: (ChartBias | null)[] = [null, "bullish", "bearish", "neutral"];

export function CopilotIntentControls({ api, sessionId, disabled }: CopilotIntentControlsProps) {
  const [intent, setIntent] = useState<AnalyzeIntent>(() => getIntentForSession(sessionId));
  const [styles, setStyles] = useState(MOCK_STYLES_RESPONSE.styles);

  useEffect(() => {
    setIntent(getIntentForSession(sessionId));
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    void api.fetchStyles().then((res) => {
      if (!cancelled && res.styles.length > 0) setStyles(res.styles);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const styleOptions = useMemo(() => {
    const ids = styles.map((s) => s.id as ChartStyleId);
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      return (["classic", "smc", "elliott", "wyckoff"] as ChartStyleId[]).map((id) => ({
        id,
        label: labelForStyle(id),
      }));
    }
    return unique.map((id) => ({ id, label: labelForStyle(id) }));
  }, [styles]);

  const patternOptions = useMemo(() => {
    const entry = styles.find((s) => s.id === intent.style);
    return entry?.patterns ?? [];
  }, [styles, intent.style]);

  const commitIntent = (next: AnalyzeIntent) => {
    setIntent(next);
    if (sessionId) setIntentForSession(sessionId, next);
  };

  return (
    <div className="flex flex-col gap-2 text-xs">
      <label className="flex flex-col gap-1 text-[#848e9c]">
        <span>{COPILOT_STYLE_LABEL}</span>
        <select
          disabled={disabled}
          value={intent.style}
          onChange={(e) => {
            const style = e.target.value as ChartStyleId;
            commitIntent({ style, bias: intent.bias, requested_pattern: undefined });
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
          disabled={disabled}
          value={intent.bias ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            const bias = raw === "" ? undefined : (raw as ChartBias);
            commitIntent({ ...intent, bias });
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

      <label className="flex flex-col gap-1 text-[#848e9c]">
        <span>{COPILOT_PATTERN_LABEL}</span>
        <select
          disabled={disabled}
          value={intent.requested_pattern ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            commitIntent({
              ...intent,
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
    </div>
  );
}
