from __future__ import annotations

import os
import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from cryptosignal_copilot.agent import AgentRunner, PydanticAiRunner
from cryptosignal_copilot.config import LlmConfigError, health_payload, load_llm_config, validate_llm_env_on_startup
from cryptosignal_copilot.schema import AnalyzeRequest


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def create_app(runner: AgentRunner | None = None) -> FastAPI:
    use_runner: AgentRunner = runner if runner is not None else PydanticAiRunner()
    app = FastAPI()
    # Same-origin via Next rewrite is preferred. Extra origins (comma-separated) or "*" for ngrok.
    raw = os.environ.get("COPILOT_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    if raw.strip() == "*":
        cors_origins = ["*"]
        cors_credentials = False
    else:
        cors_origins = [o.strip() for o in raw.split(",") if o.strip()]
        cors_credentials = True
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=cors_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    state_lock = asyncio.Lock()
    latest_request: dict[str, AnalyzeRequest | None] = {"value": None}
    is_draining = {"value": False}
    drain_done = asyncio.Event()
    drain_done.set()

    @app.get("/v1/copilot/health")
    async def health():
        try:
            cfg = load_llm_config()
        except LlmConfigError:
            return JSONResponse({"error": "LLM config missing"}, status_code=503)
        return health_payload(cfg)

    @app.post("/v1/copilot/analyze")
    async def analyze(request: Request):
        try:
            load_llm_config()
        except LlmConfigError:
            return JSONResponse({"error": "LLM config missing"}, status_code=503)

        body = await request.json()
        try:
            analyze_req = AnalyzeRequest.model_validate(body)
        except ValidationError as exc:
            return JSONResponse({"detail": exc.errors()}, status_code=422)

        async def event_stream() -> AsyncIterator[str]:
            async with state_lock:
                latest_request["value"] = analyze_req
                if is_draining["value"]:
                    is_waiter = True
                else:
                    is_draining["value"] = True
                    drain_done.clear()
                    is_waiter = False

            if is_waiter:
                await drain_done.wait()
                yield sse("done", {"note": "superseded"})
                return

            try:
                while True:
                    async with state_lock:
                        current = latest_request["value"]
                        if current is None:
                            is_draining["value"] = False
                            drain_done.set()
                            break
                        latest_request["value"] = None

                    queue: asyncio.Queue[tuple[str, str | None, dict | BaseException | None]] = asyncio.Queue()

                    async def _produce(req: AnalyzeRequest = current) -> None:
                        try:
                            async for event_name, data in use_runner.run(req):
                                await queue.put(("event", event_name, data))
                        except BaseException as exc:  # noqa: BLE001 — forward to consumer
                            await queue.put(("error", None, exc))
                        finally:
                            await queue.put(("end", None, None))

                    task = asyncio.create_task(_produce())
                    try:
                        while True:
                            try:
                                kind, name, payload = await asyncio.wait_for(queue.get(), timeout=12.0)
                            except asyncio.TimeoutError:
                                # SSE comment keepalive — keeps Next/ngrok from killing idle streams
                                yield ": keepalive\n\n"
                                continue
                            if kind == "end":
                                break
                            if kind == "error":
                                assert isinstance(payload, BaseException)
                                raise payload
                            assert isinstance(name, str) and isinstance(payload, dict)
                            yield sse(name, payload)
                    finally:
                        if not task.done():
                            task.cancel()
                            try:
                                await task
                            except (asyncio.CancelledError, Exception):
                                pass
            except Exception:
                async with state_lock:
                    latest_request["value"] = None
                    is_draining["value"] = False
                    drain_done.set()
                raise

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return app


validate_llm_env_on_startup()
app = create_app()
