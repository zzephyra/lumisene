from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from app.modules.storyline.models import PlotState


class PlotRepository:
    async def lock(self, session, project: UUID, story: UUID):
        # Transaction-scoped lock also covers initial state creation and append/reorder races.
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": f"plot:{project}:{story}"},
        )
        await session.execute(
            insert(PlotState)
            .values(project_id=project, story_id=story, version=1)
            .on_conflict_do_nothing()
        )
        return await session.scalar(
            select(PlotState)
            .where(PlotState.project_id == project, PlotState.story_id == story)
            .with_for_update()
        )

    async def rows(self, session, model, project, story, **filters):
        statement = select(model).where(model.project_id == project, model.story_id == story)
        for key, value in filters.items():
            statement = statement.where(getattr(model, key) == value)
        return list(await session.scalars(statement.order_by(model.order_index, model.id)))

    async def get(self, session, model, project, story, identity):
        return await session.scalar(
            select(model).where(
                model.project_id == project, model.story_id == story, model.id == identity
            )
        )
