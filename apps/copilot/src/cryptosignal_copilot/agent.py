from __future__ import annotations

from typing import AsyncIterator, Protocol

from pydantic_ai import Agent
from pydantic_ai.output import PromptedOutput
from pydantic_ai.exceptions import ModelHTTPError

from cryptosignal_copilot.config import load_llm_config
from cryptosignal_copilot.model_factory import build_model
from cryptosignal_copilot.schema import (
    AnalyzeRequest,
    AnalyzeResult,
    filter_agent_markers,
    filter_preview_shapes,
)

# LANGUAGE default is English for `summary` and chat-facing model text. Only switch
# to Vietnamese when the user explicitly asks. System scaffolding stays English.
# History: heavy Vietnamese scaffolding + full-VI user prompts tripped OmniRoute
# agentrouter HTTP 400 content-blocked (observed 2026-09-19). Client quick-action
# prompts may still be Vietnamese; keep window annotations / SSE progress / errors
# in English so the stream is English-consistent.
#
# OmniRoute 2026-09-19: openai→claude translation of pydantic-ai @agent.tool_plain
# get_klines arrives as tools[0].type=custom; agentrouter then 400s with unknown
# variant `custom` (expected web_search_*). Keep tools:[] — analyze with closedCandles only.
INSTRUCTIONS = (
    "You are a crypto chart research assistant. Analyze only closed candles. "
    "LANGUAGE: Write `summary` and chat-facing text in English by default. "
    "Only use Vietnamese if the user explicitly asks for Vietnamese. "
    "Keep JSON/schema field names in English exactly as required "
    "(kind, name, PatternShape, AgentMarker, points, priceLow, priceHigh, side, etc.). "
    "Default analysis/draw window is the visible chart range reflected in request from/to and "
    "closedCandles. If the user defines another range (full history, last N days/weeks/bars, "
    "from–to times, earlier/previous swing, etc.), use only the provided closedCandles and "
    "from/to for that named range when those candles cover it — do not hard-lock every "
    "request to the viewport, and do not claim or call any klines/history tool "
    "(none is registered). "
    "When the prompt mentions the visible window / this window / viewport and does not name "
    "another range, stay strictly inside the provided closedCandles set. "
    "Always fill `summary` as a friendly chat reply (not a terse log): open with "
    "what you see, name key levels/times, explain the pattern, say what you are drawing and why, "
    "and end with a short takeaway. Use several short paragraphs. "
    "Also return drawable PatternShape overlays (trendline/polyline/zone) whenever the "
    "prompt asks for analysis or drawing — do not return text-only when shapes would help. "
    "Every shape point.time MUST be an exact unix second from the provided closedCandles; "
    "never invent times. Prefer 1–3 high-confidence shapes over many weak ones. Each shape MUST use fields id,symbol,interval,kind,name,status,source,confidence,points,priceLow,priceHigh (kind is trendline|polyline|zone; source is agent; status is preview; priceLow/priceHigh null for lines). Never use type/label/color instead of kind/name. Polyline needs >=3 points (use trendline for 2). "
    "Optional AgentMarker point signals are a separate collection; AgentMarker.side is "
    "signal direction (buy/sell/neutral), not an order. Never put side/quantity/apiKey on "
    "PatternShape. Never place orders, never request API keys or secrets, never invent "
    "OHLC — use only the OHLC in the provided closedCandles."
)


class AgentRunner(Protocol):
    def run(self, request: AnalyzeRequest) -> AsyncIterator[tuple[str, dict]]:
        ...


class PydanticAiRunner:
    async def run(self, request: AnalyzeRequest) -> AsyncIterator[tuple[str, dict]]:
        cfg = load_llm_config()
        model = build_model(cfg)
        # OmniRoute/agentrouter rejects OpenAI tool_choice="required" (pydantic-ai's
        # default ToolOutput mode). PromptedOutput uses response_format=json_object
        # with tool_choice=auto, which works through the gateway.
        # No @agent.tool_plain tools: OmniRoute 2026-09-19 rejects custom-tool variant
        # (get_klines → type=custom → agentrouter 400). Requests must send tools:[].
        agent: Agent[None, AnalyzeResult] = Agent(
            model,
            output_type=PromptedOutput(AnalyzeResult),
            instructions=INSTRUCTIONS,
        )

        # @agent.tool_plain get_klines removed — see OmniRoute 2026-09-19 custom-tool reject.

        prompt = _build_user_prompt(request)
        # Emit immediately so the SSE connection is not idle for the whole LLM call
        # (Next/ngrok/proxies often abort silent streams around ~30s).
        yield "text", {
            "delta": (
                f"Analyzing {request.symbol} {request.interval} "
                f"({len(request.closedCandles)} closed candles)…\n\n"
            )
        }
        try:
            result = await agent.run(prompt)
        except ModelHTTPError as exc:
            yield "error", {"message": _model_http_error_message(exc)}
            yield "done", {}
            return
        except Exception:
            yield "error", {"message": "Copilot failed"}
            yield "done", {}
            return

        yield "text", {"delta": "Model finished. Building overlays…"}

        output = result.output
        if output.summary:
            yield "text", {"delta": "\n\n" + output.summary}

        allowed_times = {c.time for c in request.closedCandles}
        valid_shapes, dropped_ids = filter_preview_shapes(output.shapes, allowed_times, symbol=request.symbol, interval=request.interval)

        if dropped_ids:
            yield "text", {"delta": f"\n\nSkipped {len(dropped_ids)} invalid shape(s) (bad schema or times outside candles)."}

        yield "shapes", {"shapes": valid_shapes}
        if valid_shapes:
            names = ", ".join(getattr(s, "name", "?") for s in valid_shapes[:5])
            more = f" (+{len(valid_shapes) - 5} more)" if len(valid_shapes) > 5 else ""
            yield "text", {"delta": f"\n\nOverlays ready: {len(valid_shapes)} — {names}{more}."}

        if output.markers:
            valid_markers, dropped_marker_ids = filter_agent_markers(output.markers, allowed_times)
            if dropped_marker_ids:
                yield "text", {"delta": f"\n\nSkipped {len(dropped_marker_ids)} invalid marker(s)."}
            yield "markers", {"markers": valid_markers}

        yield "done", {}



PROVIDER_UNAUTHORIZED_MSG = "Copilot failed: provider unauthorized"
PROVIDER_CREDITS_EXHAUSTED_MSG = "Copilot failed: provider credits exhausted"
PROVIDER_RATE_LIMITED_MSG = "Copilot failed: provider rate-limited"
PROVIDER_GENERIC_FAILURE_MSG = "Copilot failed"

_CREDITS_EXHAUSTED_MARKERS = (
    "credits exhausted",
    "credit exhausted",
    "budget pool quota exhausted",
    "quota exhausted",
    "budget exhausted",
    "out of credits",
)


def _model_http_error_message(exc: ModelHTTPError) -> str:
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
    """Best-effort short detail from provider HTTP errors (never raises)."""
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


def _build_user_prompt(request: AnalyzeRequest) -> str:
    # Keep window annotations in English. User prompt text may be Vietnamese from
    # the client (quick-actions); stacking VI headers + VI prompts has content-blocked
    # on agentrouter (2026-09-19). SSE progress/errors stay English for stream consistency.
    payload = request.model_dump(by_alias=True)
    n = len(request.closedCandles)
    return (
        f"Symbol={request.symbol} interval={request.interval}\n"
        f"PRIMARY ANALYSIS WINDOW: from={request.from_} to={request.to} "
        f"({n} closed candles). Analyze this window. "
        f"All shape point.time values MUST be times from this closedCandles set. "
        f"Prefer the most recent bars in the window when the user does not name another range.\n"
        f"User prompt: {request.prompt}\n"
        f"Request JSON: {payload}"
    )
