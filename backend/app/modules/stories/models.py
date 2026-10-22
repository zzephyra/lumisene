"""Project stories. Cover bytes stay in the existing upload record."""

from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Story(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "stories"
    __table_args__ = (
        UniqueConstraint("project_id", "id", name="uq_stories_project_id"),
        CheckConstraint("version >= 1", name="ck_stories_version"),
        CheckConstraint("char_length(title) BETWEEN 1 AND 120", name="ck_stories_title"),
        CheckConstraint(
            "description IS NULL OR char_length(description) BETWEEN 1 AND 4000",
            name="ck_stories_description",
        ),
        Index("ix_stories_project_updated", "project_id", "updated_at", "id"),
    )

    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_upload_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("upload_files.id", ondelete="SET NULL"),
        nullable=True,
    )
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
