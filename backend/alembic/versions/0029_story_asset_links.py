"""Story library references to existing uploads and generated assets.

Revision ID: 0029_story_asset_links
Revises: 0028_storyline
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029_story_asset_links"
down_revision: str | Sequence[str] | None = "0028_storyline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "story_asset_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("story_id", sa.Uuid(), nullable=False),
        sa.Column("upload_id", sa.Uuid(), nullable=True),
        sa.Column("asset_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("scene_id", sa.Uuid(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "story_id"],
            ["stories.project_id", "stories.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "asset_id"],
            ["assets.project_id", "assets.id"],
        ),
        sa.ForeignKeyConstraint(["upload_id"], ["upload_files.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "(upload_id IS NULL) <> (asset_id IS NULL)",
            name="ck_story_asset_source",
        ),
        sa.CheckConstraint(
            "category IN ('general', 'scene', 'shot')",
            name="ck_story_asset_category",
        ),
    )
    op.create_index(
        "uq_story_asset_upload",
        "story_asset_links",
        ["story_id", "upload_id"],
        unique=True,
        postgresql_where=sa.text("upload_id IS NOT NULL"),
    )
    op.create_index(
        "uq_story_asset_generated",
        "story_asset_links",
        ["story_id", "asset_id"],
        unique=True,
        postgresql_where=sa.text("asset_id IS NOT NULL"),
    )
    op.create_index(
        "ix_story_asset_scope",
        "story_asset_links",
        ["project_id", "story_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_story_asset_scope", table_name="story_asset_links")
    op.drop_index("uq_story_asset_generated", table_name="story_asset_links")
    op.drop_index("uq_story_asset_upload", table_name="story_asset_links")
    op.drop_table("story_asset_links")
