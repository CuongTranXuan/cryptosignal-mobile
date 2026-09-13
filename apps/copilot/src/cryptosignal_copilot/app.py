from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from cryptosignal_copilot.agent import AgentRunner, PydanticAiRunner
from cryptosignal_copilot.config import LlmConfigError, health_payload, load_llm_config
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

    lock = asyncio.Lock()
    latest_request: dict[str, AnalyzeRequest | None] = {"value": None}

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
        analyze_req = AnalyzeRequest.model_validate(body)
        latest_request["value"] = analyze_req

        async def event_stream() -> AsyncIterator[str]:
            async with lock:
                current = latest_request["value"] or analyze_req
                latest_request["value"] = None
                async for event_name, data in use_runner.run(current):
                    yield sse(event_name, data)

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    return app


app = create_app()
