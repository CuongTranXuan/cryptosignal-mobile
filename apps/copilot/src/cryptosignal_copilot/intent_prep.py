from __future__ import annotations

from cryptosignal_copilot.chart_regime import bias_conflicts_regime, detect_regime
from cryptosignal_copilot.chart_response import IntentCheck
from cryptosignal_copilot.chart_styles import validate_pattern_for_style, validate_style
from cryptosignal_copilot.prep_errors import AnalyzePrepError
from cryptosignal_copilot.schema import AnalyzeIntent, AnalyzeRequest


def assert_valid_intent(intent: AnalyzeIntent) -> AnalyzeIntent:
    if not validate_style(intent.style):
        raise AnalyzePrepError(
            "invalid_intent_style",
            422,
            "Kiểu phân tích không hợp lệ",
            intent.style,
        )
    if intent.requested_pattern and not validate_pattern_for_style(
        intent.style, intent.requested_pattern
    ):
        raise AnalyzePrepError(
            "invalid_intent_pattern",
            422,
            "Mẫu hình không được hỗ trợ cho kiểu này",
            intent.requested_pattern,
        )
    return intent


def normalize_session_intent(value: object) -> AnalyzeIntent | None:
    """PATCH semantics: null clears; object validates with 422 on unknown ids."""
    if value is None:
        return None
    if isinstance(value, dict):
        value = AnalyzeIntent.model_validate(value)
    if not isinstance(value, AnalyzeIntent):
        raise AnalyzePrepError("invalid_intent", 422, "Intent không hợp lệ", str(type(value)))
    return assert_valid_intent(value)


def resolve_analyze_intent(
    request_intent: AnalyzeIntent | None,
    session_intent: AnalyzeIntent | None,
) -> AnalyzeIntent:
    if request_intent is not None:
        return assert_valid_intent(request_intent)
    if session_intent is not None:
        return assert_valid_intent(session_intent)
    return AnalyzeIntent()


def validate_analyze_intent(intent: AnalyzeIntent | None) -> AnalyzeIntent:
    return resolve_analyze_intent(intent, None)


def build_intent_check(request: AnalyzeRequest, intent: AnalyzeIntent) -> dict[str, object]:
    regime = detect_regime(request.closedCandles, request.interval)
    conflict = bias_conflicts_regime(intent.bias, regime)
    message: str | None = None
    if conflict:
        message = "Thiên kiến người dùng không khớp chế độ detector; lớp phủ theo chế độ detector."
    elif intent.style in ("elliott", "wyckoff"):
        message = (
            f"Style {intent.style} has no live v1 detectors; use classic/SMC candidates or "
            "no_valid_pattern when nothing fits."
        )
    check = IntentCheck(
        detected_regime=regime,
        bias_conflict=conflict,
        message=message,
    )
    return check.model_dump()
