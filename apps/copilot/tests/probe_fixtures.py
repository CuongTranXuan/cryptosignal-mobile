"""httpx MockTransport stubs for the live model probe (no network)."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx

from tests.omniroute_fixtures import omniroute_models_payload

ChatHandler = Callable[[str, dict[str, Any]], httpx.Response]


def completion_ok(model: str) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "OK"},
                    "finish_reason": "length",
                }
            ],
        },
    )


def stub_transport(
    *,
    models: list[dict[str, Any]] | None = None,
    chat: ChatHandler | None = None,
    models_error: Exception | httpx.Response | None = None,
    calls: dict[str, int] | None = None,
) -> httpx.MockTransport:
    """GET */models returns `models`; POST */chat/completions dispatches to `chat`."""
    rows = models if models is not None else omniroute_models_payload()
    counter = calls if calls is not None else {}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "GET" and path.endswith("/models"):
            counter["models"] = counter.get("models", 0) + 1
            if isinstance(models_error, Exception):
                raise models_error
            if isinstance(models_error, httpx.Response):
                return models_error
            return httpx.Response(200, json={"object": "list", "data": rows})
        if request.method == "POST" and path.endswith("/chat/completions"):
            counter["chat"] = counter.get("chat", 0) + 1
            body = json.loads(request.content or b"{}")
            model = str(body.get("model", ""))
            if chat is None:
                return completion_ok(model)
            return chat(model, body)
        return httpx.Response(404, json={"error": {"message": "no route"}})

    return httpx.MockTransport(handler)


def all_ok_transport() -> httpx.MockTransport:
    return stub_transport()
