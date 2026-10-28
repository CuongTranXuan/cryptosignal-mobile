"""Per-session chart history (docs/CHART_HISTORY_SPEC.md).

One JSON doc per (session, symbol, interval) in `chart_states`, guarded by an integer
`revision` (optimistic concurrency). The web client PUTs the whole doc; an analyze run
with a `session_id` writes it server-side, replacing only the unpinned AI shapes.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    model_validator,
)
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from cryptosignal_copilot.db.engine import get_engine
from cryptosignal_copilot.db.models import ChartStateRow
from cryptosignal_copilot.schema import INTERVALS, AgentMarker, SessionShape
from cryptosignal_copilot.sessions_store import owned_session_row

logger = logging.getLogger(__name__)

MAX_SHAPES = 200
MAX_MARKERS = 300
MAX_ANALYSIS_BYTES = 64 * 1024
MAX_POINTS_PER_SHAPE = 500
MAX_STRING_BYTES = 2 * 1024  # any string inside a shape or marker (names, labels, text)
MAX_SUMMARY_TEXT_BYTES = 16 * 1024
MAX_DOC_BYTES = 1024 * 1024  # the stored JSON doc
MAX_CHARTS_PER_SESSION = 50
_SYMBOL_RE = re.compile(r"[A-Z0-9][A-Z0-9._-]{0,39}")
# PUT fields that keep the stored value when omitted (`shapes` is always required).
_OPTIONAL_DOC_FIELDS = ("markers", "analysis", "summary_text", "model", "analyzed_at", "view")


class ChartShape(SessionShape):
    """A wire shape plus the chart-history flags. Pinned = user-drawn, kept or edited."""

    origin: Literal["ai", "user"]
    kept: bool = False
    edited: bool = False

    @model_validator(mode="before")
    @classmethod
    def _default_flags(cls, data: Any) -> Any:
        """Older clients may omit the flags: origin follows `source`, flags default false."""
        if isinstance(data, dict):
            data = dict(data)
            if data.get("origin") is None:
                data["origin"] = "user" if data.get("source") == "human" else "ai"
            for key in ("kept", "edited"):
                if data.get(key) is None:
                    data[key] = False
        return data


class ChartView(BaseModel):
    """Visible range in unix seconds, stored as sent."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_: int = Field(alias="from")
    to: int

    def to_wire(self) -> dict[str, int]:
        return {"from": self.from_, "to": self.to}


class ChartStatePut(BaseModel):
    """PUT body: the doc minus `updated_at`, plus the base `revision` (absent = create)."""

    model_config = ConfigDict(extra="forbid")

    shapes: list[ChartShape]
    revision: int | None = None
    markers: list[AgentMarker] | None = None
    analysis: dict[str, Any] | None = None
    summary_text: str | None = None
    model: str | None = None
    analyzed_at: float | None = None
    view: ChartView | None = None
    # Echoed doc fields are accepted and ignored (the path is the key; the server owns them).
    symbol: str | None = None
    interval: str | None = None
    updated_at: float | None = None
    chart_state_revision: int | None = None


def is_pinned(shape: dict[str, Any]) -> bool:
    return shape.get("origin") == "user" or bool(shape.get("kept")) or bool(shape.get("edited"))


# --------------------------------------------------------------------------- errors


class ChartStateNotFoundError(Exception):
    pass


@dataclass
class RevisionConflictError(Exception):
    current: dict[str, Any]


@dataclass
class ChartStateTooLargeError(Exception):
    """413 `chart_state_too_large`: `field` names the cap, `limit` its value."""

    field: str
    limit: int


class ChartKeyError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def normalize_key(symbol: str, interval: str) -> tuple[str, str]:
    sym = symbol.strip().upper()
    if not _SYMBOL_RE.fullmatch(sym):
        raise ChartKeyError("invalid_symbol", f"invalid symbol {symbol!r}")
    if interval not in INTERVALS:
        raise ChartKeyError("invalid_interval", f"interval must be one of {', '.join(INTERVALS)}")
    return sym, interval


def check_limits(
    shapes: list[Any],
    markers: list[Any] | None,
    analysis: dict[str, Any] | None,
    summary_text: Any = None,
) -> None:
    """Size caps on raw (unvalidated) doc parts; ChartStateTooLargeError on the first hit."""
    if len(shapes) > MAX_SHAPES:
        raise ChartStateTooLargeError("shapes", MAX_SHAPES)
    if markers is not None and len(markers) > MAX_MARKERS:
        raise ChartStateTooLargeError("markers", MAX_MARKERS)
    for item in shapes:
        points = item.get("points") if isinstance(item, dict) else None
        if isinstance(points, list) and len(points) > MAX_POINTS_PER_SHAPE:
            raise ChartStateTooLargeError("points", MAX_POINTS_PER_SHAPE)
    if _max_string_bytes([shapes, markers]) > MAX_STRING_BYTES:
        raise ChartStateTooLargeError("string_bytes", MAX_STRING_BYTES)
    if analysis is not None and _json_bytes(analysis) > MAX_ANALYSIS_BYTES:
        raise ChartStateTooLargeError("analysis_bytes", MAX_ANALYSIS_BYTES)
    if isinstance(summary_text, str) and len(summary_text.encode()) > MAX_SUMMARY_TEXT_BYTES:
        raise ChartStateTooLargeError("summary_text_bytes", MAX_SUMMARY_TEXT_BYTES)


def _max_string_bytes(value: Any) -> int:
    if isinstance(value, str):
        return len(value.encode())
    if isinstance(value, dict):
        value = list(value.values())
    if isinstance(value, list):
        return max((_max_string_bytes(v) for v in value), default=0)
    return 0


def _json_bytes(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())


def merge_analysis_shapes(
    current_shapes: list[dict[str, Any]],
    current_markers: list[dict[str, Any]],
    new_shapes: list[dict[str, Any]],
    new_markers: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Keep pinned shapes (and their anchor markers); replace everything else."""
    pinned = [s for s in current_shapes if is_pinned(s)]
    pinned_keys = {str(s["id"]) for s in pinned} | {
        str(s["drawing_id"]) for s in pinned if s.get("drawing_id")
    }
    shapes = pinned + [s for s in new_shapes if str(s["id"]) not in pinned_keys]
    kept_markers = [m for m in current_markers if str(m.get("drawing_id") or "") in pinned_keys]
    seen = {str(m["id"]) for m in kept_markers}
    markers = kept_markers + [
        m
        for m in new_markers
        if str(m.get("drawing_id") or "") not in pinned_keys and str(m["id"]) not in seen
    ]
    return shapes, markers


# --------------------------------------------------------------------------- store


def _empty_body() -> dict[str, Any]:
    return {
        "shapes": [],
        "markers": [],
        "analysis": None,
        "summary_text": None,
        "model": None,
        "view": None,
    }


def _doc(row: ChartStateRow, body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body if body is not None else json.loads(row.doc)
    return {
        "symbol": row.symbol,
        "interval": row.interval,
        "revision": row.revision,
        "updated_at": row.updated_at,
        "shapes": body.get("shapes") or [],
        "markers": body.get("markers") or [],
        "analysis": body.get("analysis"),
        "summary_text": body.get("summary_text"),
        "model": body.get("model"),
        "analyzed_at": row.analyzed_at,
        "view": body.get("view"),
        "chart_state_revision": row.revision,
    }


_INDEX_COLUMNS = (
    ChartStateRow.symbol,
    ChartStateRow.interval,
    ChartStateRow.updated_at,
    ChartStateRow.revision,
    ChartStateRow.analyzed_at,
    ChartStateRow.shape_count,
    ChartStateRow.has_analysis,
)


def _serialize(doc_body: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """The stored JSON and its metadata columns; the doc-size cap applies here."""
    raw = json.dumps(doc_body, ensure_ascii=False)
    if len(raw.encode()) > MAX_DOC_BYTES:
        raise ChartStateTooLargeError("doc_bytes", MAX_DOC_BYTES)
    meta = {
        "shape_count": len(doc_body.get("shapes") or []),
        "has_analysis": doc_body.get("analysis") is not None,
    }
    return raw, meta


class ChartStateStore:
    def __init__(self, *, database_url: str | None = None, clock=time.time) -> None:
        self._engine = get_engine(database_url)
        self._session_factory = sessionmaker(bind=self._engine, expire_on_commit=False)
        self._lock = threading.Lock()
        self._clock = clock

    def _now(self) -> float:
        return round(float(self._clock()), 3)

    @staticmethod
    def _require_session(session: Session, session_id: str, owner: str | None) -> None:
        owned_session_row(session, session_id, owner)

    @staticmethod
    def _row(session: Session, session_id: str, symbol: str, interval: str) -> ChartStateRow | None:
        return session.execute(
            select(ChartStateRow).where(
                ChartStateRow.session_id == session_id,
                ChartStateRow.symbol == symbol,
                ChartStateRow.interval == interval,
            )
        ).scalar_one_or_none()

    def list_charts(self, session_id: str, *, owner: str | None = None) -> list[dict[str, Any]]:
        with self._lock, self._session_factory() as session:
            self._require_session(session, session_id, owner)
            rows = session.execute(
                select(*_INDEX_COLUMNS)
                .where(ChartStateRow.session_id == session_id)
                .order_by(ChartStateRow.updated_at.desc(), ChartStateRow.id.desc())
            )
            return [{**row._asdict(), "has_analysis": bool(row.has_analysis)} for row in rows]

    def get_chart(
        self, session_id: str, symbol: str, interval: str, *, owner: str | None = None
    ) -> dict[str, Any]:
        with self._lock, self._session_factory() as session:
            self._require_session(session, session_id, owner)
            row = self._row(session, session_id, symbol, interval)
            if row is None:
                raise ChartStateNotFoundError()
            return _doc(row)

    def delete_chart(
        self, session_id: str, symbol: str, interval: str, *, owner: str | None = None
    ) -> None:
        with self._lock, self._session_factory() as session:
            self._require_session(session, session_id, owner)
            row = self._row(session, session_id, symbol, interval)
            if row is None:
                raise ChartStateNotFoundError()
            session.delete(row)
            session.commit()

    def put_chart(
        self,
        session_id: str,
        symbol: str,
        interval: str,
        body: ChartStatePut,
        *,
        owner: str | None = None,
    ) -> dict[str, Any]:
        provided = body.model_fields_set
        fields: dict[str, Any] = {"shapes": [s.model_dump(mode="json") for s in body.shapes]}
        for key in _OPTIONAL_DOC_FIELDS:
            if key not in provided:
                continue
            value = getattr(body, key)
            if key == "markers":
                value = [m.model_dump(mode="json") for m in value or []]
            elif key == "view" and value is not None:
                value = value.to_wire()
            fields[key] = value
        with self._lock, self._session_factory() as session:
            self._require_session(session, session_id, owner)
            row = self._row(session, session_id, symbol, interval)
            if row is None:
                if body.revision is not None:
                    raise ChartStateNotFoundError()
                doc_body = {**_empty_body(), **fields}
                doc_body.pop("analyzed_at", None)
                return self._insert(
                    session, session_id, symbol, interval, doc_body, fields.get("analyzed_at")
                )
            if body.revision is None or body.revision != row.revision:
                raise RevisionConflictError(_doc(row))
            doc_body = {**json.loads(row.doc), **fields}
            analyzed_at = doc_body.pop("analyzed_at", row.analyzed_at)
            return self._update(session, row, doc_body, analyzed_at)

    def save_analysis(
        self,
        session_id: str,
        symbol: str,
        interval: str,
        *,
        shapes: list[dict[str, Any]],
        markers: list[dict[str, Any]],
        analysis: dict[str, Any] | None,
        summary_text: str | None,
        model: str | None,
        owner: str | None = None,
    ) -> dict[str, Any]:
        """One transaction: keep pinned shapes and the view, replace the rest, bump revision."""
        analyzed_at = self._now()
        for _attempt in range(3):
            with self._lock, self._session_factory() as session:
                self._require_session(session, session_id, owner)
                row = self._row(session, session_id, symbol, interval)
                current = json.loads(row.doc) if row is not None else _empty_body()
                merged_shapes, merged_markers = merge_analysis_shapes(
                    current.get("shapes") or [], current.get("markers") or [], shapes, markers
                )
                check_limits(merged_shapes, merged_markers, analysis, summary_text)
                doc_body = {
                    **current,
                    "shapes": merged_shapes,
                    "markers": merged_markers,
                    "analysis": analysis,
                    "summary_text": summary_text,
                    "model": model,
                }
                try:
                    if row is None:
                        return self._insert(
                            session, session_id, symbol, interval, doc_body, analyzed_at
                        )
                    return self._update(session, row, doc_body, analyzed_at)
                except RevisionConflictError:
                    continue  # a PUT won the race: merge again on top of it
        raise RuntimeError("chart state: too many concurrent writers")

    def _insert(
        self,
        session: Session,
        session_id: str,
        symbol: str,
        interval: str,
        doc_body: dict[str, Any],
        analyzed_at: float | None,
    ) -> dict[str, Any]:
        raw, meta = _serialize(doc_body)
        charts = session.scalar(
            select(func.count())
            .select_from(ChartStateRow)
            .where(ChartStateRow.session_id == session_id)
        )
        if (charts or 0) >= MAX_CHARTS_PER_SESSION:
            raise ChartStateTooLargeError("charts", MAX_CHARTS_PER_SESSION)
        row = ChartStateRow(
            session_id=session_id,
            symbol=symbol,
            interval=interval,
            revision=1,
            doc=raw,
            updated_at=self._now(),
            analyzed_at=analyzed_at,
            **meta,
        )
        session.add(row)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            existing = self._row(session, session_id, symbol, interval)
            if existing is None:
                raise
            raise RevisionConflictError(_doc(existing)) from None
        return _doc(row, doc_body)

    def _update(
        self,
        session: Session,
        row: ChartStateRow,
        doc_body: dict[str, Any],
        analyzed_at: float | None,
    ) -> dict[str, Any]:
        raw, meta = _serialize(doc_body)
        base = row.revision
        now = self._now()
        result = session.execute(
            update(ChartStateRow)
            .where(ChartStateRow.id == row.id, ChartStateRow.revision == base)
            .values(
                revision=base + 1,
                doc=raw,
                updated_at=now,
                analyzed_at=analyzed_at,
                **meta,
            )
            .execution_options(synchronize_session=False)
        )
        if getattr(result, "rowcount", 1) != 1:
            session.rollback()
            session.expire_all()
            fresh = session.get(ChartStateRow, row.id)
            raise RevisionConflictError(_doc(fresh) if fresh is not None else _doc(row))
        session.commit()
        session.refresh(row)
        return _doc(row, doc_body)


def validation_detail(exc: ValidationError) -> list[dict[str, Any]]:
    return [
        {"loc": list(err.get("loc", ())), "msg": err.get("msg", ""), "type": err.get("type", "")}
        for err in exc.errors()[:20]
    ]


_default_store: ChartStateStore | None = None


def get_chart_state_store() -> ChartStateStore:
    global _default_store
    if _default_store is None:
        _default_store = ChartStateStore()
    return _default_store
