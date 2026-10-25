from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Protocol

from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError, UnexpectedModelBehavior

from cryptosignal_copilot.agent_output import build_agent_output_type, output_retries_for_model
from cryptosignal_copilot.agent_validate import attach_drawing_intent_validator
from cryptosignal_copilot.analyze_prep import AnalyzePlan, retry_plan
from cryptosignal_copilot.chart_response import aggregate_skipped, enrich_shapes_with_guardrails
from cryptosignal_copilot.config import load_llm_config
from cryptosignal_copilot.drawing_gate import (
    DrawingWindow,
    bar_seconds,
    effective_project_bars,
    format_drop_note,
)
from cryptosignal_copilot.drawing_intent import (
    AnalyzeResultLlm,
    enrich_resolved_shapes,
    resolve_drawing_intents,
)
from cryptosignal_copilot.env_parse import env_flag
from cryptosignal_copilot.model_factory import build_model
from cryptosignal_copilot.model_negative_cache import get_model_negative_cache
from cryptosignal_copilot.model_routes import resolve_provider_model_id, strip_thinking_when_routed
from cryptosignal_copilot.prompt_context import build_prompt_context
from cryptosignal_copilot.provider_errors import (
    EMPTY_MODEL_OUTPUT_MSG,
    error_payload,
    model_api_error_payload,
    model_http_error_payload,
    unexpected_model_behavior_payload,
)
from cryptosignal_copilot.schema import (
    AnalyzeRequest,
    filter_agent_markers,
    filter_preview_details,
)

# LANGUAGE: require Vietnamese for `summary` and chat-facing text the user sees.
# System scaffolding stays English. Heavy Vietnamese scaffolding here plus full-VI
# user prompts has tripped OmniRoute agentrouter HTTP 400 content-blocked
# (observed 2026-09-19 on VI quick-actions like "Tìm tam giác cân…").
# Client quick-action prompts may still be Vietnamese; keep window annotations in
# English to reduce content-block risk. SSE progress/errors are Vietnamese for the UI.
#
# OmniRoute 2026-09-19: openai→claude translation of pydantic-ai @agent.tool_plain
# get_klines arrives as tools[0].type=custom; agentrouter then 400s with unknown
# variant `custom` (expected web_search_*). Keep tools:[] — analyze with closedCandles only.
INSTRUCTIONS = (
    "You are a crypto chart assistant. Use ONLY closed candles and the server-built "
    "feature sheet + candidate ids (geometry is precomputed). "
    "LANGUAGE: Vietnamese for `summary` unless the user asks for English. "
    "JSON field names stay English. No tools; no invented OHLC or times. "
    "Return `summary` (friendly multi-paragraph chat) plus `drawing_intents`: "
    "each item is {type:'candidate', candidate_id} referencing ids from the sheet "
    "(or type:'pair' with two ids for a channel/triangle). Max 6 resolved shapes. "
    "Optional `markers` for point signals (AgentMarker schema). "
    "Do not emit raw PatternShape geometry — ids only. "
    "Do not promise entries, stops, or that levels will hold."
)

logger = logging.getLogger(__name__)


class AgentRunner(Protocol):
    def run(self, plan: AnalyzePlan) -> AsyncIterator[tuple[str, dict]]: ...


class PydanticAiRunner:
    async def run(self, plan: AnalyzePlan) -> AsyncIterator[tuple[str, dict]]:
        cfg = load_llm_config()
        request = plan.request
        # OmniRoute/agentrouter rejects OpenAI tool_choice="required" (pydantic-ai's
        # default ToolOutput mode). PromptedOutput uses response_format=json_object
        # with tool_choice=auto, which works through the gateway.
        # No @agent.tool_plain tools: OmniRoute 2026-09-19 rejects custom-tool variant
        # (get_klines → type=custom → agentrouter 400). Requests must send tools:[].

        step = plan.intent_step
        catalog = plan.candidate_catalog
        prompt = _build_user_prompt(
            request,
            plan=plan,
            structured_output_mode=plan.model.structured_output_mode,
        )
        yield (
            "text",
            {
                "delta": (
                    f"Đang phân tích {request.symbol} {request.interval} "
                    f"({len(request.closedCandles)} nến đã đóng)…\n\n"
                )
            },
        )

        if step is not None and catalog is not None and not step.use_llm:
            summary = (
                f"Phát hiện {request.symbol} {request.interval}: "
                f"chế độ {catalog.regime}, chọn mẫu theo quy tắc (không gọi LLM)."
            )
            yield "text", {"delta": summary + "\n\n"}
            raw_shapes = list(step.rule_shapes)
            output_markers: list[dict] = []
        else:
            raw_shapes = None
            output_markers = None

        current_plan = plan
        llm_output: AnalyzeResultLlm | None = None
        if raw_shapes is None:
            for attempt in range(2):
                provider_model_id = resolve_provider_model_id(
                    current_plan.model,
                    current_plan.reasoning_effort,
                    cfg=cfg,
                )
                model = build_model(cfg, provider_model_id)
                output_type = build_agent_output_type(current_plan.model)
                agent = Agent(
                    model,
                    output_type=output_type,
                    instructions=INSTRUCTIONS,
                    retries={"output": output_retries_for_model(current_plan.model)},
                )
                if catalog is not None:
                    attach_drawing_intent_validator(agent, catalog)
                run_settings = strip_thinking_when_routed(
                    current_plan.model,
                    current_plan.reasoning_effort,
                    dict(current_plan.model_settings),
                )
                try:
                    result = await agent.run(prompt, model_settings=run_settings)
                    llm_output = result.output
                    break
                except UnexpectedModelBehavior as exc:
                    if attempt == 0:
                        next_plan = retry_plan(current_plan)
                        if next_plan is not None:
                            current_plan = next_plan
                            request = current_plan.request
                            catalog = current_plan.candidate_catalog
                            prompt = _build_user_prompt(
                                request,
                                plan=current_plan,
                                structured_output_mode=current_plan.model.structured_output_mode,
                            )
                            yield "meta", current_plan.meta
                            continue
                    yield "error", unexpected_model_behavior_payload(exc)
                    yield "done", {}
                    return
                except ModelAPIError as exc:
                    yield "error", model_api_error_payload(exc)
                    yield "done", {}
                    return
                except ModelHTTPError as exc:
                    status = getattr(exc, "status_code", None)
                    if status in {402, 502}:
                        cache = get_model_negative_cache()
                        cache.mark(provider_model_id)
                        cache.mark(current_plan.model.id)
                    yield "error", model_http_error_payload(exc)
                    yield "done", {}
                    return
                except Exception as exc:
                    logger.exception("copilot agent run failed")
                    detail = "unexpected agent failure"
                    if env_flag("COPILOT_EXPOSE_ERROR_DETAIL"):
                        detail = f"{type(exc).__name__}: {exc}"[:500]
                    yield (
                        "error",
                        error_payload(
                            "internal_error",
                            "Lỗi nội bộ máy chủ Copilot",
                            detail,
                        ),
                    )
                    yield "done", {}
                    return
            else:
                yield "error", error_payload("empty_model_output", EMPTY_MODEL_OUTPUT_MSG)
                yield "done", {}
                return

            yield "text", {"delta": "Mô hình đã xong. Đang dựng lớp phủ…"}
            if llm_output and llm_output.summary:
                yield "text", {"delta": "\n\n" + llm_output.summary}
            if catalog is not None and llm_output is not None:
                raw_shapes, _ = resolve_drawing_intents(llm_output.drawing_intents, catalog)
                raw_shapes = enrich_resolved_shapes(raw_shapes, catalog)
                output_markers = list(llm_output.markers)
            else:
                raw_shapes = []
                output_markers = []

        allowed_times = {c.time for c in request.closedCandles}
        window = DrawingWindow(
            candles=request.closedCandles,
            interval=request.interval,
            window_start=request.from_,
            allowed_times=allowed_times,
        )
        valid_shapes, dropped = filter_preview_details(
            raw_shapes or [],
            allowed_times,
            symbol=request.symbol,
            interval=request.interval,
            window=window,
        )

        if dropped:
            yield "text", {"delta": format_drop_note(dropped)}

        intent_check = (current_plan.meta or {}).get("intent_check") or {}
        regime = str(intent_check.get("detected_regime") or "range")
        valid_shapes, drawing_anchors = enrich_shapes_with_guardrails(
            valid_shapes,
            regime=regime,
            symbol=request.symbol,
            interval=request.interval,
        )
        skipped, skipped_count = aggregate_skipped(dropped)
        requested = (request.intent.requested_pattern if request.intent else None) or None
        if requested and not any(
            requested.replace("_", " ") in str(s.get("name", "")).lower()
            or requested in str(s.get("name", "")).lower()
            for s in valid_shapes
        ):
            skipped, skipped_count = aggregate_skipped(dropped, extra=["unsupported_pattern"])

        yield (
            "shapes",
            {
                "shapes": valid_shapes,
                "dropped": [{"id": shape_id, "reason": reason} for shape_id, reason in dropped],
                "skipped": skipped,
                "skipped_count": skipped_count,
            },
        )
        if valid_shapes:
            names = ", ".join(str(s.get("name", "?")) for s in valid_shapes[:5])
            more = f" (+{len(valid_shapes) - 5} nữa)" if len(valid_shapes) > 5 else ""
            yield "text", {"delta": f"\n\nLớp phủ sẵn sàng: {len(valid_shapes)} — {names}{more}."}

        merged_markers = list(output_markers or []) + drawing_anchors
        if merged_markers:
            valid_markers, dropped_marker_ids = filter_agent_markers(merged_markers, allowed_times)
            if dropped_marker_ids:
                yield (
                    "text",
                    {"delta": f"\n\nĐã bỏ qua {len(dropped_marker_ids)} marker không hợp lệ."},
                )
            yield "markers", {"markers": valid_markers}

        yield "done", {}


def _projection_note(request: AnalyzeRequest) -> str:
    # English on purpose: Vietnamese window scaffolding has tripped agentrouter content-block.
    if not request.closedCandles:
        return "PROJECTION GRID: no closed candles; do not emit shapes."
    last = max(candle.time for candle in request.closedCandles)
    bar = bar_seconds(request.interval)
    kmax = effective_project_bars(request.interval)
    return (
        "PROJECTION GRID: "
        f"lastClosedCandleTime={last} barSeconds={bar} maxProjectBars={kmax}. "
        "Historical anchors MUST be exact closed-candle unix seconds. "
        "At most one forward endpoint per shape, and only as the later point, "
        f"at lastClosedCandleTime + k*barSeconds for an integer k with 1<=k<={kmax}. "
        "That point is geometry, not a candle. "
        f"Do not emit any time before {request.from_}. "
        "k caps are a hard ceiling. "
        "Triangle rails whose names contain upper and lower: keep the forward endpoint "
        "at or before their intersection time plus 3*barSeconds (apex+3). "
        "The server computes that apex and drops later rays. Do not add an apexTime field. "
        "Prefer emitting the future endpoint so the overlay can paint it. "
        "Each rail's defining swings must be >= 8 bars apart, and each triangle rail "
        "must span >= 15 bars. A flat top only a few bars wide is dropped as min-span; "
        "use an earlier equal high if that is what makes the rail wide enough."
    )


def estimate_prompt_candle_chars(request: AnalyzeRequest, *, compact: bool) -> int:
    from cryptosignal_copilot.prompt_context import estimate_prompt_candle_chars as _est

    return _est(request, compact=compact)


def _build_user_prompt(
    request: AnalyzeRequest,
    *,
    plan: AnalyzePlan,
    structured_output_mode: str = "prompted",
) -> str:
    meta = plan.meta or {}
    feature_sheet = meta.get("feature_sheet") or {}
    candidates = meta.get("candidates") or []
    style_slice = ""
    if plan.intent_step is not None:
        style_slice = plan.intent_step.prompt_slice
    ctx = build_prompt_context(
        request,
        feature_sheet=feature_sheet,
        candidates=candidates,
        style_slice=style_slice,
    )
    n = len(request.closedCandles)
    json_hint = ""
    if structured_output_mode == "text_json":
        json_hint = (
            "OUTPUT: Reply with one JSON object for AnalyzeResultLlm "
            "(summary, drawing_intents[], markers[]). "
            "You may wrap it in ```json fences. No tool calls.\n"
        )
    return (
        f"{json_hint}"
        f"Symbol={request.symbol} interval={request.interval}\n"
        f"WINDOW from={request.from_} to={request.to} ({n} closed candles in store; "
        f"recent tail + feature sheet below).\n"
        f"{_projection_note(request)}\n"
        f"User prompt: {request.prompt}\n"
        f"Context JSON: {json.dumps(ctx, separators=(',', ':'))}"
    )
