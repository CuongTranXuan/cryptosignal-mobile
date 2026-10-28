"""Analyze with a `session_id`: record the run's SSE output and save it as chart history.

The recorder watches the events the runner streams. On the runner's `done` (and only if
no `error` came first) it writes the chart doc in one transaction and returns the final
`meta` to emit, carrying `chart_state_revision`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from pydantic import ValidationError

from cryptosignal_copilot.chart_state import (
    ChartKeyError,
    ChartShape,
    ChartStateStore,
    ChartStateTooLargeError,
    normalize_key,
)
from cryptosignal_copilot.schema import AgentMarker, AnalyzeRequest
from cryptosignal_copilot.sessions_store import SessionNotFoundError
from cryptosignal_copilot.wire_shape import ai_shape_flags

logger = logging.getLogger(__name__)


class AnalyzeRecorder:
    def __init__(
        self, request: AnalyzeRequest, meta: dict[str, Any] | None, *, owner: str | None = None
    ) -> None:
        self._request = request
        self._owner = owner
        self._meta: dict[str, Any] = dict(meta or {})
        self._shapes: list[dict[str, Any]] | None = None
        self._markers: list[dict[str, Any]] = []
        self._analysis: dict[str, Any] | None = None
        self._text: list[str] = []
        self._errored = False

    def observe(self, event: str, payload: dict[str, Any]) -> None:
        if event == "meta":
            self._meta = {**self._meta, **payload}
        elif event == "text":
            self._text.append(str(payload.get("delta") or ""))
        elif event == "shapes":
            self._shapes = list(payload.get("shapes") or [])
        elif event == "markers":
            self._markers = list(payload.get("markers") or [])
        elif event == "analysis":
            self._analysis = payload
        elif event == "error":
            self._errored = True

    async def save(self, store: ChartStateStore) -> dict[str, Any] | None:
        """Final meta for the stream, or None when the run produced nothing to save."""
        if self._errored or self._shapes is None or not self._request.session_id:
            return None
        try:
            symbol, interval = normalize_key(self._request.symbol, self._request.interval)
            doc = await asyncio.to_thread(
                store.save_analysis,
                self._request.session_id,
                symbol,
                interval,
                shapes=_valid_shapes(self._shapes),
                markers=_valid_markers(self._markers),
                analysis=self._analysis,
                summary_text="".join(self._text).strip() or None,
                model=self._meta.get("model"),
                owner=self._owner,
            )
        except SessionNotFoundError:
            return {**self._meta, "chart_state_error": "session_not_found"}
        except ChartStateTooLargeError as exc:
            return {
                **self._meta,
                "chart_state_error": "chart_state_too_large",
                "field": exc.field,
                "limit": exc.limit,
            }
        except ChartKeyError as exc:
            return {**self._meta, "chart_state_error": exc.code}
        except Exception:
            logger.exception("chart state autosave failed")
            return {**self._meta, "chart_state_error": "chart_state_save_failed"}
        return {**self._meta, "chart_state_revision": doc["revision"]}


def _valid_shapes(shapes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for shape in shapes:
        try:
            out.append(ChartShape.model_validate(ai_shape_flags(shape)).model_dump(mode="json"))
        except ValidationError as exc:
            logger.warning("chart autosave: skip shape %s (%s)", shape.get("id"), exc.errors()[:1])
    return out


def _valid_markers(markers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for marker in markers:
        try:
            out.append(AgentMarker.model_validate(marker).model_dump(mode="json"))
        except ValidationError as exc:
            logger.warning(
                "chart autosave: skip marker %s (%s)", marker.get("id"), exc.errors()[:1]
            )
    return out
