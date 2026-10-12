"use client";

import { memo, useId, useMemo } from "react";
import type { CopilotModelRecord } from "../../lib/copilot-schema";
import { UI_CANDLE_PRESETS, recommendedMaxCandles } from "../../lib/copilot-model-limits";
import {
  COPILOT_CANDLE_COUNT_LABEL,
  COPILOT_CANDLE_CUSTOM,
  COPILOT_EFFECTIVE_CANDLES,
  COPILOT_EFFECTIVE_CANDLES_CLAMPED,
} from "../../lib/copilot-strings";
import type { AnalyzeMetaEvent } from "../../lib/copilot-schema";

type CopilotCandleControlProps = {
  value: number;
  customValue: number | null;
  selectedModel: CopilotModelRecord | null;
  lastMeta: AnalyzeMetaEvent | null;
  onPreset: (count: number) => void;
  onCustom: (count: number) => void;
  disabled?: boolean;
};

function effectiveCandlesLabel(meta: AnalyzeMetaEvent | null): string | null {
  if (!meta) return null;
  const template = meta.clamped ? COPILOT_EFFECTIVE_CANDLES_CLAMPED : COPILOT_EFFECTIVE_CANDLES;
  return template.replace("{count}", String(meta.candle_count_used));
}

function CopilotCandleControlInner({
  value,
  customValue,
  selectedModel,
  lastMeta,
  onPreset,
  onCustom,
  disabled,
}: CopilotCandleControlProps) {
  const safeMax = useMemo(() => recommendedMaxCandles(selectedModel), [selectedModel]);
  const inputId = useId();
  const effectiveLabel = effectiveCandlesLabel(lastMeta);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-[#848e9c]">
        {COPILOT_CANDLE_COUNT_LABEL}
        <span className="ml-1 font-[family-name:var(--font-plex-mono)] text-[#474d57]">
          (tối đa {safeMax})
        </span>
      </span>
      {effectiveLabel && (
        <span className="text-[10px] text-[#0ecb81]" role="status">
          {effectiveLabel}
        </span>
      )}
      <div className="flex flex-wrap gap-1" role="group" aria-label={COPILOT_CANDLE_COUNT_LABEL}>
        {UI_CANDLE_PRESETS.map((preset) => {
          const clamped = Math.min(preset, safeMax);
          const active = customValue === null && value === clamped;
          return (
            <button
              key={preset}
              type="button"
              disabled={disabled || clamped < preset}
              title={clamped < preset ? `Giới hạn mô hình: ${safeMax}` : undefined}
              onClick={() => onPreset(clamped)}
              className={`rounded border px-2 py-0.5 text-[11px] ${
                active
                  ? "border-[#f0b90b] text-[#f0b90b]"
                  : "border-[#2b313a] text-[#eaecef] hover:border-[#848e9c]"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {preset}
            </button>
          );
        })}
        <label className="flex items-center gap-1 text-[11px] text-[#848e9c]">
          <span>{COPILOT_CANDLE_CUSTOM}</span>
          <input
            id={inputId}
            type="number"
            min={1}
            max={safeMax}
            disabled={disabled}
            value={customValue ?? value}
            onChange={(e) => onCustom(Number(e.target.value))}
            className="w-16 rounded border border-[#2b313a] bg-[#1e2329] px-1 py-0.5 text-xs text-white outline-none focus:border-[#f0b90b]"
            aria-label={`${COPILOT_CANDLE_CUSTOM} ${COPILOT_CANDLE_COUNT_LABEL}`}
          />
        </label>
      </div>
    </div>
  );
}

export const CopilotCandleControl = memo(CopilotCandleControlInner);
