from uuid import UUID

from sqlalchemy import select

from app.core.errors import NotFoundError, ValidationError, VersionConflictError
from app.infrastructure.db.session import UnitOfWork
from app.modules.characters.models import (
    Character,
    CharacterImage,
    CharacterRelationship,
    ExtractionEvidence,
    GraphLayout,
    ScriptDocument,
    ScriptSegment,
)
from app.modules.characters.repository import CharacterRepository
from app.modules.characters.schemas import (
    CharacterSummary,
    GraphView,
    LayoutInput,
    LayoutView,
    RelationshipView,
)
from app.modules.projects.service import ProjectService
from app.modules.stories.service import StoryService


class CharacterService:
    def __init__(self, projects: ProjectService, stories: StoryService):
        self.projects, self.stories, self.repo = projects, stories, CharacterRepository()

    async def graph(self, uow: UnitOfWork, actor: UUID, project: UUID, story: UUID) -> GraphView:
        await self.stories.get(uow, actor, project, story)
        characters = await self.repo.rows(uow.session, Character, project, story)
        relationships = await self.repo.rows(uow.session, CharacterRelationship, project, story)
        if len(characters) > 1000 or len(relationships) > 1000:
            raise ValidationError("图谱超过当前 1000 个对象的显示上限")
        layout = await self.repo.layout(uow.session, project, story)
        avatars = await self.primary_urls(uow, characters)
        return GraphView(
            characters=[
                CharacterSummary.model_validate(c).model_copy(
                    update={"avatar_url": avatars.get(c.id)}
                )
                for c in characters
            ],
            relationships=[RelationshipView.model_validate(r) for r in relationships],
            layout=LayoutView.model_validate(layout) if layout else LayoutView(),
        )

    async def get(self, uow, actor, project, story, identity, *, relationship=False):
        await self.stories.get(uow, actor, project, story)
        row = await self.repo.get(
            uow.session,
            CharacterRelationship if relationship else Character,
            project,
            story,
            identity,
        )
        if row is None:
            raise NotFoundError("人物或关系不存在")
        if not relationship:
            await self._avatar_url(uow, row)
        return row

    async def save(self, uow, actor, project, story, payload, identity=None, *, relationship=False):
        await self.projects.authorize_content_write(uow, actor, project)
        await self.stories.get(uow, actor, project, story)
        model = CharacterRelationship if relationship else Character
        if relationship:
            if payload.source_character_id == payload.target_character_id:
                raise ValidationError("不能创建人物与自己的关系")
            for endpoint in (payload.source_character_id, payload.target_character_id):
                if await self.repo.get(uow.session, Character, project, story, endpoint) is None:
                    raise NotFoundError("关系人物不属于当前剧本")
        values = payload.model_dump(mode="json", exclude={"expected_version"})
        if relationship:
            values["source_character_id"] = payload.source_character_id
            values["target_character_id"] = payload.target_character_id
        if not relationship:
            values["avatar_upload_id"] = payload.avatar_upload_id
        if identity:
            row = await self.repo.get(uow.session, model, project, story, identity)
            if row is None:
                raise NotFoundError("人物或关系不存在")
            if row.version != payload.expected_version:
                raise VersionConflictError(
                    "内容已被更新，请保留草稿并重新载入", details={"current_version": row.version}
                )
            if not relationship:
                values.pop("avatar_upload_id", None)
                self._mark_user_changes(values["profile_data"], row.profile_data)
            await self._validate_evidence(uow, project, story, values, relationship)
            for key, value in values.items():
                setattr(row, key, value)
            row.version += 1
        else:
            if len(await self.repo.rows(uow.session, model, project, story)) >= 1000:
                raise ValidationError("已达到当前图谱容量限制")
            if not relationship:
                if payload.avatar_upload_id:
                    await self.stories.uploads.owned_image(
                        uow.session, actor, payload.avatar_upload_id
                    )
                self._mark_user_changes(values["profile_data"], {})
            await self._validate_evidence(uow, project, story, values, relationship)
            row = model(project_id=project, story_id=story, **values, version=1)
            uow.session.add(row)
        await uow.session.flush()
        if not relationship and not identity and row.avatar_upload_id:
            uow.session.add(
                CharacterImage(
                    project_id=project,
                    character_id=row.id,
                    upload_id=row.avatar_upload_id,
                    is_primary=True,
                )
            )
        await uow.commit()
        if not relationship:
            await self._avatar_url(uow, row)
        return row

    async def primary_urls(self, uow, characters):
        if not characters:
            return {}
        images = list(
            await uow.session.scalars(
                select(CharacterImage).where(
                    CharacterImage.character_id.in_([c.id for c in characters]),
                    CharacterImage.is_primary.is_(True),
                )
            )
        )
        urls = await self.stories.uploads.cover_urls(
            uow.session, {r.upload_id for r in images if r.upload_id}
        )
        return {
            r.character_id: urls.get(r.upload_id)
            if r.upload_id
            else f"/api/v1/projects/{r.project_id}/assets/{r.asset_id}/content"
            for r in images
        }

    async def _avatar_url(self, uow: UnitOfWork, row: Character) -> None:
        row.avatar_url = (await self.primary_urls(uow, [row])).get(row.id)

    async def delete(self, uow, actor, project, story, identity, version, *, relationship=False):
        await self.projects.authorize_content_write(uow, actor, project)
        row = await self.get(uow, actor, project, story, identity, relationship=relationship)
        if row.version != version:
            raise VersionConflictError("内容已更新，请刷新后重试")
        if not relationship:
            for edge in await self.repo.rows(uow.session, CharacterRelationship, project, story):
                if identity in (edge.source_character_id, edge.target_character_id):
                    await uow.session.delete(edge)
            await uow.session.flush()
            layout = await self.repo.layout(uow.session, project, story)
            if layout:
                layout.node_positions = {
                    k: v for k, v in layout.node_positions.items() if k != str(identity)
                }
                layout.version += 1
        await uow.session.delete(row)
        await uow.commit()

    async def layout(self, uow, actor, project, story, payload: LayoutInput):
        await self.projects.authorize_content_write(uow, actor, project)
        await self.stories.get(uow, actor, project, story)
        identities = {c.id for c in await self.repo.rows(uow.session, Character, project, story)}
        if not set(payload.node_positions).issubset(identities):
            raise ValidationError("布局包含不存在的人物")
        row = await self.repo.layout(uow.session, project, story)
        if (row.version if row else 0) != payload.expected_version:
            raise VersionConflictError("布局已更新，请重新载入")
        if row is None:
            row = GraphLayout(project_id=project, story_id=story, version=0)
            uow.session.add(row)
        row.node_positions = {str(k): v.model_dump() for k, v in payload.node_positions.items()}
        row.viewport = payload.viewport.model_dump()
        row.version += 1
        await uow.commit()
        return row

    @staticmethod
    def _mark_user_changes(profile, previous):
        for group, facts in profile.items():
            if not isinstance(facts, dict):
                continue
            for field, fact in facts.items():
                old = previous.get(group, {}).get(field)
                if old and old.get("value") == fact["value"]:
                    facts[field] = old
                else:
                    fact.update(source_type="user", review_status="confirmed", confidence=None)

    @staticmethod
    async def _validate_evidence(uow, project, story, values, relationship):
        refs = []
        if relationship:
            refs.extend(values.get("evidence_refs", []))
            for event in values.get("events", []):
                refs.extend(event.get("evidence_refs", []))
        else:
            for group in values["profile_data"].values():
                if isinstance(group, dict):
                    for fact in group.values():
                        refs.extend(fact.get("evidence_refs", []))
        ids = {UUID(ref) for ref in refs}
        if ids:
            existing = set(
                await uow.session.scalars(
                    select(ExtractionEvidence.id)
                    .join(ScriptSegment, ScriptSegment.id == ExtractionEvidence.segment_id)
                    .join(ScriptDocument, ScriptDocument.id == ScriptSegment.document_id)
                    .where(
                        ExtractionEvidence.project_id == project,
                        ScriptDocument.story_id == story,
                        ExtractionEvidence.id.in_(ids),
                    )
                )
            )
            if ids != existing:
                raise ValidationError("证据不属于当前项目或已不存在")

    async def storyline_context(self, uow, actor, project, story):
        """Bounded actual character attributes for plot authoring, never media bytes."""
        await self.stories.get(uow, actor, project, story)
        characters = await self.repo.rows(uow.session, Character, project, story)
        relationships = await self.repo.rows(uow.session, CharacterRelationship, project, story)
        return {
            "characters": [
                {
                    "id": str(c.id),
                    "name": c.name,
                    "age": c.age,
                    "occupation": c.occupation,
                    "title": c.title,
                    "profile": {
                        group: {key: fact.get("value", "")[:300] for key, fact in values.items()}
                        for group, values in c.profile_data.items()
                        if isinstance(values, dict)
                    },
                }
                for c in characters[:30]
            ],
            "relationships": [
                {
                    "source": str(r.source_character_id),
                    "target": str(r.target_character_id),
                    "type": r.relationship_type,
                    "description": r.description[:200] if r.description else "",
                }
                for r in relationships[:40]
            ],
        }
