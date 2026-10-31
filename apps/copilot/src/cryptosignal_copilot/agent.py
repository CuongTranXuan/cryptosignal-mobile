from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from dataclasses import replace
from typing import Protocol

from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError, UnexpectedModelBehavior

from cryptosignal_copilot.agent_output import build_agent_output_type, output_retries_for_model
from cryptosignal_copilot.agent_validate import attach_drawing_intent_validator
from cryptosignal_copilot.analysis_events import build_analysis_event, build_regime_event
from cryptosignal_copilot.analyze_prep import AnalyzePlan, retry_plan
from cryptosignal_copilot.candidates import DrawingCandidate
from cryptosignal_copilot.chart_response import (
    SkipReasonCode,
    aggregate_skipped,
    enrich_shapes_with_guardrails,
)
from cryptosignal_copilot.config import load_llm_config
from cryptosignal_copilot.drawing_gate import (
    MAX_SHAPES,
    DrawingWindow,
    bar_seconds,
    effective_project_bars,
    format_drop_note,
)
from cryptosignal_copilot.drawing_intent import (
    AnalyzeResultLlm,
    build_deterministic_fallback,
    enrich_resolved_shapes,
    resolve_drawing_intents,
    total_shape_cost,
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
from cryptosignal_copilot.server_summary import compose_stream_summary
from cryptosignal_copilot.vi_text import EV_NO_CATALOG, display_name_vi, evidence_items, regime_vi
from cryptosignal_copilot.wire_marker import markers_for_wire
from cryptosignal_copilot.wire_shape import ai_shape_flags, shapes_for_wire

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
    "JSON field names stay English. No tools; no invented OHLC or times. "
    "Return `drawing_intents` (candidate ids from the sheet) and optional `pick_assessments`: "
    "{candidate_id, quality: strong|ok|weak, confluence: [htf_level|fib|volume|liquidity|ema|"
    "order_block|structure], touch_ack: bool}. No free-text notes; server renders Vietnamese. "
    "Hard limits: Max 6 drawing_intents and total shape_cost across picks <= 6 "
    "(use shape_cost on each candidate row). "
    "Do not emit markers or raw PatternShape geometry — ids only."
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

        intent_check = (plan.meta or {}).get("intent_check") or {}
        if catalog is not None:
            yield (
                "regime",
                build_regime_event(
                    catalog,
                    intent_check,
                    htf=(plan.meta or {}).get("htf"),
                ),
            )

        if step is not None and catalog is not None and not step.use_llm:
            summary = (
                f"Phát hiện {request.symbol} {request.interval}: "
                f"chế độ {regime_vi(str(catalog.regime))}, chọn mẫu theo quy tắc "
                "(không gọi mô hình AI)."
            )
            yield "text", {"delta": summary + "\n\n"}
            raw_shapes = list(step.rule_shapes)
        else:
            raw_shapes = None

        current_plan = plan
        llm_output: AnalyzeResultLlm | None = None
        stream_summary_direction: str | None = None
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
                intent_style = (request.intent.style if request.intent else "classic") or "classic"
                attempt_catalog = current_plan.candidate_catalog
                if attempt_catalog is not None:
                    attach_drawing_intent_validator(agent, attempt_catalog, style=intent_style)
                run_settings = strip_thinking_when_routed(
                    current_plan.model,
                    current_plan.reasoning_effort,
                    dict(current_plan.model_settings),
                )
                try:
                    result = await agent.run(prompt, model_settings=run_settings)
                    llm_output = result.output
                    catalog = current_plan.candidate_catalog or catalog
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
                            intent_check = (current_plan.meta or {}).get("intent_check") or {}
                            if catalog is not None:
                                yield (
                                    "regime",
                                    build_regime_event(
                                        catalog,
                                        intent_check,
                                        htf=(current_plan.meta or {}).get("htf"),
                                    ),
                                )
                            continue
                    fallback_catalog = current_plan.candidate_catalog or catalog
                    if fallback_catalog is not None:
                        style = (request.intent.style if request.intent else "classic") or "classic"
                        llm_output = build_deterministic_fallback(
                            fallback_catalog,
                            style,
                        )
                        meta = dict(current_plan.meta or {})
                        meta["validator_fallback"] = True
                        current_plan = replace(current_plan, meta=meta)
                        catalog = fallback_catalog
                        break
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

            if catalog is not None and llm_output is not None:
                total_cost, _costs = total_shape_cost(llm_output.drawing_intents, catalog)
                if total_cost > MAX_SHAPES:
                    style = (request.intent.style if request.intent else "classic") or "classic"
                    llm_output = build_deterministic_fallback(catalog, style)
                    meta = dict(current_plan.meta or {})
                    meta["intent_budget_fallback"] = True
                    current_plan = replace(current_plan, meta=meta)

            if catalog is not None and llm_output is not None:
                last_close = (
                    float(request.closedCandles[-1].close) if request.closedCandles else None
                )
                raw_shapes, _ = resolve_drawing_intents(llm_output.drawing_intents, catalog)
                raw_shapes = enrich_resolved_shapes(raw_shapes, catalog, last_close=last_close)
                intent_check_pre = (current_plan.meta or {}).get("intent_check") or {}
                by_id = catalog.by_id()
                picked_pre: list[DrawingCandidate] = []
                for intent in llm_output.drawing_intents:
                    if intent.type == "candidate":
                        cand = by_id.get(intent.candidate_id)
                        if cand is not None:
                            picked_pre.append(cand)
                    else:
                        for cid in intent.candidate_ids:
                            cand = by_id.get(cid)
                            if cand is not None:
                                picked_pre.append(cand)
                stream_text, stream_summary_direction = compose_stream_summary(
                    catalog,
                    llm_output,
                    symbol=request.symbol,
                    interval=request.interval,
                    intent_check=intent_check_pre,
                    shapes=raw_shapes,
                    picked=picked_pre,
                )
            else:
                raw_shapes = []
                stream_text = None

            yield "text", {"delta": "Mô hình đã xong. Đang dựng lớp phủ…"}
            if stream_text:
                yield "text", {"delta": "\n\n" + stream_text}

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
        regime = str(
            (catalog.regime if catalog is not None else None)
            or intent_check.get("detected_regime")
            or "range"
        )
        valid_shapes, drawing_anchors = enrich_shapes_with_guardrails(
            valid_shapes,
            regime=regime,
            symbol=request.symbol,
            interval=request.interval,
        )
        extra_skips: list[SkipReasonCode] = []
        validator_fallback = bool((current_plan.meta or {}).get("validator_fallback"))
        budget_fallback_only = bool((current_plan.meta or {}).get("intent_budget_fallback")) and (
            not validator_fallback
        )
        if budget_fallback_only:
            extra_skips.append("cap")
        requested = (request.intent.requested_pattern if request.intent else None) or None
        if requested and not any(
            requested.replace("_", " ") in str(s.get("name", "")).lower()
            or requested in str(s.get("name", "")).lower()
            for s in valid_shapes
        ):
            extra_skips.append("unsupported_pattern")
        skipped, skipped_count = aggregate_skipped(dropped, extra=extra_skips or None)
        if budget_fallback_only:
            yield (
                "text",
                {
                    "delta": (
                        "\n\nĐã áp dụng lớp phủ dự phòng (tối đa 6 hình); "
                        "các lựa chọn của mô hình vượt giới hạn đã được thay thế.\n"
                    )
                },
            )

        wire_shapes = [ai_shape_flags(s) for s in shapes_for_wire(valid_shapes)]
        yield (
            "shapes",
            {
                "shapes": wire_shapes,
                # Vietnamese display name per shape id; `name` stays the canonical id.
                "labels": {s["id"]: display_name_vi(str(s.get("name", ""))) for s in wire_shapes},
                "dropped": [{"id": shape_id, "reason": reason} for shape_id, reason in dropped],
                "skipped": skipped,
                "skipped_count": skipped_count,
            },
        )
        picked: list[DrawingCandidate] = []
        if catalog is not None and llm_output is not None:
            by_id = catalog.by_id()
            for intent in llm_output.drawing_intents:
                if intent.type == "candidate":
                    cand = by_id.get(intent.candidate_id)
                    if cand is not None:
                        picked.append(cand)
                else:
                    for cid in intent.candidate_ids:
                        cand = by_id.get(cid)
                        if cand is not None:
                            picked.append(cand)
        analysis_payload = (
            build_analysis_event(
                catalog,
                valid_shapes,
                intent_check,
                picked=picked if catalog is not None else None,
                symbol=request.symbol,
            )
            if catalog is not None
            else {
                "bias": "neutral",
                "no_valid_pattern": len(wire_shapes) == 0,
                "evidence_for": [EV_NO_CATALOG],
                "evidence_against": [EV_NO_CATALOG],
                "evidence_for_items": evidence_items([EV_NO_CATALOG]),
                "evidence_against_items": evidence_items([EV_NO_CATALOG]),
                "invalidation": None,
                "confidence": 0.5,
                "intent_check": intent_check,
            }
        )
        if stream_summary_direction is not None:
            analysis_payload["summary_direction"] = stream_summary_direction
        yield "analysis", analysis_payload
        if valid_shapes:
            names = ", ".join(display_name_vi(str(s.get("name", "?"))) for s in valid_shapes[:5])
            more = f" (+{len(valid_shapes) - 5} nữa)" if len(valid_shapes) > 5 else ""
            yield "text", {"delta": f"\n\nLớp phủ sẵn sàng: {len(valid_shapes)} — {names}{more}."}

        if drawing_anchors:
            valid_markers, dropped_marker_ids = filter_agent_markers(drawing_anchors, allowed_times)
            if dropped_marker_ids:
                yield (
                    "text",
                    {"delta": f"\n\nĐã bỏ qua {len(dropped_marker_ids)} điểm neo không hợp lệ."},
                )
            if valid_markers:
                yield "markers", {"markers": markers_for_wire(valid_markers)}

        final_meta = dict(current_plan.meta or {})
        if final_meta.get("validator_fallback") or final_meta.get("intent_budget_fallback"):
            yield "meta", final_meta

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
            "(pick_assessments[], drawing_intents[]). "
            "You may wrap it in ```json fences. No tool calls.\n"
        )
    return (
        f"{json_hint}"
        f"Symbol={request.symbol} interval={request.interval}\n"
        f"WINDOW from={request.from_} to={request.to} ({n} closed candles in store; "
        f"recent tail + feature sheet below).\n"
        f"{_projection_note(request)}\n"
        f"Context JSON: {json.dumps(ctx, separators=(',', ':'))}\n"
        f"User prompt (read last): {request.prompt}"
    )
