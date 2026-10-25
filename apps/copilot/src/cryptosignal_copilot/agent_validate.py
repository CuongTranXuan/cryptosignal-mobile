"""Output validation for id-based drawing intents."""

from __future__ import annotations

from pydantic_ai import Agent, ModelRetry

from cryptosignal_copilot.candidates import CandidateCatalog, patterns_for_style
from cryptosignal_copilot.drawing_intent import (
    MAX_DRAWING_INTENTS,
    AnalyzeResultLlm,
    resolve_drawing_intents,
)


def attach_drawing_intent_validator(
    agent: Agent,
    catalog: CandidateCatalog,
    *,
    style: str,
) -> None:
    allowed_patterns = patterns_for_style(style)
    example_ids = catalog.ids_for_style(style)[:3]

    @agent.output_validator  # type: ignore[arg-type]
    def _validate_drawing_ids(_ctx: object, output: AnalyzeResultLlm) -> AnalyzeResultLlm:
        if len(output.drawing_intents) > MAX_DRAWING_INTENTS:
            raise ModelRetry(
                f"At most {MAX_DRAWING_INTENTS} drawing_intents; got {len(output.drawing_intents)}."
            )
        _, unknown = resolve_drawing_intents(output.drawing_intents, catalog)
        if unknown:
            nearest = catalog.nearest_ids(unknown[0], limit=2)
            raise ModelRetry(
                f"Unknown candidate_id(s): {unknown}. "
                f"Use only ids from the candidate sheet. "
                f"Examples for style={style}: {example_ids}. Nearest: {nearest}."
            )
        seen: set[str] = set()
        by_id = catalog.by_id()
        for intent in output.drawing_intents:
            ids = (
                [intent.candidate_id] if intent.type == "candidate" else list(intent.candidate_ids)
            )
            for cid in ids:
                if cid in seen:
                    raise ModelRetry(f"Duplicate candidate_id {cid}; pick each id once.")
                seen.add(cid)
                cand = by_id.get(cid)
                if cand is None:
                    continue
                if cand.pattern_id not in allowed_patterns:
                    raise ModelRetry(
                        f"Candidate {cid} ({cand.pattern_id}) is not allowed for style={style}. "
                        f"Examples: {example_ids}."
                    )
        return output
