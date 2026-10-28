from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from functools import partial
from typing import Any

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from cryptosignal_copilot.agent import AgentRunner, PydanticAiRunner
from cryptosignal_copilot.analyze_prep import AnalyzePrepError, prepare_analyze
from cryptosignal_copilot.autoscan.scheduler import AutoScanScheduler, scheduler_from_env
from cryptosignal_copilot.chart_autosave import AnalyzeRecorder
from cryptosignal_copilot.chart_state import (
    ChartKeyError,
    ChartStateNotFoundError,
    ChartStatePut,
    ChartStateStore,
    ChartStateTooLargeError,
    RevisionConflictError,
    check_limits,
    normalize_key,
    validation_detail,
)
from cryptosignal_copilot.chart_styles import list_styles_payload
from cryptosignal_copilot.config import (
    LlmConfigError,
    health_payload,
    is_production,
    load_llm_config,
    validate_llm_env_on_startup,
)
from cryptosignal_copilot.db.migrate import run_db_migrations
from cryptosignal_copilot.device import (
    DeviceMiddleware,
    DeviceSettings,
    device_settings_from_env,
    request_owner,
)
from cryptosignal_copilot.feedback_store import FeedbackStore, get_feedback_store
from cryptosignal_copilot.intent_prep import normalize_session_intent, resolve_analyze_intent
from cryptosignal_copilot.logging_setup import configure_logging
from cryptosignal_copilot.model_catalog import ModelsCatalog, get_models_catalog
from cryptosignal_copilot.model_probe import (
    ModelProbeService,
    ProbeRateLimited,
)
from cryptosignal_copilot.provider_errors import error_payload
from cryptosignal_copilot.rate_limit import SlidingWindowRateLimiter, client_ip
from cryptosignal_copilot.schema import (
    AnalyzeRequest,
    CreateSessionRequest,
    FeedbackAction,
    UpdateSessionRequest,
)
from cryptosignal_copilot.sessions_store import (
    SessionNotFoundError,
    SessionsStore,
    get_sessions_store,
)
from cryptosignal_copilot.symbol_tick import get_tick_cache, prefetch_tick_size


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


DEV_CORS_ORIGINS = (
    "http://localhost:3100,http://127.0.0.1:3100,http://localhost:3000,http://127.0.0.1:3000"
)


class CorsConfigError(RuntimeError):
    pass


def cors_settings() -> tuple[list[str], bool]:
    """`CORS_ORIGINS` (legacy `COPILOT_CORS_ORIGINS`). Production behind nginx is
    same-origin, so its default is no cross-origin access, and `*` is refused there."""
    raw = os.environ.get("CORS_ORIGINS")
    if raw is None:
        raw = os.environ.get("COPILOT_CORS_ORIGINS")
    if raw is None:
        raw = "" if is_production() else DEV_CORS_ORIGINS
    if raw.strip() == "*":
        if is_production():
            raise CorsConfigError("CORS_ORIGINS=* is not allowed with COPILOT_ENV=production")
        return ["*"], False
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    return origins, True


@dataclass
class _Drain:
    """One device's analyze coalescing: only its latest request runs after the current one."""

    latest: AnalyzeRequest | None = None
    draining: bool = False
    done: asyncio.Event = field(default_factory=asyncio.Event)


def create_app(
    runner: AgentRunner | None = None,
    *,
    models_catalog: ModelsCatalog | None = None,
    sessions_store: SessionsStore | None = None,
    feedback_store: FeedbackStore | None = None,
    model_probe: ModelProbeService | None = None,
    chart_store: ChartStateStore | None = None,
    autoscan: AutoScanScheduler | None = None,
    device: DeviceSettings | None = None,
) -> FastAPI:
    use_runner: AgentRunner = runner if runner is not None else PydanticAiRunner()
    catalog = models_catalog if models_catalog is not None else get_models_catalog()
    probe = model_probe if model_probe is not None else ModelProbeService(catalog)
    scheduler = autoscan if autoscan is not None else scheduler_from_env()
    device_settings = device if device is not None else device_settings_from_env()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        # Slim tick cache: one small local file read; refreshes happen per symbol later.
        get_tick_cache().load()
        # Warm the probe cache in the background; never block startup on the upstream.
        try:
            cfg = load_llm_config()
        except LlmConfigError:
            cfg = None
        if cfg is not None and cfg.style == "openai" and probe.settings.enabled:
            probe.start_background(cfg)
        scheduler.start()
        try:
            yield
        finally:
            await scheduler.stop()

    app = FastAPI(lifespan=lifespan)
    app.state.autoscan = scheduler
    cors_origins, cors_credentials = cors_settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=cors_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # Added last = outermost: every /v1/copilot response can carry the device cookie.
    app.add_middleware(DeviceMiddleware, settings=device_settings)

    rate_limiter = SlidingWindowRateLimiter()
    store = sessions_store if sessions_store is not None else get_sessions_store()
    feedback = feedback_store if feedback_store is not None else get_feedback_store()
    # Same database as the sessions (chart_states.session_id references copilot_sessions).
    charts = (
        chart_store if chart_store is not None else ChartStateStore(database_url=store.database_url)
    )

    state_lock = asyncio.Lock()
    # Keyed by device ("" = unscoped), so one device never supersedes another's run.
    drains: dict[str, _Drain] = {}

    # `/health` is the bare liveness/readiness alias (same body and codes) for probes and
    # humans hitting the API port directly; every other route lives under /v1/copilot.
    @app.get("/health")
    @app.get("/v1/copilot/health")
    async def health():
        try:
            cfg = load_llm_config()
        except LlmConfigError:
            return JSONResponse({"error": "LLM config missing"}, status_code=503)
        return health_payload(cfg)

    def _probe_applies(style: str) -> bool:
        return style == "openai" and probe.settings.enabled

    def _rate_limited_response(exc: ProbeRateLimited) -> JSONResponse:
        body = error_payload("probe_rate_limited", "Vui lòng đợi trước khi kiểm tra lại mô hình")
        body["retry_after_s"] = exc.retry_after_s
        return JSONResponse(body, status_code=429, headers={"Retry-After": str(exc.retry_after_s)})

    async def _unprobed_models_body(cfg, q: str | None):
        """Probe disabled (env or non-OpenAI style): previous catalog behaviour + new fields."""
        try:
            snapshot = await catalog.get_snapshot(cfg)
        except Exception:
            stale = catalog.stale_snapshot()
            if stale is None:
                return JSONResponse(
                    error_payload("models_unavailable", "Không lấy được danh sách mô hình"),
                    status_code=503,
                )
            snapshot = stale
        models = list(snapshot.models)
        if q and q.strip():
            needle = q.strip().lower()
            models = [m for m in models if needle in m.id.lower() or needle in m.label.lower()]
        body = snapshot.to_api_dict()
        body["models"] = [
            {**m.to_api_dict(), "latency_ms": None, "status": "unverified"} for m in models
        ]
        body.update(
            {
                "requested_default": snapshot.default_model,
                "default_fallback": False,
                "probed_at": None,
                "ttl_s": int(probe.settings.ttl_s),
                "stale": False,
                "probe_in_progress": False,
                "upstream_reachable": True,
                "upstream_error": None,
            }
        )
        return body

    @app.get("/v1/copilot/models")
    async def list_models(
        q: str | None = Query(default=None),
        refresh: bool = Query(default=False),
    ):
        try:
            cfg = load_llm_config()
        except LlmConfigError as exc:
            return probe.models_body(probe.config_missing_report(str(exc)), q=q)
        if not _probe_applies(cfg.style):
            return await _unprobed_models_body(cfg, q)
        try:
            report = await probe.get_report(cfg, force=refresh, wait=False)
        except ProbeRateLimited as exc:
            return _rate_limited_response(exc)
        return probe.models_body(report, q=q)

    async def _probe_report(force: bool, *, wait: bool):
        try:
            cfg = load_llm_config()
        except LlmConfigError as exc:
            return probe.report_body(probe.config_missing_report(str(exc)))
        if not _probe_applies(cfg.style):
            return JSONResponse(
                error_payload(
                    "probe_disabled",
                    "Kiểm tra mô hình đang tắt",
                    "COPILOT_MODEL_PROBE_ENABLED=false or LLM_API_STYLE is not openai",
                ),
                status_code=409,
            )
        try:
            report = await probe.get_report(cfg, force=force, wait=wait)
        except ProbeRateLimited as exc:
            return _rate_limited_response(exc)
        return probe.report_body(report)

    @app.get("/v1/copilot/models/probe")
    async def get_models_probe():
        return await _probe_report(force=False, wait=False)

    @app.post("/v1/copilot/models/probe")
    async def post_models_probe():
        return await _probe_report(force=True, wait=True)

    @app.get("/v1/copilot/styles")
    async def list_styles():
        return list_styles_payload()

    @app.post("/v1/copilot/feedback")
    async def post_feedback(body: FeedbackAction):
        try:
            row_id = await asyncio.to_thread(feedback.create, body)
        except Exception as exc:
            return JSONResponse(
                error_payload("feedback_failed", "Không lưu được phản hồi", str(exc)),
                status_code=500,
            )
        return JSONResponse({"id": row_id}, status_code=201)

    @app.get("/v1/copilot/feedback/export")
    async def export_feedback(limit: int = Query(default=5000, ge=1, le=20000)):
        rows = await asyncio.to_thread(feedback.export_rows, limit)
        return {"rows": rows}

    @app.get("/v1/copilot/sessions")
    async def list_sessions(request: Request):
        summaries = await asyncio.to_thread(store.list_sessions, owner=request_owner(request.state))
        return {"sessions": [s.model_dump() for s in summaries]}

    @app.post("/v1/copilot/sessions")
    async def create_session(body: CreateSessionRequest, request: Request):
        try:
            intent = normalize_session_intent(body.intent) if body.intent is not None else None
            record = await asyncio.to_thread(
                store.create_session,
                title=body.title,
                model_id=body.model_id,
                chart=body.chart,
                messages=body.messages,
                reasoning_effort=body.reasoning_effort,
                intent=intent,
                owner=request_owner(request.state),
            )
        except AnalyzePrepError as exc:
            return JSONResponse(
                exc.payload(),
                status_code=exc.status_code,
            )
        return record.model_dump(by_alias=True)

    @app.get("/v1/copilot/sessions/{session_id}")
    async def get_session(session_id: str, request: Request):
        try:
            record = await asyncio.to_thread(
                store.get_session, session_id, owner=request_owner(request.state)
            )
        except SessionNotFoundError:
            return JSONResponse({"error": "session not found"}, status_code=404)
        return record.model_dump(by_alias=True)

    @app.patch("/v1/copilot/sessions/{session_id}")
    async def patch_session(session_id: str, body: UpdateSessionRequest, request: Request):
        try:
            patch = body.model_dump(exclude_unset=True, by_alias=True)
            if "intent" in patch:
                patch["intent"] = normalize_session_intent(patch["intent"])
            record = await asyncio.to_thread(
                partial(store.update_session, session_id, owner=request_owner(request.state)),
                **patch,
            )
        except AnalyzePrepError as exc:
            return JSONResponse(
                exc.payload(),
                status_code=exc.status_code,
            )
        except SessionNotFoundError:
            return JSONResponse({"error": "session not found"}, status_code=404)
        return record.model_dump(by_alias=True)

    @app.delete("/v1/copilot/sessions/{session_id}")
    async def delete_session(session_id: str, request: Request):
        try:
            await asyncio.to_thread(
                store.delete_session, session_id, owner=request_owner(request.state)
            )
        except SessionNotFoundError:
            return JSONResponse({"error": "session not found"}, status_code=404)
        return {"ok": True}

    # ------------------------------------------------------------ chart history

    def _session_missing() -> JSONResponse:
        return JSONResponse({"error": "session not found"}, status_code=404)

    def _chart_missing() -> JSONResponse:
        return JSONResponse(
            error_payload("chart_state_not_found", "Chưa có lịch sử cho biểu đồ này"),
            status_code=404,
        )

    def _too_large(exc: ChartStateTooLargeError) -> JSONResponse:
        body = error_payload("chart_state_too_large", "Lịch sử biểu đồ vượt giới hạn lưu")
        return JSONResponse({**body, "limit": exc.limit}, status_code=413)

    def _invalid(code: str, message: str, detail: object = None) -> JSONResponse:
        body: dict[str, object] = error_payload(code, message)
        if detail is not None:
            body["detail"] = detail
        return JSONResponse(body, status_code=422)

    async def _chart_call(symbol: str, interval: str, fn: Callable[[str, str], Any]) -> Any:
        """Run `fn(symbol, interval)` off-thread with the shared key checks and error map."""
        try:
            sym, ivl = normalize_key(symbol, interval)
        except ChartKeyError as exc:
            return _invalid(exc.code, "Mã hoặc khung thời gian không hợp lệ", str(exc))
        try:
            return await asyncio.to_thread(fn, sym, ivl)
        except SessionNotFoundError:
            return _session_missing()
        except ChartStateNotFoundError:
            return _chart_missing()
        except RevisionConflictError as exc:
            body = error_payload("revision_conflict", "Biểu đồ đã được lưu ở nơi khác")
            return JSONResponse({**body, "current": exc.current}, status_code=409)
        except ChartStateTooLargeError as exc:
            return _too_large(exc)

    @app.get("/v1/copilot/sessions/{session_id}/charts")
    async def list_charts(session_id: str, request: Request):
        try:
            entries = await asyncio.to_thread(
                charts.list_charts, session_id, owner=request_owner(request.state)
            )
        except SessionNotFoundError:
            return _session_missing()
        return {"charts": entries}

    @app.get("/v1/copilot/sessions/{session_id}/charts/{symbol}/{interval}")
    async def get_chart(session_id: str, symbol: str, interval: str, request: Request):
        owner = request_owner(request.state)
        return await _chart_call(
            symbol, interval, partial(charts.get_chart, session_id, owner=owner)
        )

    @app.delete("/v1/copilot/sessions/{session_id}/charts/{symbol}/{interval}")
    async def delete_chart(session_id: str, symbol: str, interval: str, request: Request):
        owner = request_owner(request.state)
        result = await _chart_call(
            symbol, interval, partial(charts.delete_chart, session_id, owner=owner)
        )
        return result if isinstance(result, JSONResponse) else {"ok": True}

    @app.put("/v1/copilot/sessions/{session_id}/charts/{symbol}/{interval}")
    async def put_chart(session_id: str, symbol: str, interval: str, request: Request):
        try:
            sym, ivl = normalize_key(symbol, interval)
        except ChartKeyError as exc:
            return _invalid(exc.code, "Mã hoặc khung thời gian không hợp lệ", str(exc))
        try:
            raw = await request.json()
        except ValueError:
            return _invalid(
                "invalid_chart_state", "Dữ liệu biểu đồ không hợp lệ", "body is not JSON"
            )
        if not isinstance(raw, dict) or not isinstance(raw.get("shapes"), list):
            return _invalid(
                "invalid_chart_state", "Dữ liệu biểu đồ không hợp lệ", "shapes[] required"
            )
        markers = raw.get("markers")
        analysis = raw.get("analysis")
        try:
            # Size limits first, so an oversized doc is a 413 rather than a 422 per item.
            check_limits(
                raw["shapes"],
                markers if isinstance(markers, list) else None,
                analysis if isinstance(analysis, dict) else None,
            )
        except ChartStateTooLargeError as exc:
            return _too_large(exc)
        try:
            body = ChartStatePut.model_validate(raw)
        except ValidationError as exc:
            return _invalid(
                "invalid_chart_state", "Dữ liệu biểu đồ không hợp lệ", validation_detail(exc)
            )
        keyed = [(s.id, s.symbol, s.interval) for s in body.shapes]
        keyed += [(m.id, m.symbol, m.interval) for m in body.markers or []]
        stray = [item_id for item_id, s, i in keyed if s.upper() != sym or i != ivl]
        if stray:
            return _invalid(
                "chart_key_mismatch",
                "Hình vẽ không thuộc biểu đồ này",
                {"ids": stray[:20], "symbol": sym, "interval": ivl},
            )
        owner = request_owner(request.state)
        return await _chart_call(
            sym, ivl, lambda s, i: charts.put_chart(session_id, s, i, body, owner=owner)
        )

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
        prefetch_tick_size(analyze_req.symbol)
        owner = request_owner(request.state)

        try:
            session_intent = None
            if analyze_req.session_id:
                try:
                    session_record = await asyncio.to_thread(
                        store.get_session, analyze_req.session_id, owner=owner
                    )
                except SessionNotFoundError:
                    return JSONResponse({"error": "session not found"}, status_code=404)
                session_intent = session_record.intent
            merged_intent = resolve_analyze_intent(analyze_req.intent, session_intent)
            analyze_req = analyze_req.model_copy(update={"intent": merged_intent}, deep=True)
        except AnalyzePrepError as exc:
            return JSONResponse(
                exc.payload(),
                status_code=exc.status_code,
            )

        try:
            await prepare_analyze(catalog, cfg, analyze_req, model_health=probe.model_health())
        except AnalyzePrepError as exc:
            return JSONResponse(
                exc.payload(),
                status_code=exc.status_code,
            )

        async def event_stream() -> AsyncIterator[str]:
            key = owner or ""
            async with state_lock:
                drain = drains.setdefault(key, _Drain())
                drain.latest = analyze_req
                if drain.draining:
                    is_waiter = True
                else:
                    drain.draining = True
                    drain.done.clear()
                    is_waiter = False

            def _finish() -> None:
                drain.latest = None
                drain.draining = False
                drain.done.set()
                if drains.get(key) is drain:
                    del drains[key]

            if is_waiter:
                await drain.done.wait()
                yield sse("done", {"note": "superseded"})
                return

            try:
                while True:
                    async with state_lock:
                        current = drain.latest
                        if current is None:
                            _finish()
                            break
                        drain.latest = None

                    try:
                        run_plan = await prepare_analyze(
                            catalog, cfg, current, model_health=probe.model_health()
                        )
                    except AnalyzePrepError as exc:
                        yield sse("error", exc.payload())
                        yield sse("done", {})
                        continue

                    yield sse("meta", run_plan.meta)
                    # With a session, the run is saved as that session's chart history.
                    recorder = (
                        AnalyzeRecorder(current, run_plan.meta, owner=owner)
                        if current.session_id
                        else None
                    )

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
                            if recorder is not None and name == "done":
                                final_meta = await recorder.save(charts)
                                if final_meta is not None:
                                    yield sse("meta", final_meta)
                            elif recorder is not None:
                                recorder.observe(name, payload)
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
                    _finish()
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
