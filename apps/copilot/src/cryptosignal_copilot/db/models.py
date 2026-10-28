from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class CopilotFeedbackRow(Base):
    __tablename__ = "copilot_feedback"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    message_id: Mapped[str | None] = mapped_column(String, nullable=True)
    drawing_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    action: Mapped[str] = mapped_column(String, nullable=False)
    before_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    after_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_ts: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)


class CopilotSessionRow(Base):
    __tablename__ = "copilot_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)
    updated_at: Mapped[float] = mapped_column(Float, nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    reasoning_effort: Mapped[str | None] = mapped_column(String, nullable=True)
    intent_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Device that created the session (device.py); NULL = legacy, adopted on first touch.
    owner_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)


class ChartStateRow(Base):
    """Per-session chart history: one JSON doc per (session, symbol, interval)."""

    __tablename__ = "chart_states"
    __table_args__ = (
        UniqueConstraint("session_id", "symbol", "interval", name="uq_chart_states_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("copilot_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    symbol: Mapped[str] = mapped_column(String, nullable=False)
    interval: Mapped[str] = mapped_column(String, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    doc: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[float] = mapped_column(Float, nullable=False)
    analyzed_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Index metadata, so `GET …/charts` never parses the docs.
    shape_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    has_analysis: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
