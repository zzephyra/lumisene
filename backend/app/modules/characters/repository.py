from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.characters.models import GraphLayout


class CharacterRepository:
    async def rows(self, session: AsyncSession, model, project_id: UUID, story_id: UUID):
        return list(
            await session.scalars(
                select(model)
                .where(model.project_id == project_id, model.story_id == story_id)
                .order_by(model.id)
                .limit(1001)
            )
        )

    async def get(
        self, session: AsyncSession, model, project_id: UUID, story_id: UUID, identity: UUID
    ):
        return await session.scalar(
            select(model)
            .where(
                model.project_id == project_id,
                model.story_id == story_id,
                model.id == identity,
            )
            .with_for_update()
        )

    async def layout(self, session: AsyncSession, project_id: UUID, story_id: UUID):
        return await session.scalar(
            select(GraphLayout)
            .where(GraphLayout.project_id == project_id, GraphLayout.story_id == story_id)
            .with_for_update()
        )
