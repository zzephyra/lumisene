"""Opt-in work publication; never publishes input files or private task metadata."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select

from app.core.errors import NotFoundError
from app.infrastructure.db.session import UnitOfWork
from app.modules.generation.models import Asset
from app.modules.projects.service import ProjectService


class PublicationService:
    def __init__(self, projects: ProjectService) -> None:
        self.projects = projects

    async def project_works(
        self, uow: UnitOfWork, actor_id: UUID, project_id: UUID, offset: int
    ) -> list[Asset]:
        await self.projects.get_project(uow, actor_id, project_id)
        return list(
            await uow.session.scalars(
                select(Asset)
                .where(
                    Asset.project_id == project_id,
                    Asset.status == "ready",
                    Asset.deleted_at.is_(None),
                    Asset.kind.in_(["IMAGE", "VIDEO"]),
                )
                .order_by(Asset.created_at.desc(), Asset.id.desc())
                .offset(offset)
                .limit(100)
            )
        )

    async def set_public(
        self, uow: UnitOfWork, actor_id: UUID, project_id: UUID, asset_id: UUID, public: bool
    ) -> Asset:
        await self.projects.authorize_content_write(uow, actor_id, project_id)
        asset = await uow.session.scalar(
            select(Asset)
            .where(
                Asset.id == asset_id,
                Asset.project_id == project_id,
                Asset.created_by == actor_id,
                Asset.status == "ready",
                Asset.deleted_at.is_(None),
                Asset.kind.in_(["IMAGE", "VIDEO"]),
            )
            .with_for_update()
        )
        if asset is None:
            raise NotFoundError("Work was not found")
        asset.published_at = (asset.published_at or datetime.now(UTC)) if public else None
        await uow.commit()
        return asset

    async def public_works(
        self,
        uow: UnitOfWork,
        user_id: UUID,
        offset: int,
        kind: str | None = None,
        asset_id: UUID | None = None,
    ) -> list[Asset]:
        await self.projects.auth_service.get_active_user(uow, user_id)
        project_ids = await self.projects.visible_project_ids(uow, user_id)
        stmt = select(Asset).where(
            Asset.created_by == user_id,
            Asset.project_id.in_(project_ids),
            Asset.published_at.is_not(None),
            Asset.status == "ready",
            Asset.deleted_at.is_(None),
            Asset.kind.in_(["IMAGE", "VIDEO"]),
        )
        if asset_id is not None:
            stmt = stmt.where(Asset.id == asset_id)
        if kind is not None:
            stmt = stmt.where(Asset.kind == kind.upper())
        return list(
            await uow.session.scalars(
                stmt.order_by(Asset.published_at.desc(), Asset.id.desc()).offset(offset).limit(24)
            )
        )

    async def public_asset(self, uow: UnitOfWork, user_id: UUID, asset_id: UUID) -> Asset:
        rows = await self.public_works(uow, user_id, 0, asset_id=asset_id)
        if not rows:
            raise NotFoundError("Work was not found")
        return rows[0]
