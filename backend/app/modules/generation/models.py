"""Image generation tasks and the assets that hold their bytes."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.ai.models import ModelConfig
from app.infrastructure.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.modules.auth.models import User
from app.modules.projects.models import Project

# Workers import this module alone. These tables must be on the shared metadata
# before an asset insert, or SQLAlchemy cannot resolve the foreign keys.
_FOREIGN_KEY_TARGETS = (User, Project, ModelConfig)


class Asset(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "assets"
    __table_args__ = (
        Index("ix_assets_public_author", "created_by", "published_at", "id", postgresql_where=text("published_at IS NOT NULL")),
        Index("ix_assets_admin_created", "created_at", "id"),
        UniqueConstraint("project_id", "id", name="uq_assets_project_id"),
        CheckConstraint("kind IN ('IMAGE', 'VIDEO', 'AUDIO', 'FILE')", name="ck_assets_kind"),
        CheckConstraint(
            "status IN ('uploading', 'ready', 'failed', 'deleted')",
            name="ck_assets_status",
        ),
        CheckConstraint("size_bytes > 0", name="ck_assets_size"),
        CheckConstraint(
            "storage_provider IN ('s3', 'qiniu')",
            name="ck_assets_storage_provider",
        ),
        CheckConstraint(
            "purge_status IS NULL OR purge_status IN ('pending', 'failed', 'purged')",
            name="ck_assets_purge_status",
        ),
        Index("ix_assets_project_created", "project_id", "created_at", "id"),
    )

    project_id: Mapped[UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="RESTRICT"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    object_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    mime: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    storage_provider: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="s3",
        server_default="s3",
    )
    bucket: Mapped[str] = mapped_column(String(128), nullable=False, default="", server_default="")
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    purge_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_by: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )


class GenerationInput(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "generation_inputs"
    __table_args__ = (
        UniqueConstraint("project_id", "id", name="uq_generation_inputs_project_id"),
        CheckConstraint(
            "status IN ('uploading', 'ready', 'failed', 'deleted')",
            name="ck_generation_inputs_status",
        ),
    )
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), nullable=False)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    image_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    mask_key: Mapped[str | None] = mapped_column(String(512))
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)


class GenerationTask(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One explicit generation. Video tasks also use submitting and cancel_requested."""

    __tablename__ = "generation_tasks"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "input_id"],
            ["generation_inputs.project_id", "generation_inputs.id"],
            name="fk_generation_tasks_input_scope",
        ),
        CheckConstraint(
            "status IN ('queued', 'submitting', 'running', 'cancel_requested', "
            "'succeeded', 'failed', 'canceled')",
            name="ck_generation_tasks_status",
        ),
        CheckConstraint("kind IN ('image', 'video')", name="ck_generation_tasks_kind"),
        CheckConstraint(
            "progress IS NULL OR progress BETWEEN 0 AND 100",
            name="ck_generation_tasks_progress",
        ),
        Index(
            "uq_generation_tasks_idempotency",
            "project_id",
            "actor_id",
            "idempotency_key",
            unique=True,
        ),
        Index("ix_generation_tasks_project_created", "project_id", "created_at", "id"),
        Index("ix_generation_tasks_status_created", "status", "created_at"),
        Index("ix_generation_tasks_admin_created", "created_at", "id"),
    )

    project_id: Mapped[UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="RESTRICT"),
        nullable=False,
    )
    actor_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    model_config_id: Mapped[UUID] = mapped_column(
        ForeignKey("model_configs.id", ondelete="RESTRICT"),
        nullable=False,
    )
    config_version: Mapped[int] = mapped_column(Integer, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    input_id: Mapped[UUID | None] = mapped_column(nullable=True)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    request_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    kind: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="image",
        server_default="image",
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    phase: Mapped[str | None] = mapped_column(String(32), nullable=True)
    progress: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reconciliation_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_task_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(300), nullable=True)
    lease_token: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    lease_owner: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_poll_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class GenerationOutput(Base):
    __tablename__ = "generation_outputs"
    __table_args__ = (
        CheckConstraint("ordinal >= 1", name="ck_generation_outputs_ordinal"),
        Index("uq_generation_outputs_task_ordinal", "task_id", "ordinal", unique=True),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="RESTRICT"),
        nullable=False,
    )
    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("generation_tasks.id", ondelete="RESTRICT"),
        nullable=False,
    )
    asset_id: Mapped[UUID] = mapped_column(
        ForeignKey("assets.id", ondelete="RESTRICT"),
        nullable=False,
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class GenerationAdminAudit(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "generation_admin_audits"
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    target_id: Mapped[UUID] = mapped_column(ForeignKey("generation_tasks.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    before_status: Mapped[str] = mapped_column(String(32), nullable=False)
    after_status: Mapped[str] = mapped_column(String(32), nullable=False)
    request_id: Mapped[str] = mapped_column(String(128), nullable=False)


class AssetPurgeJob(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One cloud cleanup for one asset. The policy is copied when the job is created."""

    __tablename__ = "asset_purge_jobs"
    __table_args__ = (
        UniqueConstraint("asset_id", name="uq_asset_purge_jobs_asset"),
        CheckConstraint(
            "status IN ('pending', 'failed', 'purged')",
            name="ck_asset_purge_jobs_status",
        ),
        CheckConstraint(
            "policy IN ('retain_cloud_file', 'delete_cloud_file')",
            name="ck_asset_purge_jobs_policy",
        ),
    )

    asset_id: Mapped[UUID] = mapped_column(ForeignKey("assets.id"), nullable=False)
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), nullable=False)
    object_key: Mapped[str] = mapped_column(String(512), nullable=False)
    storage_provider: Mapped[str] = mapped_column(String(16), nullable=False)
    bucket: Mapped[str] = mapped_column(String(128), nullable=False)
    policy: Mapped[str] = mapped_column(String(32), nullable=False)
    settings_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_error: Mapped[str | None] = mapped_column(String(300), nullable=True)
