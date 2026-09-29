from __future__ import annotations

from typing import AsyncIterator, Protocol

from pydantic_ai import Agent
from pydantic_ai.output import PromptedOutput
from pydantic_ai.exceptions import ModelHTTPError

from cryptosignal_copilot.config import load_llm_config
from cryptosignal_copilot.drawing_gate import (
    DrawingWindow,
    bar_seconds,
    effective_project_bars,
    format_drop_note,
)
from cryptosignal_copilot.model_factory import build_model
from cryptosignal_copilot.schema import (
    AnalyzeRequest,
    AnalyzeResult,
    filter_agent_markers,
    filter_preview_details,
)

# LANGUAGE: require Vietnamese for `summary` and chat-facing text the user sees.
# System scaffolding stays English. Heavy Vietnamese scaffolding here plus full-VI
# user prompts has tripped OmniRoute agentrouter HTTP 400 content-blocked
# (observed 2026-09-19 on VI quick-actions like "Tìm tam giác cân…").
# Client quick-action prompts may still be Vietnamese; keep window annotations in
# English to reduce content-block risk. SSE progress/errors are Vietnamese for the UI.
#
# OmniRoute 2026-09-19: openai→claude translation of pydantic-ai @agent.tool_plain
# get_klines arrives as tools[0].type=custom; agentrouter then 400s with unknown
# variant `custom` (expected web_search_*). Keep tools:[] — analyze with closedCandles only.
INSTRUCTIONS = (
    "You are a crypto chart research assistant. Analyze only closed candles. "
    "LANGUAGE: Write `summary` and chat-facing text in Vietnamese by default. "
    "Do not reply in English unless the user explicitly asks for English. "
    "Keep JSON/schema field names in English exactly as required "
    "(kind, name, PatternShape, AgentMarker, points, priceLow, priceHigh, side, etc.). "
    "Default analysis/draw window is the visible chart range reflected in request from/to and "
    "closedCandles. If the user defines another range (full history, last N days/weeks/bars, "
    "from–to times, earlier/previous swing, etc.), use only the provided closedCandles and "
    "from/to for that named range when those candles cover it — do not hard-lock every "
    "request to the viewport, and do not claim or call any klines/history tool "
    "(none is registered). "
    "When the prompt mentions the visible window / this window / viewport and does not name "
    "another range, keep historical anchors inside the provided closedCandles set. "
    "Always fill `summary` as a friendly chat reply (not a terse log): open with "
    "what you see, name key levels/times, explain the pattern, say what you are drawing and why, "
    "and end with a short takeaway. Use several short paragraphs. "
    "Also return drawable PatternShape overlays (trendline/polyline/zone) whenever the "
    "prompt asks for analysis or drawing — do not return text-only when shapes would help. "
    "DRAW ONLY structure still in play. A swing is a fractal high or low "
    "(K=2 on 1m and 15m, K=3 on 1h and higher), swings are at least 5 bars apart, "
    "and the impulse into the swing is at least 1.5xATR(14). "
    "Drop anything whose last touch is in the oldest 35% of the window. "
    "Trendline: exactly 2 points, both wick highs or both wick lows, span >= 8 bars. "
    "Do not set confidence above 0.7 unless a 3rd touch exists. "
    "Channel: two parallel trendlines. The base needs 2 touches; anchor the return "
    "on 2 wick swings as well, because a single-touch diagonal is dropped. "
    "Triangle: at least 2 highs and 2 lows (prefer 3 and 2), duration >= 15 bars, "
    "drawn as TWO trendlines whose names contain 'upper' and 'lower' — not a polyline. "
    "Ascending = flat top + rising lows; descending = flat bottom + falling highs; "
    "symmetrical = both slopes converging. "
    "No fib kind. Fib is one impulse trendline A to B, plus horizontal trendlines named "
    "exactly `Fib 0.382`, `Fib 0.5`, `Fib 0.618` (equal prices on both points), "
    "plus one zone named `Fib pocket 0.5–0.618`. "
    "Uptrend retracement = B - (B-A)*ratio. Extensions `Fib 1.272` and `Fib 1.618` "
    "only after a C pivot, at C + (B-A)*ratio. Mirror the ratio from B back toward A "
    "when the impulse is down. "
    "Emit at most 6 shapes. Minimum confidence is 0.55. "
    "Reject single-touch lines, near-vertical slopes, completed ancient patterns, "
    "and anchors that are not wick highs or lows. "
    "Historical points must use the fractal candle's unix time and that candle's wick "
    "high or low — a mid-body price is dropped as non-wick. "
    "The active swing may be the extreme of the unfinished right-edge bars. "
    "Emit both triangle rails in the same response; a polyline whose name says triangle "
    "is dropped, and a single triangle rail is dropped as unpaired. "
    "Do not emit Fib 1.272 or Fib 1.618 unless the same response includes pivot C "
    "as a wick point after impulse B. "
    "You may describe invalidation as a close beyond the line by more than 0.25xATR(14). "
    "When you state confidence, name the swing high/low times and prices used. "
    "Do not claim entries, stops, or that a level will hold. "
    "Historical anchor times MUST be exact unix seconds from closedCandles. "
    "At most one forward endpoint per shape, and it must be the later point, "
    "at lastClosedCandleTime + k*barSeconds for an integer k inside the stated maxProjectBars. "
    "That forward point is geometry, not a candle. "
    "k caps are a hard ceiling. For a triangle (upper and lower trendlines), also keep "
    "the forward endpoint at or before the lines' intersection time plus 3*barSeconds; "
    "the server computes that apex and drops later rays. Do not add an apexTime field. "
    "Prefer emitting the future endpoint so the overlay can paint it. "
    "Each shape MUST use fields id,symbol,interval,kind,name,status,source,confidence,points,priceLow,priceHigh "
    "(kind is trendline|polyline|zone; source is agent; status is preview; priceLow/priceHigh null for lines). "
    "Never use type/label/color instead of kind/name. Polyline needs >= 3 points and span >= 12 bars "
    "(use trendline for 2; do not encode a triangle as a polyline). "
    "Zones must include at least one closed-candle time point. "
    "Optional AgentMarker point signals are a separate collection; AgentMarker.side is "
    "signal direction (buy/sell/neutral), not an order. Never put side/quantity/apiKey on "
    "PatternShape. Never place orders, never request API keys or secrets, never invent "
    "OHLC or historical times — use only the OHLC in the provided closedCandles."
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
                f"Đang phân tích {request.symbol} {request.interval} "
                f"({len(request.closedCandles)} nến đã đóng)…\n\n"
            )
        }
        try:
            result = await agent.run(prompt)
        except ModelHTTPError as exc:
            yield "error", {"message": _model_http_error_message(exc)}
            yield "done", {}
            return
        except Exception:
            yield "error", {"message": PROVIDER_GENERIC_FAILURE_MSG}
            yield "done", {}
            return

        yield "text", {"delta": "Mô hình đã xong. Đang dựng lớp phủ…"}

        output = result.output
        if output.summary:
            yield "text", {"delta": "\n\n" + output.summary}

        allowed_times = {c.time for c in request.closedCandles}
        window = DrawingWindow(
            candles=request.closedCandles,
            interval=request.interval,
            window_start=request.from_,
            allowed_times=allowed_times,
        )
        valid_shapes, dropped = filter_preview_details(
            output.shapes,
            allowed_times,
            symbol=request.symbol,
            interval=request.interval,
            window=window,
        )

        if dropped:
            yield "text", {"delta": format_drop_note(dropped)}

        yield "shapes", {
            "shapes": valid_shapes,
            "dropped": [{"id": shape_id, "reason": reason} for shape_id, reason in dropped],
        }
        if valid_shapes:
            names = ", ".join(str(s.get("name", "?")) for s in valid_shapes[:5])
            more = f" (+{len(valid_shapes) - 5} nữa)" if len(valid_shapes) > 5 else ""
            yield "text", {"delta": f"\n\nLớp phủ sẵn sàng: {len(valid_shapes)} — {names}{more}."}

        if output.markers:
            valid_markers, dropped_marker_ids = filter_agent_markers(output.markers, allowed_times)
            if dropped_marker_ids:
                yield "text", {"delta": f"\n\nĐã bỏ qua {len(dropped_marker_ids)} marker không hợp lệ."}
            yield "markers", {"markers": valid_markers}

        yield "done", {}



PROVIDER_UNAUTHORIZED_MSG = "Copilot thất bại: nhà cung cấp không được ủy quyền"
PROVIDER_CREDITS_EXHAUSTED_MSG = "Copilot thất bại: hết credits nhà cung cấp"
PROVIDER_RATE_LIMITED_MSG = "Copilot thất bại: nhà cung cấp bị giới hạn tốc độ"
PROVIDER_GENERIC_FAILURE_MSG = "Copilot thất bại"

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


def _projection_note(request: AnalyzeRequest) -> str:
    # English on purpose: Vietnamese window scaffolding has tripped agentrouter content-block.
    if not request.closedCandles:
        return "PROJECTION GRID: no closed candles; do not emit shapes."
    last = max(candle.time for candle in request.closedCandles)
    bar = bar_seconds(request.interval)
    kmax = effective_project_bars(request.interval)
    return (
        "PROJECTION GRID: "
        f"lastClosedCandleTime={last} barSeconds={bar} maxProjectBars={kmax}. "
        "Historical anchors MUST be exact closed-candle unix seconds. "
        "At most one forward endpoint per shape, and only as the later point, "
        f"at lastClosedCandleTime + k*barSeconds for an integer k with 1<=k<={kmax}. "
        "That point is geometry, not a candle. "
        f"Do not emit any time before {request.from_}. "
        "k caps are a hard ceiling. "
        "Triangle rails whose names contain upper and lower: keep the forward endpoint "
        "at or before their intersection time plus 3*barSeconds (apex+3). "
        "The server computes that apex and drops later rays. Do not add an apexTime field. "
        "Prefer emitting the future endpoint so the overlay can paint it."
    )


def _build_user_prompt(request: AnalyzeRequest) -> str:
    # Keep window annotations in English to reduce agentrouter content-block risk
    # (observed 2026-09-19: stacking VI headers + VI quick-actions tripped HTTP 400).
    # Chat SSE progress/errors are Vietnamese; summary language is Vietnamese by default.
    payload = request.model_dump(by_alias=True)
    n = len(request.closedCandles)
    return (
        f"Symbol={request.symbol} interval={request.interval}\n"
        f"PRIMARY ANALYSIS WINDOW: from={request.from_} to={request.to} "
        f"({n} closed candles). Analyze this window. "
        f"Historical anchor times MUST be exact unix seconds from this closedCandles set. "
        f"Prefer the most recent bars in the window when the user does not name another range.\n"
        f"{_projection_note(request)}\n"
        f"User prompt: {request.prompt}\n"
        f"Request JSON: {payload}"
    )
