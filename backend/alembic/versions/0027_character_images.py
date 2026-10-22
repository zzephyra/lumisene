"""Character visual assets and durable generation links; preserve legacy photos."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0027_character_images"
down_revision = "0026_character_avatar"
branch_labels = None
depends_on = None


def common():
    return [
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False),
        sa.Column("character_id", UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "character_id"],
            ["characters.project_id", "characters.id"],
            ondelete="CASCADE",
        ),
    ]


def upgrade():
    op.create_table(
        "character_images",
        *common(),
        sa.Column("upload_id", UUID(as_uuid=True), sa.ForeignKey("upload_files.id")),
        sa.Column("asset_id", UUID(as_uuid=True), sa.ForeignKey("assets.id")),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("character_id", "upload_id"),
        sa.UniqueConstraint("character_id", "asset_id"),
        sa.CheckConstraint("(upload_id IS NULL) <> (asset_id IS NULL)"),
    )
    op.create_index("ix_character_images_character_id", "character_images", ["character_id"])
    op.create_index(
        "uq_character_images_primary",
        "character_images",
        ["character_id"],
        unique=True,
        postgresql_where=sa.text("is_primary"),
    )
    op.execute(
        "INSERT INTO character_images (id, project_id, character_id, upload_id, is_primary) "
        "SELECT gen_random_uuid(), project_id, id, avatar_upload_id, true "
        "FROM characters WHERE avatar_upload_id IS NOT NULL"
    )
    op.create_table(
        "character_image_jobs",
        *common(),
        sa.Column("actor_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "task_id", UUID(as_uuid=True), sa.ForeignKey("generation_tasks.id"), nullable=False
        ),
        sa.Column("idempotency_key", sa.String(120), nullable=False),
        sa.Column("collected", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("mode", sa.String(20), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("error", sa.String(300), nullable=True),
        sa.UniqueConstraint("character_id", "idempotency_key"),
        sa.UniqueConstraint("task_id"),
    )
    op.create_index(
        "ix_character_image_jobs_character_id", "character_image_jobs", ["character_id"]
    )


def downgrade():
    op.drop_table("character_image_jobs")
    op.drop_table("character_images")
