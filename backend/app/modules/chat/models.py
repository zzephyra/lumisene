"""Project-scoped conversations and persisted user/assistant turn pairs."""

from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Conversation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "chat_conversations"
    __table_args__ = (UniqueConstraint("project_id", "id", name="uq_chat_conversation_project"),)
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)


class ChatTurn(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "chat_turns"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "conversation_id"],
            ["chat_conversations.project_id", "chat_conversations.id"],
        ),
        UniqueConstraint("conversation_id", "request_id", name="uq_chat_turn_request"),
        CheckConstraint(
            "status IN ('queued','running','succeeded','failed','canceled')",
            name="ck_chat_turn_status",
        ),
        CheckConstraint("char_length(prompt) BETWEEN 1 AND 10000", name="ck_chat_turn_prompt"),
        Index(
            "ix_chat_turn_active",
            "conversation_id",
            unique=True,
            postgresql_where=text("status IN ('queued','running')"),
        ),
    )
    project_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    conversation_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    request_id: Mapped[UUID] = mapped_column(nullable=False)
    model_config_id: Mapped[UUID] = mapped_column(ForeignKey("model_configs.id"), nullable=False)
    config_version: Mapped[int] = mapped_column(Integer, nullable=False)
    prompt: Mapped[str] = mapped_column(nullable=False)
    context: Mapped[list] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    generation_task_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("generation_tasks.id"), nullable=True
    )
    reply: Mapped[str | None] = mapped_column(nullable=True)
    proposal: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(300), nullable=True)
