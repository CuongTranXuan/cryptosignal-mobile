"""Provider HTTP error mapping for Copilot SSE failures."""

from pydantic_ai.exceptions import ModelHTTPError

from cryptosignal_copilot.provider_errors import (
    PROVIDER_CREDITS_EXHAUSTED_MSG,
    PROVIDER_UNAUTHORIZED_MSG,
    model_http_error_message,
    model_http_error_payload,
)


def test_model_http_error_402_maps_to_credits_exhausted():
    exc = ModelHTTPError(
        status_code=402,
        model_name="omniroute",
        body={"error": {"message": "Budget pool quota exhausted"}},
    )
    assert model_http_error_message(exc) == PROVIDER_CREDITS_EXHAUSTED_MSG


def test_model_http_error_payload_has_code():
    exc = ModelHTTPError(status_code=500, model_name="x", body={"message": "boom"})
    payload = model_http_error_payload(exc)
    assert payload["code"] == "provider_error"
    assert "message" in payload


def test_model_http_error_credits_exhausted_body_without_402():
    exc = ModelHTTPError(
        status_code=400,
        model_name="omniroute",
        body={"error": {"message": "credits exhausted"}},
    )
    assert model_http_error_message(exc) == PROVIDER_CREDITS_EXHAUSTED_MSG


def test_model_http_error_401_stays_unauthorized():
    exc = ModelHTTPError(
        status_code=401,
        model_name="omniroute",
        body={"error": {"message": "invalid api key"}},
    )
    msg = model_http_error_message(exc)
    assert msg.startswith(PROVIDER_UNAUTHORIZED_MSG)
    assert "invalid api key" in msg


def test_model_http_error_403_stays_unauthorized():
    exc = ModelHTTPError(
        status_code=403,
        model_name="omniroute",
        body={"error": {"message": "forbidden"}},
    )
    msg = model_http_error_message(exc)
    assert msg.startswith(PROVIDER_UNAUTHORIZED_MSG)
    assert "forbidden" in msg
