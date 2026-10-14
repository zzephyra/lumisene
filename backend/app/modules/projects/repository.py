from uuid import UUID

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.projects.domain import PageCursor
from app.modules.projects.models import Project, ProjectMember


class ProjectRepository:
    async def add_project(self, session: AsyncSession, project: Project) -> None:
        session.add(project)

    async def add_member(self, session: AsyncSession, member: ProjectMember) -> None:
        session.add(member)

    async def get(self, session: AsyncSession, project_id: UUID) -> Project | None:
        stmt = select(Project).where(Project.id == project_id)
        return (await session.execute(stmt)).scalar_one_or_none()

    async def get_for_update(self, session: AsyncSession, project_id: UUID) -> Project | None:
        stmt = select(Project).where(Project.id == project_id).with_for_update()
        return (await session.execute(stmt)).scalar_one_or_none()

    async def get_member(
        self,
        session: AsyncSession,
        project_id: UUID,
        user_id: UUID,
    ) -> ProjectMember | None:
        stmt = select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
        return (await session.execute(stmt)).scalar_one_or_none()

    async def visible_project_ids(self, session: AsyncSession, user_id: UUID) -> list[UUID]:
        stmt = (
            select(Project.id)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(ProjectMember.user_id == user_id, Project.deleted_at.is_(None))
        )
        return list(await session.scalars(stmt))

    async def list_for_user(
        self,
        session: AsyncSession,
        user_id: UUID,
        *,
        cursor: PageCursor | None,
        limit: int,
    ) -> list[tuple[Project, str]]:
        stmt = (
            select(Project, ProjectMember.role)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(ProjectMember.user_id == user_id, Project.deleted_at.is_(None))
            .order_by(Project.created_at.desc(), Project.id.desc())
            .limit(limit)
        )
        if cursor is not None:
            stmt = stmt.where(
                tuple_(Project.created_at, Project.id) < tuple_(cursor.created_at, cursor.entity_id)
            )
        rows = (await session.execute(stmt)).all()
        return [(project, role) for project, role in rows]

    async def get_personal_for_owner(
        self,
        session: AsyncSession,
        user_id: UUID,
    ) -> tuple[Project, ProjectMember] | None:
        stmt = (
            select(Project, ProjectMember)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(
                Project.created_by == user_id,
                Project.kind == "personal",
                Project.deleted_at.is_(None),
                ProjectMember.user_id == user_id,
            )
        )
        row = (await session.execute(stmt)).one_or_none()
        if row is None:
            return None
        project, member = row
        return project, member

    async def list_members(
        self,
        session: AsyncSession,
        project_id: UUID,
        *,
        cursor: PageCursor | None,
        limit: int,
    ) -> list[ProjectMember]:
        stmt = (
            select(ProjectMember)
            .where(ProjectMember.project_id == project_id)
            .order_by(ProjectMember.created_at.desc(), ProjectMember.id.desc())
            .limit(limit)
        )
        if cursor is not None:
            stmt = stmt.where(
                tuple_(ProjectMember.created_at, ProjectMember.id)
                < tuple_(cursor.created_at, cursor.entity_id)
            )
        return list((await session.execute(stmt)).scalars().all())

    async def delete_member(self, session: AsyncSession, member: ProjectMember) -> None:
        await session.delete(member)
