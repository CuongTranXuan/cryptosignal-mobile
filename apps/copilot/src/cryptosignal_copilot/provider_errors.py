from __future__ import annotations

from typing import Any

from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError, UnexpectedModelBehavior

PROVIDER_UNAUTHORIZED_MSG = "Copilot thất bại: nhà cung cấp không được ủy quyền"
PROVIDER_CREDITS_EXHAUSTED_MSG = "Copilot thất bại: hết credits nhà cung cấp"
PROVIDER_RATE_LIMITED_MSG = "Copilot thất bại: nhà cung cấp bị giới hạn tốc độ"
PROVIDER_GENERIC_FAILURE_MSG = "Copilot thất bại"
EMPTY_MODEL_OUTPUT_MSG = (
    "Mô hình không trả lời — thử ít nến hơn hoặc chọn mô hình khác"
)

_CREDITS_EXHAUSTED_MARKERS = (
    "credits exhausted",
    "credit exhausted",
    "budget pool quota exhausted",
    "quota exhausted",
    "budget exhausted",
    "out of credits",
)


def error_payload(code: str, message: str, detail: str = "") -> dict[str, Any]:
    payload: dict[str, Any] = {"code": code, "message": message}
    if detail:
        payload["detail"] = detail
    return payload


def model_http_error_payload(exc: ModelHTTPError) -> dict[str, Any]:
    return error_payload("provider_error", model_http_error_message(exc), _provider_error_detail(exc))


def model_api_error_payload(exc: ModelAPIError) -> dict[str, Any]:
    detail = str(exc).strip()[:240]
    return error_payload("provider_error", PROVIDER_GENERIC_FAILURE_MSG, detail)


def unexpected_model_behavior_payload(exc: UnexpectedModelBehavior) -> dict[str, Any]:
    detail = str(exc).strip()[:240]
    return error_payload("empty_model_output", EMPTY_MODEL_OUTPUT_MSG, detail)


def model_http_error_message(exc: ModelHTTPError) -> str:
    detail = _provider_error_detail(exc)
    if exc.status_code in (401, 403):
        msg = PROVIDER_UNAUTHORIZED_MSG
        if detail:
            msg = f"{msg} ({detail})"
        return msg
    if _is_provider_credits_exhausted(exc, detail):
        return PROVIDER_CREDITS_EXHAUSTED_MSG
    if exc.status_code == 429:
        return PROVIDER_RATE_LIMITED_MSG
    if detail:
        return f"{PROVIDER_GENERIC_FAILURE_MSG} ({detail})"
    return PROVIDER_GENERIC_FAILURE_MSG


def _is_provider_credits_exhausted(exc: ModelHTTPError, detail: str) -> bool:
    if exc.status_code == 402:
        return True
    text = _provider_error_text(exc, detail)
    return any(marker in text for marker in _CREDITS_EXHAUSTED_MARKERS)


def _provider_error_text(exc: ModelHTTPError, detail: str) -> str:
    parts: list[str] = []
    if detail:
        parts.append(detail)
    try:
        body = getattr(exc, "body", None)
        if isinstance(body, dict):
            err = body.get("error")
            if isinstance(err, dict):
                for key in ("message", "code", "type"):
                    value = err.get(key)
                    if value:
                        parts.append(str(value))
            for key in ("message", "detail"):
                value = body.get(key)
                if value:
                    parts.append(str(value))
        elif isinstance(body, str) and body.strip():
            parts.append(body)
    except Exception:
        pass
    return " ".join(parts).lower()


def _provider_error_detail(exc: ModelHTTPError) -> str:
    try:
        body = getattr(exc, "body", None)
        if isinstance(body, dict):
            err = body.get("error")
            if isinstance(err, dict):
                msg = err.get("message") or err.get("code")
                if msg:
                    return str(msg)[:240]
            if body.get("message"):
                return str(body["message"])[:240]
        if isinstance(body, str) and body.strip():
            return body.strip()[:240]
    except Exception:
        pass
    try:
        msg = getattr(exc, "message", None) or str(exc)
        return str(msg)[:240]
    except Exception:
        return ""
