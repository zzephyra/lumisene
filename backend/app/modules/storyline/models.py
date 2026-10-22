"""PG owns ordered plot documents and durable AI previews."""

from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class PlotState(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "plot_states"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "story_id"], ["stories.project_id", "stories.id"], ondelete="CASCADE"
        ),
        UniqueConstraint("project_id", "story_id"),
    )
    project_id: Mapped[UUID] = mapped_column(nullable=False)
    story_id: Mapped[UUID] = mapped_column(nullable=False)
    version: Mapped[int] = mapped_column(BigInteger, default=1)


class Chapter(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "plot_chapters"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "story_id"], ["stories.project_id", "stories.id"], ondelete="CASCADE"
        ),
        UniqueConstraint("project_id", "story_id", "id"),
    )
    project_id: Mapped[UUID] = mapped_column(nullable=False)
    story_id: Mapped[UUID] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(String(120))
    summary: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="draft")
    order_index: Mapped[int] = mapped_column(default=0)
    version: Mapped[int] = mapped_column(BigInteger, default=1)
    scenes_version: Mapped[int] = mapped_column(BigInteger, default=1)


class Scene(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "plot_scenes"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "story_id", "chapter_id"],
            ["plot_chapters.project_id", "plot_chapters.story_id", "plot_chapters.id"],
            ondelete="CASCADE",
        ),
    )
    project_id: Mapped[UUID] = mapped_column(nullable=False)
    story_id: Mapped[UUID] = mapped_column(nullable=False)
    chapter_id: Mapped[UUID] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(String(120))
    summary: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="draft")
    location: Mapped[str] = mapped_column(String(200), default="")
    time_of_day: Mapped[str] = mapped_column(String(80), default="")
    setting: Mapped[str] = mapped_column(String(16), default="")
    character_ids: Mapped[list] = mapped_column(JSONB, default=list)
    blocks: Mapped[list] = mapped_column(JSONB, default=list)
    schema_version: Mapped[int] = mapped_column(default=1)
    order_index: Mapped[int] = mapped_column(default=0)
    version: Mapped[int] = mapped_column(BigInteger, default=1)


class PlotJob(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "plot_jobs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "story_id"], ["stories.project_id", "stories.id"], ondelete="CASCADE"
        ),
        UniqueConstraint("project_id", "story_id", "actor_id", "idempotency_key"),
    )
    project_id: Mapped[UUID] = mapped_column(nullable=False)
    story_id: Mapped[UUID] = mapped_column(nullable=False)
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    completion_id: Mapped[UUID] = mapped_column(ForeignKey("text_completions.id"))
    idempotency_key: Mapped[str] = mapped_column(String(120))
    request: Mapped[dict] = mapped_column(JSONB)
    request_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="queued")
    error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    applied: Mapped[bool] = mapped_column(Boolean, default=False)
    repairs: Mapped[int] = mapped_column(default=0)
