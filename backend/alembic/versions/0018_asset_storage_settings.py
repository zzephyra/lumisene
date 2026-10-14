"""Store generated works with a provider, and keep deletion policy in PostgreSQL."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0018_asset_storage_settings"
down_revision = "0017_skill_runtime_binding"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "assets",
        sa.Column("storage_provider", sa.String(16), nullable=False, server_default="s3"),
    )
    op.add_column("assets", sa.Column("bucket", sa.String(128), nullable=False, server_default=""))
    op.add_column("assets", sa.Column("duration_ms", sa.Integer(), nullable=True))
    op.add_column("assets", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("assets", sa.Column("deleted_by", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("assets", sa.Column("purge_status", sa.String(16), nullable=True))
    op.create_check_constraint(
        "ck_assets_storage_provider",
        "assets",
        "storage_provider IN ('s3', 'qiniu')",
    )
    op.create_check_constraint(
        "ck_assets_purge_status",
        "assets",
        "purge_status IS NULL OR purge_status IN ('pending', 'failed', 'purged')",
    )
    op.create_foreign_key("fk_assets_deleted_by", "assets", "users", ["deleted_by"], ["id"])
    op.create_table(
        "asset_purge_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("object_key", sa.String(512), nullable=False),
        sa.Column("storage_provider", sa.String(16), nullable=False),
        sa.Column("bucket", sa.String(128), nullable=False),
        sa.Column("policy", sa.String(32), nullable=False),
        sa.Column("settings_revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.UniqueConstraint("asset_id", name="uq_asset_purge_jobs_asset"),
        sa.CheckConstraint("status IN ('pending', 'failed', 'purged')", name="ck_asset_purge_jobs_status"),
        sa.CheckConstraint(
            "policy IN ('retain_cloud_file', 'delete_cloud_file')",
            name="ck_asset_purge_jobs_policy",
        ),
    )
    op.create_table(
        "system_settings",
        sa.Column("namespace", sa.String(64), primary_key=True),
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", postgresql.JSONB(), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
        sa.UniqueConstraint("namespace", "key", name="uq_system_settings_key"),
    )
    op.create_table(
        "system_setting_audits",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("namespace", sa.String(64), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("previous_value", postgresql.JSONB(), nullable=True),
        sa.Column("current_value", postgresql.JSONB(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"]),
    )
    op.create_table(
        "system_setting_initializations",
        sa.Column("schema_version", sa.Integer(), primary_key=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "system_setting_publications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade():
    op.drop_table("system_setting_publications")
    op.drop_table("system_setting_initializations")
    op.drop_table("system_setting_audits")
    op.drop_table("system_settings")
    op.drop_table("asset_purge_jobs")
    op.drop_constraint("fk_assets_deleted_by", "assets", type_="foreignkey")
    op.drop_constraint("ck_assets_purge_status", "assets", type_="check")
    op.drop_constraint("ck_assets_storage_provider", "assets", type_="check")
    op.drop_column("assets", "purge_status")
    op.drop_column("assets", "deleted_by")
    op.drop_column("assets", "deleted_at")
    op.drop_column("assets", "duration_ms")
    op.drop_column("assets", "bucket")
    op.drop_column("assets", "storage_provider")
