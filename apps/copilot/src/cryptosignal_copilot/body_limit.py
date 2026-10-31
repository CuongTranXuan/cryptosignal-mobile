"""Raw request body cap for `/v1/copilot/*` (413 `request_too_large`).

Checked from `Content-Length` when present, else while reading a chunked body, before
any route parses JSON. `COPILOT_MAX_BODY_BYTES` (default 1.5 MiB).
"""

from __future__ import annotations

import json
import os

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from cryptosignal_copilot.provider_errors import error_payload
from cryptosignal_copilot.vi_text import ERR_REQUEST_TOO_LARGE

DEFAULT_MAX_BODY_BYTES = 1536 * 1024
_PREFIX = "/v1/copilot"


def max_body_bytes_from_env() -> int:
    raw = os.environ.get("COPILOT_MAX_BODY_BYTES", "").strip()
    return int(raw) if raw else DEFAULT_MAX_BODY_BYTES


def too_large_body(limit: int) -> bytes:
    body = {
        **error_payload("request_too_large", ERR_REQUEST_TOO_LARGE),
        "field": "body_bytes",
        "limit": limit,
    }
    return json.dumps(body, ensure_ascii=False).encode()


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def _reject(self, send: Send) -> None:
        body = too_large_body(self.max_bytes)
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] in ("GET", "HEAD", "OPTIONS", "DELETE")
            or not scope.get("path", "").startswith(_PREFIX)
        ):
            await self.app(scope, receive, send)
            return
        for name, value in scope.get("headers", []):
            if name == b"content-length" and value.isdigit() and int(value) > self.max_bytes:
                await self._reject(send)
                return
        # Buffer the body (it is capped) so an oversized chunked body is refused up front.
        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                return  # client went away
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.max_bytes:
                await self._reject(send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        replay: list[Message] = [{"type": "http.request", "body": b"".join(chunks)}]
        await self.app(scope, _replay(replay, receive), send)


def _replay(messages: list[Message], then: Receive) -> Receive:
    async def receive() -> Message:
        if messages:
            return messages.pop(0)
        return await then()

    return receive
