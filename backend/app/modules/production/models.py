"""Production owns snapshots and associations, never provider/media state."""

from uuid import UUID

from sqlalchemy import ForeignKey, ForeignKeyConstraint, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Production(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "productions"
    __table_args__ = (
        ForeignKeyConstraint(["project_id", "story_id"], ["stories.project_id", "stories.id"]),
        UniqueConstraint("project_id", "id"),
    )
    project_id: Mapped[UUID] = mapped_column(nullable=False)
    story_id: Mapped[UUID] = mapped_column(nullable=False)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(120))
    settings: Mapped[dict] = mapped_column(JSONB, default=dict)
    snapshot: Mapped[dict] = mapped_column(JSONB)
    board: Mapped[dict] = mapped_column(JSONB, default=dict)
    version: Mapped[int] = mapped_column(default=1)


class ProductionRun(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "production_runs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "production_id"],
            ["productions.project_id", "productions.id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("project_id", "production_id", "actor_id", "idempotency_key"),
    )
    project_id: Mapped[UUID] = mapped_column(nullable=False)
    production_id: Mapped[UUID] = mapped_column(nullable=False)
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    shot_id: Mapped[UUID | None] = mapped_column(nullable=True)
    kind: Mapped[str] = mapped_column(String(16))
    task_id: Mapped[UUID | None] = mapped_column(ForeignKey("generation_tasks.id"), nullable=True)
    completion_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("text_completions.id"), nullable=True
    )
    render_id: Mapped[UUID | None] = mapped_column(ForeignKey("editor_renders.id"), nullable=True)
    editor_document_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("editor_documents.id"), nullable=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))
    request: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(24), default="queued")
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    applied: Mapped[bool] = mapped_column(default=False)


class ProductionAsset(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "production_assets"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "production_id"],
            ["productions.project_id", "productions.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(["project_id", "asset_id"], ["assets.project_id", "assets.id"]),
        UniqueConstraint("production_id", "asset_id"),
    )
    project_id: Mapped[UUID] = mapped_column(nullable=False)
    production_id: Mapped[UUID] = mapped_column(nullable=False)
    asset_id: Mapped[UUID] = mapped_column(nullable=False)
