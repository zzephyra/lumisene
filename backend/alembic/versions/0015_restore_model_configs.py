"""Allow a disabled model config to be enabled again."""

from alembic import op

revision = "0015_restore_model_configs"
down_revision = "0014_generation_inputs"
branch_labels = None
depends_on = None

CURRENT = "action IN ('created', 'disabled', 'assigned', 'unassigned', 'enabled')"
PREVIOUS = "action IN ('created', 'disabled', 'assigned', 'unassigned')"


def upgrade() -> None:
    _replace_check("model_config_audits", "ck_model_config_audits_action", CURRENT)


def downgrade() -> None:
    _replace_check("model_config_audits", "ck_model_config_audits_action", PREVIOUS)


def _replace_check(table: str, name: str, expression: str) -> None:
    op.drop_constraint(name, table, type_="check")
    op.create_check_constraint(name, table, expression)
