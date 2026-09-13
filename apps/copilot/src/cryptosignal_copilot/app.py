from __future__ import annotations

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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=True,
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
                    async for event_name, data in use_runner.run(current):
                        yield sse(event_name, data)
            except Exception:
                async with state_lock:
                    latest_request["value"] = None
                    is_draining["value"] = False
                    drain_done.set()
                raise

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    return app


validate_llm_env_on_startup()
app = create_app()
