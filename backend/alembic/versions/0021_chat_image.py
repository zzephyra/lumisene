"""Persist chat image task association."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0021_chat_image"
down_revision = "0020_creative_chat"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("chat_turns", sa.Column("generation_task_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_chat_turn_generation", "chat_turns", "generation_tasks", ["generation_task_id"], ["id"]
    )


def downgrade():
    op.drop_constraint("fk_chat_turn_generation", "chat_turns", type_="foreignkey")
    op.drop_column("chat_turns", "generation_task_id")
