from __future__ import annotations

from sqlalchemy import Float, String, Text
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
