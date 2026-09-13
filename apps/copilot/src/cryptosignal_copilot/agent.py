from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol

from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError

from cryptosignal_copilot.config import load_llm_config
from cryptosignal_copilot.klines import fetch_klines
from cryptosignal_copilot.model_factory import build_model
from cryptosignal_copilot.schema import AnalyzeRequest, AnalyzeResult, filter_preview_shapes

INSTRUCTIONS = (
    "You are a crypto chart research assistant. Analyze only closed candles. "
    "Return pattern geometry using unix seconds for time and absolute prices. "
    "Never place orders, never request API keys or secrets, never invent OHLC — "
    "call get_klines when you need extra history."
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
        agent: Agent[None, AnalyzeResult] = Agent(
            model,
            output_type=AnalyzeResult,
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
        try:
            result = await agent.run(prompt)
        except ModelHTTPError as exc:
            if exc.status_code in (401, 403):
                yield "error", {"message": "Copilot failed: provider unauthorized"}
            elif exc.status_code == 429:
                yield "error", {"message": "Copilot failed: provider rate-limited"}
            else:
                yield "error", {"message": "Copilot failed"}
            yield "done", {}
            return
        except Exception:
            yield "error", {"message": "Copilot failed"}
            yield "done", {}
            return

        if state.tool_failed:
            yield "text", {"delta": "Extra history skipped"}

        output = result.output
        if output.summary:
            yield "text", {"delta": output.summary}

        allowed_times = {c.time for c in request.closedCandles} | state.tool_times
        valid_shapes, dropped_ids = filter_preview_shapes(output.shapes, allowed_times)

        if dropped_ids:
            yield "text", {"delta": f"Dropped invalid shapes: {', '.join(dropped_ids)}"}

        yield "shapes", {"shapes": valid_shapes}

        if state.extend_from is not None and state.extend_to is not None:
            yield "extendRange", {"from": state.extend_from, "to": state.extend_to}

        yield "done", {}


def _build_user_prompt(request: AnalyzeRequest) -> str:
    payload = request.model_dump(by_alias=True)
    return (
        f"Symbol={request.symbol} interval={request.interval} "
        f"from={request.from_} to={request.to}\n"
        f"User prompt: {request.prompt}\n"
        f"Request JSON: {payload}"
    )
