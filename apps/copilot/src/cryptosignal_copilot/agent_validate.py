"""Output validation for id-based drawing intents."""

from __future__ import annotations

from pydantic_ai import Agent, ModelRetry

from cryptosignal_copilot.candidates import CandidateCatalog
from cryptosignal_copilot.drawing_intent import AnalyzeResultLlm, resolve_drawing_intents


def attach_drawing_intent_validator(agent: Agent, catalog: CandidateCatalog) -> None:
    @agent.output_validator
    def _validate_drawing_ids(_ctx: object, output: AnalyzeResultLlm) -> AnalyzeResultLlm:
        _, unknown = resolve_drawing_intents(output.drawing_intents, catalog)
        if unknown:
            nearest = catalog.nearest_ids(unknown[0], limit=2)
            valid = catalog.ids_for_style("classic")[:3] + catalog.ids_for_style("smc")[:3]
            raise ModelRetry(
                f"Unknown candidate_id(s): {unknown}. "
                f"Use only ids from the candidate sheet. "
                f"Examples: {valid[:4]}. Nearest: {nearest}."
            )
        return output
