"""V2 production settings, compatible with existing snapshots and runs."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0031_production_settings"
down_revision = "0030_production"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "productions",
        sa.Column("settings", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )


def downgrade():
    op.drop_column("productions", "settings")
