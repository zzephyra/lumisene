"""Versioned creative skill catalogue; content is data, never executable code."""

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    select,
    text,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.infrastructure.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.infrastructure.db.session import UnitOfWork


class Skill(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "creative_skills"
    __table_args__ = (
        CheckConstraint("version > 0", name="ck_skill_version"),
        Index(
            "uq_skill_runtime_key",
            "runtime_key",
            unique=True,
            postgresql_where=text("deleted_at IS NULL AND runtime_key IS NOT NULL"),
        ),
    )
    runtime_key: Mapped[str | None] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(String(1000))
    content: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    updated_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SkillRevision(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "creative_skill_revisions"
    __table_args__ = (UniqueConstraint("skill_id", "version", name="uq_skill_revision"),)
    skill_id: Mapped[UUID] = mapped_column(ForeignKey("creative_skills.id", ondelete="RESTRICT"))
    runtime_key: Mapped[str | None] = mapped_column(String(120))
    version: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(String(1000))
    content: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean)
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    action: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SkillCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    runtime_key: Literal["image.outpainting"] | None = None
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    content: str = Field(min_length=1, max_length=30000)


class SkillUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    runtime_key: Literal["image.outpainting"] | None = None
    expected_version: int = Field(ge=1, strict=True)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(max_length=1000)
    content: str = Field(min_length=1, max_length=30000)
    enabled: bool = Field(strict=True)


class SkillItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    runtime_key: str | None = None
    slug: str
    name: str
    description: str
    content: str
    enabled: bool
    version: int
    created_at: datetime
    updated_at: datetime


class SkillList(BaseModel):
    items: list[SkillItem]
    total: int


class SkillCatalogue:
    async def list(self, uow: UnitOfWork, q: str, enabled: bool | None, offset: int, limit: int):
        conditions = [Skill.deleted_at.is_(None)]
        if q:
            pattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            conditions.append(Skill.name.ilike(pattern) | Skill.slug.ilike(pattern))
        if enabled is not None:
            conditions.append(Skill.enabled == enabled)
        total = await uow.session.scalar(select(func.count()).select_from(Skill).where(*conditions))
        rows = (
            await uow.session.scalars(
                select(Skill)
                .where(*conditions)
                .order_by(Skill.created_at.desc(), Skill.id.desc())
                .offset(offset)
                .limit(limit)
            )
        ).all()
        return SkillList(items=[SkillItem.model_validate(row) for row in rows], total=total or 0)

    async def get(self, uow: UnitOfWork, skill_id: UUID, *, lock=False):
        stmt = select(Skill).where(Skill.id == skill_id, Skill.deleted_at.is_(None))
        if lock:
            stmt = stmt.with_for_update()
        row = await uow.session.scalar(stmt)
        if row is None:
            raise NotFoundError("Skill not found")
        return row

    async def create(self, uow: UnitOfWork, actor: UUID, data: SkillCreate):
        if data.runtime_key is not None:
            raise ValidationError("旧扩图技能绑定已退役，扩图使用专用模型")
        row = Skill(
            **data.model_dump(), created_by=actor, updated_by=actor, enabled=False, version=1
        )
        uow.session.add(row)
        try:
            await uow.session.flush()
        except IntegrityError as exc:
            await uow.rollback()
            raise ConflictError("技能标识或关联能力已被占用") from exc
        self.record(uow, row, actor, "created")
        try:
            await uow.commit()
        except IntegrityError as exc:
            await uow.rollback()
            raise ConflictError("技能标识或关联能力已被占用") from exc
        return SkillItem.model_validate(row)

    async def update(self, uow: UnitOfWork, actor: UUID, skill_id: UUID, data: SkillUpdate):
        row = await self.get(uow, skill_id, lock=True)
        self.check_version(row, data.expected_version)
        if data.runtime_key is not None and data.runtime_key != row.runtime_key:
            raise ValidationError("旧扩图技能绑定已退役，扩图使用专用模型")
        action = (
            "updated" if row.enabled == data.enabled else "enabled" if data.enabled else "disabled"
        )
        for key, value in data.model_dump(exclude={"expected_version"}, exclude_unset=True).items():
            setattr(row, key, value)
        row.version += 1
        row.updated_by = actor
        row.updated_at = datetime.now(UTC)
        self.record(uow, row, actor, action)
        try:
            await uow.commit()
        except IntegrityError as exc:
            await uow.rollback()
            raise ConflictError("技能标识或关联能力已被占用") from exc
        return SkillItem.model_validate(row)

    async def delete(self, uow: UnitOfWork, actor: UUID, skill_id: UUID, expected_version: int):
        row = await self.get(uow, skill_id, lock=True)
        self.check_version(row, expected_version)
        row.deleted_at = row.updated_at = datetime.now(UTC)
        row.enabled = False
        row.version += 1
        row.updated_by = actor
        self.record(uow, row, actor, "deleted")
        await uow.commit()

    @staticmethod
    def check_version(row, version):
        if row.version != version:
            raise ConflictError("技能已被其他管理员修改，请刷新后重试")

    @staticmethod
    def record(uow, row, actor, action):
        uow.session.add(
            SkillRevision(
                skill_id=row.id,
                runtime_key=row.runtime_key,
                version=row.version,
                name=row.name,
                description=row.description,
                content=row.content,
                enabled=row.enabled,
                actor_id=actor,
                action=action,
            )
        )
