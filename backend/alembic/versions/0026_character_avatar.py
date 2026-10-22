"""Persist character photos as references to existing uploaded images."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0026_character_avatar"
down_revision = "0025_story_character_graph"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("characters", sa.Column("avatar_upload_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_character_avatar_upload",
        "characters",
        "upload_files",
        ["avatar_upload_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade():
    op.drop_constraint("fk_character_avatar_upload", "characters", type_="foreignkey")
    op.drop_column("characters", "avatar_upload_id")
