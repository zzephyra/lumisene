"""Business identity is independent of graph positions and AI proposals."""

from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.modules.stories.models import Story

_STORY_TABLE = Story.__tablename__


def _story_key():
    return (
        ForeignKeyConstraint(
            ["project_id", "story_id"],
            [f"{_STORY_TABLE}.project_id", f"{_STORY_TABLE}.id"],
        ),
    )


class Character(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "characters"
    __table_args__ = (
        UniqueConstraint("project_id", "id"),
        *_story_key(),
        CheckConstraint("version >= 1"),
    )
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), index=True)
    story_id: Mapped[UUID] = mapped_column(index=True)
    avatar_upload_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("upload_files.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(160), default="")
    role_type: Mapped[str] = mapped_column(String(40), default="")
    gender: Mapped[str] = mapped_column(String(40), default="")
    age: Mapped[str] = mapped_column(String(40), default="")
    occupation: Mapped[str] = mapped_column(String(160), default="")
    aliases: Mapped[list] = mapped_column(JSONB, default=list)
    profile_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    version: Mapped[int] = mapped_column(BigInteger, default=1)


class CharacterRelationship(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "character_relationships"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "source_character_id"], ["characters.project_id", "characters.id"]
        ),
        ForeignKeyConstraint(
            ["project_id", "target_character_id"], ["characters.project_id", "characters.id"]
        ),
        CheckConstraint("source_character_id <> target_character_id"),
        CheckConstraint("direction IN ('undirected','directed','mutual')"),
        CheckConstraint("version >= 1"),
        *_story_key(),
    )
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), index=True)
    story_id: Mapped[UUID] = mapped_column(index=True)
    source_character_id: Mapped[UUID] = mapped_column(index=True)
    target_character_id: Mapped[UUID] = mapped_column(index=True)
    relationship_type: Mapped[str] = mapped_column(String(80))
    direction: Mapped[str] = mapped_column(String(20), default="undirected")
    description: Mapped[str] = mapped_column(String(4000), default="")
    status: Mapped[str] = mapped_column(String(80), default="")
    confidence: Mapped[float | None]
    evidence_refs: Mapped[list] = mapped_column(JSONB, default=list)
    events: Mapped[list] = mapped_column(JSONB, default=list)
    version: Mapped[int] = mapped_column(BigInteger, default=1)


class GraphLayout(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "character_graph_layouts"
    __table_args__ = (
        UniqueConstraint("project_id", "story_id"),
        *_story_key(),
    )
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), index=True)
    story_id: Mapped[UUID] = mapped_column(index=True)
    node_positions: Mapped[dict] = mapped_column(JSONB, default=dict)
    viewport: Mapped[dict] = mapped_column(JSONB, default=lambda: dict(x=0, y=0, zoom=1))
    version: Mapped[int] = mapped_column(BigInteger, default=1)


class ScriptDocument(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "script_documents"
    __table_args__ = (
        UniqueConstraint("project_id", "id"),
        UniqueConstraint("project_id", "story_id", "checksum"),
        *_story_key(),
    )
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), index=True)
    story_id: Mapped[UUID] = mapped_column(index=True)
    filename: Mapped[str] = mapped_column(String(200))
    object_key: Mapped[str] = mapped_column(String(500))
    checksum: Mapped[str] = mapped_column(String(64))
    parse_status: Mapped[str] = mapped_column(String(20), default="pending")


class ScriptSegment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "script_segments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "document_id"], ["script_documents.project_id", "script_documents.id"]
        ),
        UniqueConstraint("project_id", "id"),
        UniqueConstraint("document_id", "sequence"),
    )
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), index=True)
    document_id: Mapped[UUID]
    sequence: Mapped[int]
    start_offset: Mapped[int]
    text: Mapped[str]


class AnalysisJob(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "character_analysis_jobs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "document_id"], ["script_documents.project_id", "script_documents.id"]
        ),
        UniqueConstraint("project_id", "story_id", "actor_id", "idempotency_key"),
        CheckConstraint("status IN ('queued','running','succeeded','failed','canceled')"),
        *_story_key(),
    )
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), index=True)
    story_id: Mapped[UUID] = mapped_column(index=True)
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    document_id: Mapped[UUID]
    idempotency_key: Mapped[str] = mapped_column(String(128))
    model_config_id: Mapped[UUID] = mapped_column(ForeignKey("model_configs.id"))
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    current_stage: Mapped[str] = mapped_column(String(30), default="parsing")
    progress: Mapped[int] = mapped_column(default=0)
    checkpoint: Mapped[dict] = mapped_column(JSONB, default=dict)
    result: Mapped[dict] = mapped_column(JSONB, default=dict)
    error_message: Mapped[str | None] = mapped_column(String(500))
    reviewed: Mapped[bool] = mapped_column(default=False)
    execution_token: Mapped[UUID | None]


class ExtractionEvidence(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "character_evidence"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "segment_id"], ["script_segments.project_id", "script_segments.id"]
        ),
    )
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), index=True)
    segment_id: Mapped[UUID]
    start_offset: Mapped[int]
    end_offset: Mapped[int]
    quote: Mapped[str]
    source_type: Mapped[str] = mapped_column(String(20))
    confidence: Mapped[float]


class CharacterImage(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "character_images"
    __table_args__ = (
        Index(
            "uq_character_images_primary",
            "character_id",
            unique=True,
            postgresql_where=text("is_primary"),
        ),
        ForeignKeyConstraint(
            ["project_id", "character_id"],
            ["characters.project_id", "characters.id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("character_id", "upload_id"),
        UniqueConstraint("character_id", "asset_id"),
        CheckConstraint("(upload_id IS NULL) <> (asset_id IS NULL)"),
    )
    project_id: Mapped[UUID] = mapped_column()
    character_id: Mapped[UUID] = mapped_column(index=True)
    upload_id: Mapped[UUID | None] = mapped_column(ForeignKey("upload_files.id"))
    asset_id: Mapped[UUID | None] = mapped_column(ForeignKey("assets.id"))
    is_primary: Mapped[bool] = mapped_column(default=False)


class CharacterImageJob(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "character_image_jobs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "character_id"],
            ["characters.project_id", "characters.id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("character_id", "idempotency_key"),
        UniqueConstraint("task_id"),
    )
    project_id: Mapped[UUID] = mapped_column()
    character_id: Mapped[UUID] = mapped_column(index=True)
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    task_id: Mapped[UUID] = mapped_column(ForeignKey("generation_tasks.id"))
    idempotency_key: Mapped[str] = mapped_column(String(120))
    collected: Mapped[bool] = mapped_column(default=False)
    mode: Mapped[str] = mapped_column(String(20), default="candidate")
    request_hash: Mapped[str] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(String(300))
