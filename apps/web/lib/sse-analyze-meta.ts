import type { AnalyzeMetaEvent } from "./copilot-schema";

/** Merge analyze `meta` SSE payloads in arrival order; later top-level fields win. */
export function mergeAnalyzeMeta(
  prior: AnalyzeMetaEvent | null,
  incoming: AnalyzeMetaEvent,
): AnalyzeMetaEvent {
  if (!prior) return { ...incoming };
  return {
    ...prior,
    ...incoming,
    intent: incoming.intent ?? prior.intent,
    intent_check: incoming.intent_check ?? prior.intent_check,
    htf: incoming.htf !== undefined ? incoming.htf : prior.htf,
    validator_fallback:
      incoming.validator_fallback !== undefined
        ? incoming.validator_fallback
        : prior.validator_fallback,
    intent_budget_fallback:
      incoming.intent_budget_fallback !== undefined
        ? incoming.intent_budget_fallback
        : prior.intent_budget_fallback,
  };
}
