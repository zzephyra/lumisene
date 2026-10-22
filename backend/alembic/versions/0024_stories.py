"""Project stories with a cover reference to an existing upload."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0024_stories"
down_revision = "0023_script_analysis"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "stories",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("cover_upload_id", UUID(as_uuid=True), nullable=True),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["cover_upload_id"], ["upload_files.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("project_id", "id", name="uq_stories_project_id"),
        sa.CheckConstraint("version >= 1", name="ck_stories_version"),
        sa.CheckConstraint("char_length(title) BETWEEN 1 AND 120", name="ck_stories_title"),
        sa.CheckConstraint(
            "description IS NULL OR char_length(description) BETWEEN 1 AND 4000",
            name="ck_stories_description",
        ),
    )
    op.create_index("ix_stories_project_updated", "stories", ["project_id", "updated_at", "id"])


def downgrade():
    op.drop_index("ix_stories_project_updated", table_name="stories")
    op.drop_table("stories")
