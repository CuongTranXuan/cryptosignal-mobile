from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from pydantic_ai.settings import ModelSettings

from cryptosignal_copilot.candidates import build_candidate_catalog
from cryptosignal_copilot.candle_budget import (
    clamp_candle_count,
    max_candles_for_context,
    previous_preset,
)
from cryptosignal_copilot.config import LlmConfig, load_default_candle_count
from cryptosignal_copilot.features import build_feature_sheet
from cryptosignal_copilot.intent_prep import build_intent_check, validate_analyze_intent
from cryptosignal_copilot.intent_step import candidate_id_list_for_prompt, rules_first_step
from cryptosignal_copilot.model_catalog import ModelNotFoundError, ModelsCatalog, NormalizedModel
from cryptosignal_copilot.model_routes import resolve_provider_model_id
from cryptosignal_copilot.prep_errors import AnalyzePrepError
from cryptosignal_copilot.run_settings import build_run_model_settings, lower_reasoning_effort
from cryptosignal_copilot.schema import AnalyzeRequest


@dataclass(frozen=True)
class AnalyzePlan:
    model_id: str
    model: NormalizedModel
    request: AnalyzeRequest
    meta: dict[str, Any]
    model_settings: ModelSettings
    reasoning_effort: str | None
    candle_count_requested: int | None
    candle_count_used: int
    candidate_catalog: Any = None
    intent_step: Any = None


def trim_request_candles(request: AnalyzeRequest, count: int) -> AnalyzeRequest:
    candles = (
        request.closedCandles[-count:]
        if count < len(request.closedCandles)
        else request.closedCandles
    )
    if not candles:
        return request.model_copy(update={"closedCandles": candles})
    from_time = min(c.time for c in candles)
    to_time = max(c.time for c in candles)
    return request.model_copy(
        update={
            "closedCandles": candles,
            "from_": from_time,
            "to": to_time,
        }
    )


def _over_budget(model: NormalizedModel, history_tokens: int = 0) -> bool:
    max_fit = max_candles_for_context(
        model.context_window,
        reserved_output=model.request_max_tokens,
        history_tokens=history_tokens,
    )
    return max_fit < 50


async def prepare_analyze(
    catalog: ModelsCatalog,
    cfg: LlmConfig,
    request: AnalyzeRequest,
    *,
    history_tokens: int = 0,
) -> AnalyzePlan:
    intent = validate_analyze_intent(request.intent)
    request = request.model_copy(update={"intent": intent}, deep=True)

    model_id = (request.model or cfg.model).strip()
    if not model_id:
        raise AnalyzePrepError("unknown_model", 400, "Mô hình không hợp lệ", "model is required")
    try:
        model = await catalog.resolve_model(cfg, model_id)
    except ModelNotFoundError:
        raise AnalyzePrepError(
            "unknown_model",
            400,
            "Mô hình không có trong danh sách nhà cung cấp",
            f"unknown model: {model_id}",
        ) from None

    if _over_budget(model, history_tokens):
        raise AnalyzePrepError(
            "over_budget",
            422,
            "Ngữ cảnh quá lớn — giảm số nến hoặc rút gọn lịch sử chat",
            "even 50 candles do not fit",
        )

    if request.reasoning_effort is not None:
        if not model.reasoning_efforts:
            raise AnalyzePrepError(
                "invalid_reasoning_effort",
                400,
                "Mô hình này không hỗ trợ reasoning effort",
                request.reasoning_effort,
            )
        if request.reasoning_effort not in model.reasoning_efforts:
            raise AnalyzePrepError(
                "invalid_reasoning_effort",
                400,
                "Giá trị reasoning effort không được hỗ trợ",
                request.reasoning_effort,
            )

    available = len(request.closedCandles)
    default_candles = load_default_candle_count()
    used, clamped = clamp_candle_count(
        request.candle_count,
        available=available,
        recommended=default_candles,
        recommended_max=model.recommended_max_candles,
    )
    trimmed = trim_request_candles(request, used)
    candidate_catalog = build_candidate_catalog(
        trimmed.closedCandles,
        symbol=trimmed.symbol,
        interval=trimmed.interval,
    )
    step = rules_first_step(trimmed, candidate_catalog, intent)
    feature_sheet = build_feature_sheet(
        trimmed.closedCandles, trimmed.interval, zigzag=candidate_catalog.zigzag
    )
    from cryptosignal_copilot.prompt_context import estimate_prompt_candle_chars

    legacy_chars = estimate_prompt_candle_chars(trimmed, compact=False)
    compact_chars = len(
        json.dumps(feature_sheet, separators=(",", ":"))
    ) + estimate_prompt_candle_chars(trimmed, compact=True)
    settings, effort = build_run_model_settings(
        model,
        reasoning_effort=request.reasoning_effort,
    )
    meta = {
        "model": model_id,
        "provider_model_id": resolve_provider_model_id(model, effort),
        "candle_count_requested": request.candle_count,
        "candle_count_used": used,
        "clamped": clamped,
        "max_tokens": settings.get("max_tokens"),
        "reasoning_effort": effort,
        "retried": False,
        "intent": intent.model_dump(),
        "intent_check": build_intent_check(request, intent),
        "intent_source": step.intent_source,
        "feature_sheet": feature_sheet,
        "candidates": candidate_id_list_for_prompt(candidate_catalog, intent),
        "prompt_candle_chars_legacy": legacy_chars,
        "prompt_candle_chars_compact": compact_chars,
        "prompt_candle_reduction_pct": round((1 - compact_chars / legacy_chars) * 100, 1)
        if legacy_chars
        else 0.0,
    }
    return AnalyzePlan(
        model_id=model_id,
        model=model,
        request=trimmed,
        meta=meta,
        model_settings=settings,
        reasoning_effort=effort,
        candle_count_requested=request.candle_count,
        candle_count_used=used,
        candidate_catalog=candidate_catalog,
        intent_step=step,
    )


def retry_plan(plan: AnalyzePlan) -> AnalyzePlan | None:
    prev = previous_preset(plan.candle_count_used)
    if prev >= plan.candle_count_used:
        return None
    trimmed = trim_request_candles(plan.request, prev)
    effort = lower_reasoning_effort(plan.reasoning_effort, plan.model)
    settings, resolved_effort = build_run_model_settings(plan.model, reasoning_effort=effort)
    meta = dict(plan.meta)
    meta.update(
        {
            "candle_count_used": prev,
            "clamped": True,
            "max_tokens": settings.get("max_tokens"),
            "reasoning_effort": resolved_effort,
            "retried": True,
        }
    )
    return AnalyzePlan(
        model_id=plan.model_id,
        model=plan.model,
        request=trimmed,
        meta=meta,
        model_settings=settings,
        reasoning_effort=resolved_effort,
        candle_count_requested=plan.candle_count_requested,
        candle_count_used=prev,
    )
