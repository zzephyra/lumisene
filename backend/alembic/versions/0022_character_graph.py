"""Project-scoped characters, multi-relationships and independent layouts."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0022_character_graph"
down_revision = "0021_chat_image"
branch_labels = None
depends_on = None


def common():
    return [
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade():
    op.create_table(
        "characters",
        *common(),
        *(
            sa.Column(n, sa.String(size), nullable=False)
            for n, size in [
                ("name", 120),
                ("title", 160),
                ("role_type", 40),
                ("gender", 40),
                ("age", 40),
                ("occupation", 160),
            ]
        ),
        sa.Column("aliases", JSONB, nullable=False),
        sa.Column("profile_data", JSONB, nullable=False),
        sa.UniqueConstraint("project_id", "id"),
        sa.CheckConstraint("version >= 1"),
    )
    op.create_index("ix_characters_project_id", "characters", ["project_id"])
    op.create_table(
        "character_relationships",
        *common(),
        sa.Column("source_character_id", UUID(as_uuid=True), nullable=False),
        sa.Column("target_character_id", UUID(as_uuid=True), nullable=False),
        *(
            sa.Column(n, sa.String(size), nullable=False)
            for n, size in [
                ("relationship_type", 80),
                ("direction", 20),
                ("description", 4000),
                ("status", 80),
            ]
        ),
        sa.Column("confidence", sa.Float()),
        sa.Column("evidence_refs", JSONB, nullable=False),
        sa.Column("events", JSONB, nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id", "source_character_id"], ["characters.project_id", "characters.id"]
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "target_character_id"], ["characters.project_id", "characters.id"]
        ),
        sa.CheckConstraint("source_character_id <> target_character_id"),
        sa.CheckConstraint("direction IN ('undirected','directed','mutual')"),
        sa.CheckConstraint("version >= 1"),
    )
    for column in ["project_id", "source_character_id", "target_character_id"]:
        op.create_index("ix_character_relationships_" + column, "character_relationships", [column])
    op.create_table(
        "character_graph_layouts",
        *common(),
        sa.Column("node_positions", JSONB, nullable=False),
        sa.Column("viewport", JSONB, nullable=False),
        sa.UniqueConstraint("project_id"),
    )


def downgrade():
    for table in ["character_graph_layouts", "character_relationships", "characters"]:
        op.drop_table(table)
