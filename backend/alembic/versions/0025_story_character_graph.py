"""Scope character graphs, documents and analysis to one story."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0025_story_character_graph"
down_revision = "0024_stories"
branch_labels = None
depends_on = None


def upgrade():
    # Rows created before stories have no owner. They cannot appear inside a story.
    for table in (
        "character_relationships",
        "character_evidence",
        "character_analysis_jobs",
        "script_segments",
        "script_documents",
        "character_graph_layouts",
        "characters",
    ):
        op.execute(f"DELETE FROM {table}")
    for table in (
        "characters",
        "character_relationships",
        "character_graph_layouts",
        "script_documents",
        "character_analysis_jobs",
    ):
        op.add_column(table, sa.Column("story_id", UUID(as_uuid=True), nullable=False))
        op.create_foreign_key(
            f"fk_{table}_story",
            table,
            "stories",
            ["project_id", "story_id"],
            ["project_id", "id"],
        )
        op.create_index(f"ix_{table}_story_id", table, ["story_id"])
    op.drop_constraint("character_graph_layouts_project_id_key", "character_graph_layouts")
    op.create_unique_constraint(
        "uq_character_graph_layouts_story", "character_graph_layouts", ["project_id", "story_id"]
    )
    op.drop_constraint("script_documents_project_id_checksum_key", "script_documents")
    op.create_unique_constraint(
        "uq_script_documents_story_checksum",
        "script_documents",
        ["project_id", "story_id", "checksum"],
    )
    op.drop_constraint(
        "character_analysis_jobs_project_id_actor_id_idempotency_key_key",
        "character_analysis_jobs",
    )
    op.create_unique_constraint(
        "uq_character_analysis_jobs_story_actor_key",
        "character_analysis_jobs",
        ["project_id", "story_id", "actor_id", "idempotency_key"],
    )


def downgrade():
    op.drop_constraint(
        "uq_character_analysis_jobs_story_actor_key", "character_analysis_jobs", type_="unique"
    )
    op.create_unique_constraint(
        "character_analysis_jobs_project_id_actor_id_idempotency_key_key",
        "character_analysis_jobs",
        ["project_id", "actor_id", "idempotency_key"],
    )
    op.drop_constraint("uq_script_documents_story_checksum", "script_documents", type_="unique")
    op.create_unique_constraint(
        "script_documents_project_id_checksum_key", "script_documents", ["project_id", "checksum"]
    )
    op.drop_constraint(
        "uq_character_graph_layouts_story", "character_graph_layouts", type_="unique"
    )
    op.create_unique_constraint(
        "character_graph_layouts_project_id_key", "character_graph_layouts", ["project_id"]
    )
    for table in (
        "character_analysis_jobs",
        "script_documents",
        "character_graph_layouts",
        "character_relationships",
        "characters",
    ):
        op.drop_index(f"ix_{table}_story_id", table_name=table)
        op.drop_constraint(f"fk_{table}_story", table, type_="foreignkey")
        op.drop_column(table, "story_id")
