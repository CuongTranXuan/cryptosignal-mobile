from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol

from pydantic_ai import Agent
from pydantic_ai.output import PromptedOutput
from pydantic_ai.exceptions import ModelHTTPError

from cryptosignal_copilot.config import load_llm_config
from cryptosignal_copilot.klines import fetch_klines
from cryptosignal_copilot.model_factory import build_model
from cryptosignal_copilot.schema import (
    AnalyzeRequest,
    AnalyzeResult,
    filter_agent_markers,
    filter_preview_shapes,
)

INSTRUCTIONS = (
    "You are a crypto chart research assistant. Analyze only closed candles. "
    "The request from/to and closedCandles define the primary analysis window — treat that "
    "as what the user is looking at. Prefer patterns inside that window (especially the most "
    "recent bars) unless the user explicitly names another time range or asks for older history. "
    "When the prompt mentions the visible window / this window / viewport, stay strictly inside "
    "the provided closedCandles set and do not call get_klines for older history. "
    "Always fill `summary` as a friendly chat reply (not a terse log): open with what you see, "
    "name key levels/times, explain the pattern, say what you are drawing and why, and end with "
    "a short takeaway. Use several short paragraphs. "
    "Also return drawable PatternShape overlays (trendline/polyline/zone) whenever the "
    "prompt asks for analysis or drawing — do not return text-only when shapes would help. "
    "Every shape point.time MUST be an exact unix second from closedCandles (or get_klines); "
    "never invent times. Prefer 1–3 high-confidence shapes over many weak ones. Each shape MUST use fields id,symbol,interval,kind,name,status,source,confidence,points,priceLow,priceHigh (kind is trendline|polyline|zone; source is agent; status is preview; priceLow/priceHigh null for lines). Never use type/label/color instead of kind/name. Polyline needs >=3 points (use trendline for 2). "
    "Optional AgentMarker point signals are a separate collection; AgentMarker.side is "
    "signal direction (buy/sell/neutral), not an order. Never put side/quantity/apiKey on "
    "PatternShape. Never place orders, never request API keys or secrets, never invent "
    "OHLC — call get_klines when you need extra history."
)


class AgentRunner(Protocol):
    def run(self, request: AnalyzeRequest) -> AsyncIterator[tuple[str, dict]]:
        ...


@dataclass
class _ToolState:
    extend_from: int | None = None
    extend_to: int | None = None
    tool_failed: bool = False
    request_from: int = 0
    tool_times: set[int] = field(default_factory=set)


class PydanticAiRunner:
    async def run(self, request: AnalyzeRequest) -> AsyncIterator[tuple[str, dict]]:
        cfg = load_llm_config()
        model = build_model(cfg)
        state = _ToolState(request_from=request.from_)
        # OmniRoute/agentrouter rejects OpenAI tool_choice="required" (pydantic-ai's
        # default ToolOutput mode). PromptedOutput uses response_format=json_object
        # with tool_choice=auto, which works through the gateway.
        agent: Agent[None, AnalyzeResult] = Agent(
            model,
            output_type=PromptedOutput(AnalyzeResult),
            instructions=INSTRUCTIONS,
        )

        @agent.tool_plain
        async def get_klines(
            symbol: str,
            interval: str,
            limit: int = 500,
            startTime: int | None = None,
            endTime: int | None = None,
        ) -> list[dict[str, Any]]:
            try:
                candles = await fetch_klines(
                    symbol,
                    interval,
                    limit=limit,
                    start_time=startTime,
                    end_time=endTime,
                    timeout_s=cfg.timeout_s,
                )
            except Exception:
                state.tool_failed = True
                return []
            if candles:
                for c in candles:
                    state.tool_times.add(c.time)
                min_t = min(c.time for c in candles)
                max_t = max(c.time for c in candles)
                if min_t < state.request_from:
                    state.extend_from = (
                        min_t if state.extend_from is None else min(state.extend_from, min_t)
                    )
                    state.extend_to = (
                        max_t if state.extend_to is None else max(state.extend_to, max_t)
                    )
            return [c.model_dump() for c in candles]

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
            detail = _provider_error_detail(exc)
            if exc.status_code in (401, 403):
                msg = "Copilot failed: provider unauthorized"
                if detail:
                    msg = f"{msg} ({detail})"
                yield "error", {"message": msg}
            elif exc.status_code == 429:
                yield "error", {"message": "Copilot failed: provider rate-limited"}
            else:
                yield "error", {"message": "Copilot failed" if not detail else f"Copilot failed ({detail})"}
            yield "done", {}
            return
        except Exception:
            yield "error", {"message": "Copilot failed"}
            yield "done", {}
            return

        if state.tool_failed:
            yield "text", {"delta": "Extra history skipped"}

        yield "text", {"delta": "Model finished. Building overlays…"}

        output = result.output
        if output.summary:
            yield "text", {"delta": "\n\n" + output.summary}

        allowed_times = {c.time for c in request.closedCandles} | state.tool_times
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

        if state.extend_from is not None and state.extend_to is not None:
            yield "extendRange", {"from": state.extend_from, "to": state.extend_to}

        yield "done", {}



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
    payload = request.model_dump(by_alias=True)
    n = len(request.closedCandles)
    return (
        f"Symbol={request.symbol} interval={request.interval}\n"
        f"PRIMARY ANALYSIS WINDOW: from={request.from_} to={request.to} "
        f"({n} closed candles). Analyze this window. "
        f"All shape point.time values MUST be times from this closedCandles set "
        f"(or get_klines only if the user asked for older history). "
        f"Prefer the most recent bars in the window when the user does not name another range.\n"
        f"User prompt: {request.prompt}\n"
        f"Request JSON: {payload}"
    )
