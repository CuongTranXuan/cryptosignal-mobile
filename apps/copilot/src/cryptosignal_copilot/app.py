from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from cryptosignal_copilot.agent import AgentRunner, PydanticAiRunner
from cryptosignal_copilot.analyze_prep import AnalyzePrepError, prepare_analyze
from cryptosignal_copilot.config import (
    LlmConfigError,
    health_payload,
    load_llm_config,
    validate_llm_env_on_startup,
)
from cryptosignal_copilot.db.migrate import run_db_migrations
from cryptosignal_copilot.logging_setup import configure_logging
from cryptosignal_copilot.model_catalog import ModelsCatalog, get_models_catalog
from cryptosignal_copilot.provider_errors import error_payload
from cryptosignal_copilot.rate_limit import SlidingWindowRateLimiter, client_ip
from cryptosignal_copilot.schema import AnalyzeRequest, CreateSessionRequest, UpdateSessionRequest
from cryptosignal_copilot.sessions_store import (
    SessionNotFoundError,
    SessionsStore,
    get_sessions_store,
)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _cors_settings() -> tuple[list[str], bool]:
    raw = os.environ.get("CORS_ORIGINS")
    if raw is None:
        raw = os.environ.get(
            "COPILOT_CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000",
        )
    if raw.strip() == "*":
        return ["*"], False
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    return origins, True


def create_app(
    runner: AgentRunner | None = None,
    *,
    models_catalog: ModelsCatalog | None = None,
    sessions_store: SessionsStore | None = None,
) -> FastAPI:
    use_runner: AgentRunner = runner if runner is not None else PydanticAiRunner()
    app = FastAPI()
    cors_origins, cors_credentials = _cors_settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=cors_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    rate_limiter = SlidingWindowRateLimiter()
    catalog = models_catalog if models_catalog is not None else get_models_catalog()
    store = sessions_store if sessions_store is not None else get_sessions_store()

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

    @app.get("/v1/copilot/models")
    async def list_models(q: str | None = Query(default=None)):
        try:
            cfg = load_llm_config()
        except LlmConfigError:
            return JSONResponse(
                error_payload("models_unavailable", "Cấu hình LLM chưa sẵn sàng"),
                status_code=503,
            )
        try:
            snapshot = await catalog.get_snapshot(cfg)
        except Exception:
            stale = catalog.stale_snapshot()
            if stale is not None:
                snapshot = stale
            else:
                return JSONResponse(
                    error_payload("models_unavailable", "Không lấy được danh sách mô hình"),
                    status_code=503,
                )
        models = list(snapshot.models)
        if q:
            needle = q.strip().lower()
            if needle:
                models = [m for m in models if needle in m.id.lower() or needle in m.label.lower()]
        body = snapshot.to_api_dict()
        body["models"] = [m.to_api_dict() for m in models]
        return body

    @app.get("/v1/copilot/sessions")
    async def list_sessions():
        summaries = await asyncio.to_thread(store.list_sessions)
        return {"sessions": [s.model_dump() for s in summaries]}

    @app.post("/v1/copilot/sessions")
    async def create_session(body: CreateSessionRequest):
        record = await asyncio.to_thread(
            store.create_session,
            title=body.title,
            model_id=body.model_id,
            chart=body.chart,
            messages=body.messages,
            reasoning_effort=body.reasoning_effort,
        )
        return record.model_dump(by_alias=True)

    @app.get("/v1/copilot/sessions/{session_id}")
    async def get_session(session_id: str):
        try:
            record = await asyncio.to_thread(store.get_session, session_id)
        except SessionNotFoundError:
            return JSONResponse({"error": "session not found"}, status_code=404)
        return record.model_dump(by_alias=True)

    @app.patch("/v1/copilot/sessions/{session_id}")
    async def patch_session(session_id: str, body: UpdateSessionRequest):
        try:
            patch = body.model_dump(exclude_unset=True, by_alias=True)
            record = await asyncio.to_thread(store.update_session, session_id, **patch)
        except SessionNotFoundError:
            return JSONResponse({"error": "session not found"}, status_code=404)
        return record.model_dump(by_alias=True)

    @app.delete("/v1/copilot/sessions/{session_id}")
    async def delete_session(session_id: str):
        try:
            await asyncio.to_thread(store.delete_session, session_id)
        except SessionNotFoundError:
            return JSONResponse({"error": "session not found"}, status_code=404)
        return {"ok": True}

    @app.post("/v1/copilot/analyze")
    async def analyze(request: Request):
        ip = client_ip(dict(request.headers), request.client.host if request.client else None)
        if not rate_limiter.allow(ip):
            return JSONResponse(
                {"error": "rate limit exceeded"},
                status_code=429,
                headers={"Retry-After": "60"},
            )

        try:
            cfg = load_llm_config()
        except LlmConfigError:
            return JSONResponse({"error": "LLM config missing"}, status_code=503)

        body = await request.json()
        try:
            analyze_req = AnalyzeRequest.model_validate(body)
        except ValidationError as exc:
            return JSONResponse({"detail": exc.errors()}, status_code=422)

        try:
            await prepare_analyze(catalog, cfg, analyze_req)
        except AnalyzePrepError as exc:
            return JSONResponse(
                error_payload(exc.code, exc.message, exc.detail),
                status_code=exc.status_code,
            )

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

                    try:
                        run_plan = await prepare_analyze(catalog, cfg, current)
                    except AnalyzePrepError as exc:
                        yield sse("error", error_payload(exc.code, exc.message, exc.detail))
                        yield sse("done", {})
                        continue

                    yield sse("meta", run_plan.meta)

                    queue: asyncio.Queue[tuple[str, str | None, dict | BaseException | None]] = (
                        asyncio.Queue()
                    )

                    async def _produce(
                        run_plan=run_plan,
                        q: asyncio.Queue[
                            tuple[str, str | None, dict | BaseException | None]
                        ] = queue,
                    ) -> None:
                        try:
                            async for event_name, data in use_runner.run(run_plan):
                                await q.put(("event", event_name, data))
                        except BaseException as exc:  # noqa: BLE001
                            await q.put(("error", None, exc))
                        finally:
                            await q.put(("end", None, None))

                    task = asyncio.create_task(_produce())
                    try:
                        while True:
                            try:
                                kind, name, payload = await asyncio.wait_for(
                                    queue.get(), timeout=12.0
                                )
                            except TimeoutError:
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


configure_logging()
validate_llm_env_on_startup()
run_db_migrations()
app = create_app()
