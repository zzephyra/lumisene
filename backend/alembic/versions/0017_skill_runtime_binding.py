"""Bind the existing catalogue to executable product capabilities."""

import sqlalchemy as sa
from alembic import op

revision = "0017_skill_runtime_binding"
down_revision = "0016_creative_skills"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("creative_skills", sa.Column("runtime_key", sa.String(120), nullable=True))
    op.add_column(
        "creative_skill_revisions", sa.Column("runtime_key", sa.String(120), nullable=True)
    )
    op.create_index(
        "uq_skill_runtime_key",
        "creative_skills",
        ["runtime_key"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL AND runtime_key IS NOT NULL"),
    )


def downgrade():
    op.drop_index("uq_skill_runtime_key", table_name="creative_skills")
    op.drop_column("creative_skill_revisions", "runtime_key")
    op.drop_column("creative_skills", "runtime_key")
