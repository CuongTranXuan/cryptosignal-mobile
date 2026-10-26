"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CopilotApiClient } from "../../lib/copilot-api";
import { groupModelsByProvider, isAdvancedRouteModel } from "../../lib/copilot-schema";
import { formatModelLimitsLine } from "../../lib/copilot-model-limits";
import {
  COPILOT_MODEL_ADVANCED,
  COPILOT_MODEL_LIMITS_PREFIX,
  COPILOT_MODEL_PICKER_LABEL,
  COPILOT_MODEL_PICKER_PLACEHOLDER,
  COPILOT_MODEL_SEARCH,
  COPILOT_NO_MODELS_SHORT,
} from "../../lib/copilot-strings";
import { modelLabelForSession } from "../../lib/copilot-model-defaults";
import { useCopilotModels } from "./use-copilot-models";

type CopilotModelPickerProps = {
  api: CopilotApiClient;
  selectedModelId: string | null;
  onSelect: (modelId: string) => void;
  disabled?: boolean;
};

function CopilotModelPickerInner({
  api,
  selectedModelId,
  onSelect,
  disabled,
}: CopilotModelPickerProps) {
  const { models, loading, defaultModelId, response } = useCopilotModels(api);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerId = useId();
  const listId = `${triggerId}-list`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((m) => {
      if (!showAdvanced && isAdvancedRouteModel(m)) return false;
      if (!q) return true;
      return (
        m.id.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
      );
    });
  }, [models, query, showAdvanced]);

  const groups = useMemo(() => groupModelsByProvider(filtered), [filtered]);
  const flat = useMemo(() => groups.flatMap((g) => g.models), [groups]);

  const selectedLabel = useMemo(() => {
    if (response && models.length === 0) return COPILOT_NO_MODELS_SHORT;
    if (!selectedModelId && models.length === 0) return COPILOT_MODEL_PICKER_PLACEHOLDER;
    return modelLabelForSession(models, selectedModelId, defaultModelId);
  }, [models, selectedModelId, defaultModelId, response]);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (listRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, close]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
      setActiveIndex(0);
      return;
    }
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter" && flat[activeIndex]) {
      e.preventDefault();
      onSelect(flat[activeIndex]!.id);
      close();
    }
  };

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({
      block: "nearest",
    });
  }, [activeIndex, open]);

  let optionOffset = 0;

  return (
    <div className="relative w-64 min-w-0">
      <label className="sr-only" htmlFor={triggerId}>
        {COPILOT_MODEL_PICKER_LABEL}
      </label>
      <button
        ref={buttonRef}
        id={triggerId}
        type="button"
        disabled={disabled || loading || models.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className="flex w-full items-center justify-between gap-2 rounded border border-[#2b313a] bg-[#1e2329] px-2 py-1.5 text-left text-xs text-white outline-none focus:border-[#f0b90b] disabled:opacity-40"
      >
        <span className="truncate">{selectedLabel}</span>
        <span className="text-[#848e9c]" aria-hidden>▾</span>
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 z-50 mt-1 rounded border border-[#2b313a] bg-[#1e2329] shadow-lg"
          role="presentation"
        >
          <div className="border-b border-[#2b313a] p-2">
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              placeholder={COPILOT_MODEL_SEARCH}
              className="w-full rounded border border-[#2b313a] bg-[#14161a] px-2 py-1 text-xs text-white outline-none focus:border-[#f0b90b]"
              aria-label={COPILOT_MODEL_SEARCH}
            />
            <button
              type="button"
              className="mt-1 text-[10px] text-[#848e9c] hover:text-[#f0b90b]"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {COPILOT_MODEL_ADVANCED}: {showAdvanced ? "ẩn" : "hiện"} mô hình tổ hợp/tự chọn
            </button>
          </div>
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={COPILOT_MODEL_PICKER_LABEL}
            className="max-h-56 overflow-y-auto py-1"
          >
            {groups.map((group) => (
              <li key={group.id} role="presentation">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#848e9c]">
                  {group.label}
                </div>
                <ul role="group" aria-label={group.label}>
                  {group.models.map((model) => {
                    const idx = optionOffset;
                    optionOffset += 1;
                    const selected = model.id === selectedModelId;
                    const active = idx === activeIndex;
                    return (
                      <li key={model.id} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          data-index={idx}
                          className={`flex w-full flex-col items-start px-2 py-1.5 text-left text-xs ${
                            active ? "bg-[#2b313a]" : "hover:bg-[#2b313a]/60"
                          } ${selected ? "text-[#f0b90b]" : "text-[#eaecef]"}`}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => {
                            onSelect(model.id);
                            close();
                          }}
                        >
                          <span>{model.label}</span>
                          <span className="text-[10px] text-[#848e9c]">
                            {COPILOT_MODEL_LIMITS_PREFIX}: {formatModelLimitsLine(model)}
                            {model.latency_ms != null && ` · ${Math.round(model.latency_ms)} ms`}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export const CopilotModelPicker = memo(CopilotModelPickerInner);
