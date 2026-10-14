"""Explicit opt-in publication of generated works."""

import sqlalchemy as sa
from alembic import op

revision = "0019_public_works"
down_revision = "0018_asset_storage_settings"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("assets", sa.Column("published_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(
        "ix_assets_public_author",
        "assets",
        ["created_by", "published_at", "id"],
        postgresql_where=sa.text("published_at IS NOT NULL"),
    )


def downgrade():
    op.drop_index("ix_assets_public_author", table_name="assets")
    op.drop_column("assets", "published_at")
