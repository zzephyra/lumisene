from datetime import UTC, datetime
from uuid import UUID

from app.core.errors import NotFoundError, ValidationError, VersionConflictError
from app.infrastructure.db.session import UnitOfWork
from app.modules.projects.domain import decode_cursor, encode_cursor, normalize_limit
from app.modules.projects.service import ProjectService
from app.modules.stories.models import Story
from app.modules.stories.repository import StoryRepository
from app.modules.stories.schemas import StoryInput, StoryPage, StoryUpdate, StoryView
from app.modules.uploads.service import UploadService


class StoryService:
    def __init__(self, projects: ProjectService, uploads: UploadService):
        self.projects = projects
        self.uploads = uploads
        self.repo = StoryRepository()

    async def list_stories(
        self,
        uow: UnitOfWork,
        actor: UUID,
        project: UUID,
        *,
        limit: int,
        cursor: str | None,
    ) -> StoryPage:
        await self.projects.get_project(uow, actor, project)
        page_limit = normalize_limit(limit)
        position = decode_cursor(cursor) if cursor else None
        rows = await self.repo.list_page(
            uow.session,
            project,
            updated_before=position.created_at if position else None,
            story_before=position.entity_id if position else None,
            limit=page_limit + 1,
        )
        visible = rows[:page_limit]
        covers = await self.uploads.cover_urls(
            uow.session, {row.cover_upload_id for row in visible if row.cover_upload_id}
        )
        next_cursor = None
        if len(rows) > page_limit and visible:
            last = visible[-1]
            next_cursor = encode_cursor(last.updated_at, last.id)
        return StoryPage(
            items=[self._view(row, covers) for row in visible],
            next_cursor=next_cursor,
        )

    async def get(self, uow: UnitOfWork, actor: UUID, project: UUID, story_id: UUID) -> StoryView:
        await self.projects.get_project(uow, actor, project)
        row = await self.repo.get(uow.session, project, story_id)
        if row is None:
            raise NotFoundError("剧本不存在")
        covers = await self.uploads.cover_urls(
            uow.session, {row.cover_upload_id} if row.cover_upload_id else set()
        )
        return self._view(row, covers)

    async def create(
        self, uow: UnitOfWork, actor: UUID, project: UUID, payload: StoryInput
    ) -> StoryView:
        await self.projects.authorize_content_write(uow, actor, project)
        title, description = self._text(payload)
        cover = await self._cover(uow, actor, payload.cover_upload_id)
        now = datetime.now(UTC)
        row = Story(
            project_id=project,
            title=title,
            description=description,
            cover_upload_id=cover,
            version=1,
            created_at=now,
            updated_at=now,
        )
        uow.session.add(row)
        await uow.session.flush()
        await uow.commit()
        covers = {cover: await self._url(uow, cover)} if cover else {}
        return self._view(row, covers)

    async def update(
        self,
        uow: UnitOfWork,
        actor: UUID,
        project: UUID,
        story_id: UUID,
        payload: StoryUpdate,
    ) -> StoryView:
        await self.projects.authorize_content_write(uow, actor, project)
        row = await self.repo.get(uow.session, project, story_id)
        if row is None:
            raise NotFoundError("剧本不存在")
        if row.version != payload.expected_version:
            raise VersionConflictError("剧本已被更新，请保留草稿并重新载入")
        title, description = self._text(payload)
        cover = await self._cover(uow, actor, payload.cover_upload_id)
        row.title = title
        row.description = description
        row.cover_upload_id = cover
        row.version += 1
        row.updated_at = datetime.now(UTC)
        await uow.session.flush()
        await uow.commit()
        covers = {cover: await self._url(uow, cover)} if cover else {}
        return self._view(row, covers)

    async def delete(
        self, uow: UnitOfWork, actor: UUID, project: UUID, story_id: UUID, version: int
    ) -> None:
        await self.projects.authorize_content_write(uow, actor, project)
        row = await self.repo.get(uow.session, project, story_id)
        if row is None:
            raise NotFoundError("剧本不存在")
        if row.version != version:
            raise VersionConflictError("剧本已被更新，请刷新后重试")
        await uow.session.delete(row)
        await uow.commit()

    async def _cover(self, uow: UnitOfWork, actor: UUID, upload_id: UUID | None) -> UUID | None:
        if upload_id is None:
            return None
        upload = await self.uploads.owned_image(uow.session, actor, upload_id)
        return upload.id

    async def _url(self, uow: UnitOfWork, upload_id: UUID | None) -> str | None:
        if upload_id is None:
            return None
        return (await self.uploads.cover_urls(uow.session, {upload_id})).get(upload_id)

    def _text(self, payload: StoryInput) -> tuple[str, str | None]:
        title = payload.title.strip()
        if not 1 <= len(title) <= 120:
            raise ValidationError("剧本名称需要 1 到 120 个字符")
        description = payload.description.strip() if payload.description else None
        if description == "":
            description = None
        if description is not None and len(description) > 4000:
            raise ValidationError("剧本介绍不能超过 4000 个字符")
        return title, description

    def _view(self, row: Story, covers: dict[UUID, str | None]) -> StoryView:
        return StoryView(
            id=row.id,
            project_id=row.project_id,
            title=row.title,
            description=row.description,
            cover_upload_id=row.cover_upload_id,
            cover_url=covers.get(row.cover_upload_id) if row.cover_upload_id else None,
            version=row.version,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
