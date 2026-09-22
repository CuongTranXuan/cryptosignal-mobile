"""Provider HTTP error mapping for Copilot SSE failures."""

from pydantic_ai.exceptions import ModelHTTPError

from cryptosignal_copilot.agent import (
    PROVIDER_CREDITS_EXHAUSTED_MSG,
    PROVIDER_UNAUTHORIZED_MSG,
    _model_http_error_message,
)


def test_model_http_error_402_maps_to_credits_exhausted():
    exc = ModelHTTPError(
        status_code=402,
        model_name="omniroute",
        body={"error": {"message": "Budget pool quota exhausted"}},
    )
    assert _model_http_error_message(exc) == PROVIDER_CREDITS_EXHAUSTED_MSG


def test_model_http_error_credits_exhausted_body_without_402():
    exc = ModelHTTPError(
        status_code=400,
        model_name="omniroute",
        body={"error": {"message": "credits exhausted"}},
    )
    assert _model_http_error_message(exc) == PROVIDER_CREDITS_EXHAUSTED_MSG


def test_model_http_error_401_stays_unauthorized():
    exc = ModelHTTPError(
        status_code=401,
        model_name="omniroute",
        body={"error": {"message": "invalid api key"}},
    )
    msg = _model_http_error_message(exc)
    assert msg.startswith(PROVIDER_UNAUTHORIZED_MSG)
    assert "invalid api key" in msg


def test_model_http_error_403_stays_unauthorized():
    exc = ModelHTTPError(
        status_code=403,
        model_name="omniroute",
        body={"error": {"message": "forbidden"}},
    )
    msg = _model_http_error_message(exc)
    assert msg.startswith(PROVIDER_UNAUTHORIZED_MSG)
    assert "forbidden" in msg
