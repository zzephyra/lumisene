from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class StoryAssetLink(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'story_asset_links'
    __table_args__ = (
        ForeignKeyConstraint(['project_id','story_id'],['stories.project_id','stories.id'],ondelete='CASCADE'),
        ForeignKeyConstraint(['project_id','asset_id'],['assets.project_id','assets.id']),
        CheckConstraint('(upload_id IS NULL) <> (asset_id IS NULL)',name='ck_story_asset_source'),
        CheckConstraint("category IN ('general','scene','shot')",name='ck_story_asset_category'),
        Index(
            "uq_story_asset_upload",
            "story_id",
            "upload_id",
            unique=True,
            postgresql_where=text("upload_id IS NOT NULL"),
        ),
        Index(
            "uq_story_asset_generated",
            "story_id",
            "asset_id",
            unique=True,
            postgresql_where=text("asset_id IS NOT NULL"),
        ),
        Index('ix_story_asset_scope','project_id','story_id','created_at'),
    )
    project_id: Mapped[UUID] = mapped_column(nullable=False)
    story_id: Mapped[UUID] = mapped_column(nullable=False)
    upload_id: Mapped[UUID | None] = mapped_column(ForeignKey('upload_files.id'),nullable=True)
    asset_id: Mapped[UUID | None] = mapped_column(nullable=True)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(20),default='general')
    # Scene identity is validated through Storyline; deletion leaves an explicit stale reference.
    scene_id: Mapped[UUID | None] = mapped_column(nullable=True)
    created_by: Mapped[UUID] = mapped_column(ForeignKey('users.id'))
