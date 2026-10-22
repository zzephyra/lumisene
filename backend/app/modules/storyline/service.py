"""Scoped plot CRUD, validated references and serial, versioned document writes."""

from datetime import UTC, datetime

from sqlalchemy import select

from app.core.errors import NotFoundError, ValidationError, VersionConflictError
from app.modules.storyline.models import Chapter, PlotState, Scene
from app.modules.storyline.repository import PlotRepository
from app.modules.storyline.schemas import ChapterList, ChapterView, SceneList, SceneView


class StorylineService:
    def __init__(self, stories, characters):
        self.stories, self.characters = stories, characters
        self.repo = PlotRepository()

    async def authorize(self, uow, actor, project, story, write=False):
        await self.stories.get(uow, actor, project, story)
        if write:
            await self.stories.projects.authorize_content_write(uow, actor, project)
            return await self.repo.lock(uow.session, project, story)

    async def required(self, uow, model, project, story, identity):
        row = await self.repo.get(uow.session, model, project, story, identity)
        if row is None:
            raise NotFoundError("章节或场景不存在")
        return row

    @staticmethod
    def version(row, expected):
        if row.version != expected:
            raise VersionConflictError("内容已被更新，请保留草稿并重新载入")

    async def production_snapshot(self, uow, actor, project, story):
        """Read a consistent writing snapshot under the same lock used by writers."""
        await self.authorize(uow, actor, project, story)
        await self.repo.lock(uow.session, project, story)
        header = await self.stories.get(uow, actor, project, story)
        chapters = await self.repo.rows(uow.session, Chapter, project, story)
        scenes = await self.repo.rows(uow.session, Scene, project, story)
        return {
            "story": header.model_dump(mode="json"),
            "chapters": [
                {
                    "id": str(c.id),
                    "title": c.title,
                    "summary": c.summary,
                    "version": c.version,
                    "scenes": [
                        SceneView.model_validate(s).model_dump(mode="json")
                        for s in scenes
                        if s.chapter_id == c.id
                    ],
                }
                for c in chapters
            ],
        }

    async def chapters(self, uow, actor, project, story):
        await self.authorize(uow, actor, project, story)
        state = await uow.session.scalar(
            select(PlotState).where(PlotState.project_id == project, PlotState.story_id == story)
        )
        rows = await self.repo.rows(uow.session, Chapter, project, story)
        scenes = await self.repo.rows(uow.session, Scene, project, story)
        return ChapterList(
            version=state.version if state else 1,
            items=[
                ChapterView.model_validate(row).model_copy(
                    update={"scene_count": sum(s.chapter_id == row.id for s in scenes)}
                )
                for row in rows
            ],
        )

    async def scenes(self, uow, actor, project, story, chapter):
        await self.authorize(uow, actor, project, story)
        parent = await self.required(uow, Chapter, project, story, chapter)
        return SceneList(
            version=parent.scenes_version,
            items=[
                SceneView.model_validate(row)
                for row in await self.repo.rows(
                    uow.session, Scene, project, story, chapter_id=chapter
                )
            ],
        )

    async def detail(self, uow, actor, project, story, identity, scene=False):
        await self.authorize(uow, actor, project, story)
        row = await self.required(uow, Scene if scene else Chapter, project, story, identity)
        return (SceneView if scene else ChapterView).model_validate(row)

    async def validate_scene(self, uow, actor, project, story, payload, old=None):
        graph = await self.characters.graph(uow, actor, project, story)
        allowed = {str(c.id) for c in graph.characters}
        # Deleted references may survive unchanged; newly introduced foreign IDs never may.
        old_ids = set(old.character_ids) if old else set()
        old_blocks = {b["id"]: b for b in old.blocks} if old else {}
        if any(str(c) not in allowed | old_ids for c in payload.character_ids):
            raise ValidationError("出场人物必须属于当前剧本")
        for block in payload.blocks:
            if block.character_id and str(block.character_id) not in allowed:
                previous = old_blocks.get(str(block.id), {})
                if previous.get("character_id") != str(block.character_id):
                    raise ValidationError("对白人物必须属于当前剧本")

    async def save(
        self,
        uow,
        actor,
        project,
        story,
        payload,
        identity=None,
        chapter=None,
        scene=False,
        commit=True,
    ):
        state = await self.authorize(uow, actor, project, story, True)
        model = Scene if scene else Chapter
        row = await self.required(uow, model, project, story, identity) if identity else None
        if row:
            self.version(row, payload.expected_version)
        if scene:
            parent = await self.required(
                uow, Chapter, project, story, row.chapter_id if row else chapter
            )
            await self.validate_scene(uow, actor, project, story, payload, row)
        values = payload.model_dump(mode="json", exclude={"expected_version"})
        values["title"] = values["title"].strip()
        if not values["title"]:
            raise ValidationError("标题不能为空")
        if row:
            for key, value in values.items():
                setattr(row, key, value)
            row.version += 1
            row.updated_at = datetime.now(UTC)
        else:
            rows = await self.repo.rows(
                uow.session, model, project, story, **({"chapter_id": chapter} if scene else {})
            )
            if len(rows) >= 300:
                raise ValidationError("当前集合最多 300 项")
            row = model(
                project_id=project,
                story_id=story,
                order_index=max((r.order_index for r in rows), default=-1) + 1,
                version=1,
                **values,
                **({"chapter_id": chapter} if scene else {}),
            )
            uow.session.add(row)
            if scene:
                parent.scenes_version += 1
            else:
                state.version += 1
        await uow.session.flush()
        if commit:
            await uow.commit()
        return (SceneView if scene else ChapterView).model_validate(row)

    async def delete(self, uow, actor, project, story, identity, version, scene=False):
        state = await self.authorize(uow, actor, project, story, True)
        row = await self.required(uow, Scene if scene else Chapter, project, story, identity)
        self.version(row, version)
        if scene:
            parent = await self.required(uow, Chapter, project, story, row.chapter_id)
            parent.scenes_version += 1
        else:
            state.version += 1
        await uow.session.delete(row)
        await uow.commit()

    async def reorder(self, uow, actor, project, story, payload, chapter=None):
        state = await self.authorize(uow, actor, project, story, True)
        parent = await self.required(uow, Chapter, project, story, chapter) if chapter else state
        version = parent.scenes_version if chapter else parent.version
        if payload.expected_version != version:
            raise VersionConflictError("列表已变化，请刷新后重新排序")
        rows = await self.repo.rows(
            uow.session,
            Scene if chapter else Chapter,
            project,
            story,
            **({"chapter_id": chapter} if chapter else {}),
        )
        if len(payload.ids) != len(rows) or set(payload.ids) != {r.id for r in rows}:
            raise ValidationError("排序必须包含当前列表所有项目且不可重复")
        positions = {identity: index for index, identity in enumerate(payload.ids)}
        for row in rows:
            row.order_index = positions[row.id]
        if chapter:
            parent.scenes_version += 1
        else:
            parent.version += 1
        await uow.commit()
