"""Persistent conversations and idempotent paired turns."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0020_creative_chat"
down_revision = "0019_public_works"
branch_labels = None
depends_on = None


def common():
    return [
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


def upgrade():
    op.create_table(
        "chat_conversations",
        *common(),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.UniqueConstraint("project_id", "id", name="uq_chat_conversation_project"),
    )
    op.create_index("ix_chat_conversations_project_id", "chat_conversations", ["project_id"])
    op.create_table(
        "chat_turns",
        *common(),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", UUID(as_uuid=True), nullable=False),
        sa.Column("actor_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("request_id", UUID(as_uuid=True), nullable=False),
        sa.Column(
            "model_config_id", UUID(as_uuid=True), sa.ForeignKey("model_configs.id"), nullable=False
        ),
        sa.Column("config_version", sa.Integer(), nullable=False),
        sa.Column("prompt", sa.String(), nullable=False),
        sa.Column("context", JSONB, nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("reply", sa.String()),
        sa.Column("proposal", JSONB),
        sa.Column("error_code", sa.String(64)),
        sa.Column("error_message", sa.String(300)),
        sa.ForeignKeyConstraint(
            ["project_id", "conversation_id"],
            ["chat_conversations.project_id", "chat_conversations.id"],
        ),
        sa.UniqueConstraint("conversation_id", "request_id", name="uq_chat_turn_request"),
        sa.CheckConstraint(
            "status IN ('queued','running','succeeded','failed','canceled')",
            name="ck_chat_turn_status",
        ),
        sa.CheckConstraint("char_length(prompt) BETWEEN 1 AND 10000", name="ck_chat_turn_prompt"),
    )
    op.create_index("ix_chat_turns_project_id", "chat_turns", ["project_id"])
    op.create_index("ix_chat_turns_conversation_id", "chat_turns", ["conversation_id"])
    op.create_index(
        "ix_chat_turn_active",
        "chat_turns",
        ["conversation_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('queued','running')"),
    )


def downgrade():
    op.drop_table("chat_turns")
    op.drop_table("chat_conversations")
