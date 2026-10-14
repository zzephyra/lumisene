from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy.exc import IntegrityError

from app.core.errors import (
    AuthorizationError,
    ConflictError,
    DomainError,
    NotFoundError,
    VersionConflictError,
)
from app.core.logging import get_logger
from app.infrastructure.db.session import UnitOfWork
from app.infrastructure.outbox.models import OutboxEvent
from app.infrastructure.outbox.repository import OutboxRepository
from app.modules.auth.service import AuthService
from app.modules.projects.domain import (
    PERSONAL_SPACE_NAME,
    PROJECT_DELETED_EVENT,
    PROJECT_DELETED_SCHEMA_VERSION,
    ProjectKind,
    ProjectRole,
    decode_cursor,
    encode_cursor,
    normalize_limit,
    normalize_project_name,
)
from app.modules.projects.models import Project, ProjectMember
from app.modules.projects.repository import ProjectRepository

logger = get_logger(__name__)


@dataclass(frozen=True)
class ProjectView:
    id: UUID
    name: str
    role: str
    kind: str
    version: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class MemberView:
    user_id: UUID
    email: str
    role: str


@dataclass(frozen=True)
class ProjectPage:
    items: list[ProjectView]
    next_cursor: str | None


@dataclass(frozen=True)
class MemberPage:
    items: list[MemberView]
    next_cursor: str | None


class ProjectService:
    def __init__(
        self,
        auth_service: AuthService,
        repository: ProjectRepository | None = None,
        outbox: OutboxRepository | None = None,
    ) -> None:
        self.auth_service = auth_service
        self.repository = repository or ProjectRepository()
        self.outbox = outbox or OutboxRepository()

    async def create_project(self, uow: UnitOfWork, actor_id: UUID, name: str) -> ProjectView:
        project = Project(
            id=uuid4(),
            name=normalize_project_name(name),
            kind=ProjectKind.STANDARD,
            created_by=actor_id,
            version=1,
        )
        member = ProjectMember(
            id=uuid4(),
            project_id=project.id,
            user_id=actor_id,
            role=ProjectRole.OWNER,
        )
        await self.repository.add_project(uow.session, project)
        await self.repository.add_member(uow.session, member)
        await uow.session.flush()
        await uow.session.refresh(project)
        await uow.commit()
        logger.info("project_created", project_id=str(project.id), user_id=str(actor_id))
        return _project_view(project, member.role)

    async def ensure_personal_space(self, uow: UnitOfWork, actor_id: UUID) -> ProjectView:
        for _ in range(2):
            existing = await self.repository.get_personal_for_owner(uow.session, actor_id)
            if existing is not None:
                project, member = existing
                return _project_view(project, member.role)
            project = Project(
                id=uuid4(),
                name=PERSONAL_SPACE_NAME,
                kind=ProjectKind.PERSONAL,
                created_by=actor_id,
                version=1,
            )
            member = ProjectMember(
                id=uuid4(),
                project_id=project.id,
                user_id=actor_id,
                role=ProjectRole.OWNER,
            )
            await self.repository.add_project(uow.session, project)
            await self.repository.add_member(uow.session, member)
            try:
                await uow.session.flush()
                await uow.session.refresh(project)
                await uow.commit()
            except IntegrityError:
                await uow.rollback()
                continue
            logger.info("personal_space_created", project_id=str(project.id), user_id=str(actor_id))
            return _project_view(project, member.role)
        existing = await self.repository.get_personal_for_owner(uow.session, actor_id)
        if existing is None:
            raise ConflictError("Personal space could not be created")
        project, member = existing
        return _project_view(project, member.role)

    async def visible_project_ids(self, uow: UnitOfWork, actor_id: UUID) -> list[UUID]:
        """Scope opt-in public works to projects the author still belongs to."""
        return await self.repository.visible_project_ids(uow.session, actor_id)

    async def list_projects(
        self,
        uow: UnitOfWork,
        actor_id: UUID,
        *,
        limit: int,
        cursor: str | None,
    ) -> ProjectPage:
        page_limit = normalize_limit(limit)
        position = _cursor(cursor)
        rows = await self.repository.list_for_user(
            uow.session,
            actor_id,
            cursor=position,
            limit=page_limit + 1,
        )
        visible = rows[:page_limit]
        next_cursor = None
        if len(rows) > page_limit and visible:
            last = visible[-1][0]
            next_cursor = encode_cursor(last.created_at, last.id)
        return ProjectPage(
            items=[_project_view(project, role) for project, role in visible],
            next_cursor=next_cursor,
        )

    async def get_project(self, uow: UnitOfWork, actor_id: UUID, project_id: UUID) -> ProjectView:
        project, membership = await self._require_visible(uow, actor_id, project_id, lock=False)
        return _project_view(project, membership.role)

    async def authorize_content_write(
        self, uow: UnitOfWork, actor_id: UUID, project_id: UUID
    ) -> None:
        """Hold project lock until caller commits, serializing member removal/deletion."""
        await self._require_visible(uow, actor_id, project_id, lock=True)
        await self.auth_service.get_active_user(uow, actor_id)

    async def update_project(
        self,
        uow: UnitOfWork,
        actor_id: UUID,
        project_id: UUID,
        *,
        name: str,
        expected_version: int,
    ) -> ProjectView:
        project, membership = await self._require_visible(uow, actor_id, project_id, lock=True)
        _require_owner(membership.role)
        if project.version != expected_version:
            raise VersionConflictError(
                "The project was updated by someone else",
                details={"current_version": project.version},
            )
        cleaned = normalize_project_name(name)
        if project.name != cleaned:
            project.name = cleaned
            project.version += 1
            project.updated_at = datetime.now(UTC)
            await uow.session.flush()
            await uow.session.refresh(project)
        await uow.commit()
        return _project_view(project, membership.role)

    async def delete_project(self, uow: UnitOfWork, actor_id: UUID, project_id: UUID) -> None:
        project = await self.repository.get_for_update(uow.session, project_id)
        if project is None:
            raise NotFoundError("Project was not found")
        membership = await self.repository.get_member(uow.session, project_id, actor_id)
        if project.deleted_at is not None:
            if membership is not None and membership.role == ProjectRole.OWNER:
                return
            raise NotFoundError("Project was not found")
        if membership is None:
            raise NotFoundError("Project was not found")
        _require_owner(membership.role)
        project.deleted_at = datetime.now(UTC)
        project.version += 1
        await uow.session.flush()
        await self.outbox.add(
            uow.session,
            OutboxEvent(
                event_id=uuid4(),
                project_id=project.id,
                aggregate_type="project",
                aggregate_id=project.id,
                aggregate_version=project.version,
                event_type=PROJECT_DELETED_EVENT,
                schema_version=PROJECT_DELETED_SCHEMA_VERSION,
                payload={"project_id": str(project.id), "version": project.version},
            ),
        )
        await uow.session.flush()
        await uow.commit()
        logger.info("project_deleted", project_id=str(project.id), user_id=str(actor_id))

    async def list_members(
        self,
        uow: UnitOfWork,
        actor_id: UUID,
        project_id: UUID,
        *,
        limit: int,
        cursor: str | None,
    ) -> MemberPage:
        await self._require_visible(uow, actor_id, project_id, lock=False)
        page_limit = normalize_limit(limit)
        position = _cursor(cursor)
        rows = await self.repository.list_members(
            uow.session,
            project_id,
            cursor=position,
            limit=page_limit + 1,
        )
        visible = rows[:page_limit]
        users = await self.auth_service.get_users_by_ids(
            uow,
            [member.user_id for member in visible],
        )
        items: list[MemberView] = []
        for member in visible:
            user = users.get(member.user_id)
            if user is None:
                raise RuntimeError("membership user is missing")
            items.append(MemberView(user_id=member.user_id, email=user.email, role=member.role))
        next_cursor = None
        if len(rows) > page_limit and visible:
            last = visible[-1]
            next_cursor = encode_cursor(last.created_at, last.id)
        return MemberPage(items=items, next_cursor=next_cursor)

    async def add_member(
        self,
        uow: UnitOfWork,
        actor_id: UUID,
        project_id: UUID,
        user_id: UUID,
    ) -> MemberView:
        _project, membership = await self._require_visible(uow, actor_id, project_id, lock=True)
        _require_owner(membership.role)
        user = await self.auth_service.get_active_user(uow, user_id)
        existing = await self.repository.get_member(uow.session, project_id, user_id)
        if existing is not None:
            raise DomainError("User is already a member")
        member = ProjectMember(
            id=uuid4(),
            project_id=project_id,
            user_id=user_id,
            role=ProjectRole.MEMBER,
        )
        await self.repository.add_member(uow.session, member)
        try:
            await uow.session.flush()
            await uow.commit()
        except IntegrityError as exc:
            await uow.rollback()
            raise DomainError("User is already a member") from exc
        logger.info(
            "project_member_added",
            project_id=str(project_id),
            user_id=str(actor_id),
        )
        return MemberView(user_id=user.id, email=user.email, role=member.role)

    async def remove_member(
        self,
        uow: UnitOfWork,
        actor_id: UUID,
        project_id: UUID,
        user_id: UUID,
    ) -> None:
        _project, membership = await self._require_visible(uow, actor_id, project_id, lock=True)
        _require_owner(membership.role)
        target = await self.repository.get_member(uow.session, project_id, user_id)
        if target is None:
            raise NotFoundError("Member was not found")
        if target.role == ProjectRole.OWNER:
            raise DomainError("The owner cannot be removed")
        await self.repository.delete_member(uow.session, target)
        await uow.session.flush()
        await uow.commit()
        logger.info(
            "project_member_removed",
            project_id=str(project_id),
            user_id=str(actor_id),
        )

    async def _require_visible(
        self,
        uow: UnitOfWork,
        actor_id: UUID,
        project_id: UUID,
        *,
        lock: bool,
    ) -> tuple[Project, ProjectMember]:
        project = await (
            self.repository.get_for_update(uow.session, project_id)
            if lock
            else self.repository.get(uow.session, project_id)
        )
        if project is None or project.deleted_at is not None:
            raise NotFoundError("Project was not found")
        membership = await self.repository.get_member(uow.session, project_id, actor_id)
        if membership is None:
            raise NotFoundError("Project was not found")
        return project, membership


def _require_owner(role: str) -> None:
    if role != ProjectRole.OWNER:
        raise AuthorizationError("You cannot perform this action")


def _cursor(value: str | None):
    if value is None or value == "":
        return None
    return decode_cursor(value)


def _project_view(project: Project, role: str) -> ProjectView:
    return ProjectView(
        id=project.id,
        name=project.name,
        role=role,
        kind=project.kind,
        version=project.version,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )
