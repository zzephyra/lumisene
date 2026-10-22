from datetime import datetime
from uuid import UUID

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.stories.models import Story


class StoryRepository:
    async def get(self, session: AsyncSession, project_id: UUID, story_id: UUID) -> Story | None:
        stmt = select(Story).where(Story.project_id == project_id, Story.id == story_id)
        return (await session.execute(stmt)).scalar_one_or_none()

    async def list_page(
        self,
        session: AsyncSession,
        project_id: UUID,
        *,
        updated_before: datetime | None,
        story_before: UUID | None,
        limit: int,
    ) -> list[Story]:
        stmt = select(Story).where(Story.project_id == project_id)
        if updated_before is not None and story_before is not None:
            stmt = stmt.where(tuple_(Story.updated_at, Story.id) < (updated_before, story_before))
        stmt = stmt.order_by(Story.updated_at.desc(), Story.id.desc()).limit(limit)
        return list((await session.execute(stmt)).scalars().all())
