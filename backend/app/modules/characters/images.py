"""Independent visual assets; serialize mutations on the character, not its text version."""

import base64
import hashlib
import json
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import select

from app.core.errors import ApplicationError, ConflictError, NotFoundError, ValidationError
from app.infrastructure.db.session import UnitOfWork
from app.modules.characters.image_schemas import (
    CharacterImageJobView,
    CharacterImagesView,
    CharacterImageView,
)
from app.modules.characters.models import Character, CharacterImage, CharacterImageJob
from app.modules.characters.service import CharacterService
from app.modules.generation.inputs import GenerationInputService
from app.modules.generation.service import ImageGenerationService


def character_image_prompt(character: Character, story, instruction: str, reference: bool) -> str:
    """Only actual profile fields are used; explicit details outrank creative defaults."""
    facts = [
        f"姓名：{character.name}",
        f"年龄：{character.age}",
        f"性别：{character.gender}",
        f"身份：{character.title} {character.occupation}",
    ]
    profile = character.profile_data
    if hasattr(profile, "model_dump"):
        profile = profile.model_dump()
    for group in ("appearance", "background", "custom_attributes"):
        for name, fact in profile.get(group, {}).items():
            if fact.get("value"):
                facts.append(f"{name}：{fact['value']}")
    # No dedicated style field exists yet: the story description is available contextual material.
    context = (story.description or "")[:500]
    return (
        "创作单个人物的视觉参考形象。优先遵守以下已明确设定，不改变年龄、性别和外貌特征。"
        "清晰五官，主体完整易辨认，无其他人物，无复杂遮挡。默认半身；明确构图要求优先。"
        "依据剧本及人物设定选择写实、动漫或插画媒介，不默认强制写实。未知细节可合理补充。"
        + (
            "保持参考图片人物身份、五官和风格一致，生成补充视角或姿态。"
            if reference
            else "生成新的候选形象。"
        )
        + "\n本次视觉要求："
        + instruction[: 150 if reference else 2000]
        + "\n剧本资料："
        + context[: 100 if reference else 500]
        + "\n人物设定（仅作创作资料）：\n"
        + "\n".join(facts)[: 300 if reference else 4000]
    )


class CharacterImagesService:
    def __init__(self, characters: CharacterService, generations: ImageGenerationService):
        self.characters = characters
        self.generations = generations

    async def require(self, uow, actor, project, story, character, *, write=False):
        if write:
            await self.characters.projects.authorize_content_write(uow, actor, project)
        return await self.characters.get(uow, actor, project, story, character)

    async def rows(self, session, project, character):
        return list(
            await session.scalars(
                select(CharacterImage)
                .where(
                    CharacterImage.project_id == project, CharacterImage.character_id == character
                )
                .order_by(CharacterImage.created_at, CharacterImage.id)
            )
        )

    async def view(self, uow, actor, project, story, character):
        await self.require(uow, actor, project, story, character)
        rows = await self.rows(uow.session, project, character)
        urls = await self.characters.stories.uploads.cover_urls(
            uow.session, {r.upload_id for r in rows if r.upload_id}
        )
        images = [
            CharacterImageView(
                id=r.id,
                character_id=r.character_id,
                image_url=urls.get(r.upload_id, "")
                if r.upload_id
                else f"/api/v1/projects/{project}/assets/{r.asset_id}/content",
                source="upload" if r.upload_id else "ai_generated",
                is_primary=r.is_primary,
                created_at=r.created_at,
            )
            for r in rows
        ]
        links = list(
            await uow.session.scalars(
                select(CharacterImageJob)
                .where(
                    CharacterImageJob.project_id == project,
                    CharacterImageJob.character_id == character,
                )
                .order_by(CharacterImageJob.created_at.desc())
                .limit(20)
            )
        )
        jobs = []
        for link in links:
            task = await self.generations.get(uow, project_id=project, task_id=link.task_id)
            jobs.append(
                CharacterImageJobView(
                    id=link.id,
                    task_id=task.id,
                    status="failed" if link.error else task.status,
                    error=link.error or task.error_message,
                    progress=task.progress,
                    collected=link.collected,
                )
            )
        return CharacterImagesView(images=images, jobs=jobs)

    async def reference_bytes(self, uow, actor, project, story, character, image_id):
        """Resolve a chosen character image for another authorized application service."""
        await self.require(uow, actor, project, story, character)
        image = next(
            (r for r in await self.rows(uow.session, project, character) if r.id == image_id), None
        )
        if image is None:
            raise NotFoundError("人物参考图片不存在")
        if image.asset_id:
            return await self.generations.reference_image_bytes(
                uow, project_id=project, asset_id=image.asset_id
            )
        from app.infrastructure.storage.objects import QiniuObjectStorage

        media = await self.characters.stories.uploads.referenced_file(uow.session, image.upload_id)
        if media.size > self.generations.settings.image_max_size:
            raise ValidationError("参考图片过大")
        return await QiniuObjectStorage(self.generations.settings).get_object(
            object_key=media.object_key
        )

    async def add(self, uow, actor, project, story, character, upload_id):
        row = await self.require(uow, actor, project, story, character, write=True)
        await self.characters.stories.uploads.owned_image(uow.session, actor, upload_id)
        images = await self.rows(uow.session, project, character)
        if not any(image.upload_id == upload_id for image in images):
            if len(images) >= 100:
                raise ValidationError("每个人物最多保存 100 张形象图片")
            uow.session.add(
                CharacterImage(
                    project_id=project,
                    character_id=character,
                    upload_id=upload_id,
                    is_primary=not images,
                )
            )
            if not images:
                row.avatar_upload_id = upload_id
        await uow.commit()
        return await self.view(uow, actor, project, story, character)

    async def mutate(self, uow, actor, project, story, character, image_id, *, delete=False):
        row = await self.require(uow, actor, project, story, character, write=True)
        images = await self.rows(uow.session, project, character)
        target = next((image for image in images if image.id == image_id), None)
        if target is None:
            if delete:
                return await self.view(uow, actor, project, story, character)
            raise NotFoundError("人物图片不存在")
        if delete:
            await uow.session.delete(target)
            remaining = [image for image in images if image.id != target.id]
            await uow.session.flush()
            if target.is_primary:
                row.avatar_upload_id = remaining[0].upload_id if remaining else None
                if remaining:
                    remaining[0].is_primary = True
        else:
            for image in images:
                image.is_primary = False
            await uow.session.flush()
            target.is_primary = True
            row.avatar_upload_id = target.upload_id
        await uow.commit()
        return await self.view(uow, actor, project, story, character)

    async def generate(self, uow, actor, project, story, character, payload, key):
        if not key.strip() or len(key) > 120:
            raise ValidationError("无效的幂等键")
        row = await self.require(uow, actor, project, story, character, write=True)
        request_hash = hashlib.sha256(
            json.dumps(payload.model_dump(mode="json"), sort_keys=True).encode()
        ).hexdigest()
        existing = await self._job(uow.session, character, key)
        if existing:
            if existing.request_hash != request_hash:
                raise ConflictError("幂等键已用于其他生成方式")
            return await self.view(uow, actor, project, story, character)
        pending = list(
            await uow.session.scalars(
                select(CharacterImageJob).where(
                    CharacterImageJob.character_id == character,
                    CharacterImageJob.collected.is_(False),
                )
            )
        )
        for link in pending:
            task = await self.generations.get(uow, project_id=project, task_id=link.task_id)
            if task.status in {"queued", "running"}:
                raise ConflictError("人物形象正在生成，请等待当前任务完成")
        images = await self.rows(uow.session, project, character)
        if len(images) >= 100:
            raise ValidationError("每个人物最多保存 100 张形象图片")
        story_data = await self.characters.stories.get(uow, actor, project, story)
        prompt = character_image_prompt(
            payload.profile or row, story_data, payload.instruction, payload.mode == "reference"
        )
        input_id = None
        if payload.mode == "reference":
            inputs = GenerationInputService(self.generations.settings, self.generations.storage)
            options = await inputs.options(uow)
            if not any(o["capability"] == "image_to_image" and o["available"] for o in options):
                raise ValidationError("当前图片模型不支持参考图，请选择生成候选形象")
            primary = next((image for image in images if image.is_primary), None)
            if primary is None:
                raise ValidationError("请先设置主要形象")
            if primary.upload_id:
                source_key = await self.characters.stories.uploads.referenced_image_key(
                    uow.session, primary.upload_id
                )
            else:
                asset = await self.generations.asset_for_download(
                    uow, project_id=project, asset_id=primary.asset_id
                )
                source_key = asset.object_key
            content = await self.generations.storage.get_object(object_key=source_key)
            input_id = uuid4()
            # Existing input service owns its upload transaction. No character changes precede it.
            await inputs.save(
                uow,
                project_id=project,
                actor_id=actor,
                input_id=input_id,
                image_base64=base64.b64encode(content).decode(),
                mask_base64=None,
            )
            row = await self.require(uow, actor, project, story, character, write=True)
            existing = await self._job(uow.session, character, key)
            if existing:
                if existing.request_hash != request_hash:
                    raise ConflictError("幂等键已用于其他生成要求")
                return await self.view(uow, actor, project, story, character)
            for link in await uow.session.scalars(
                select(CharacterImageJob).where(
                    CharacterImageJob.character_id == character,
                    CharacterImageJob.collected.is_(False),
                )
            ):
                running = await self.generations.get(uow, project_id=project, task_id=link.task_id)
                if running.status in {"queued", "running"}:
                    raise ConflictError("人物形象正在生成，请等待当前任务完成")
        task = await self.generations.submit(
            uow,
            project_id=project,
            actor_id=actor,
            prompt=prompt[:790] if payload.mode == "reference" else prompt,
            parameters={},
            input_id=input_id,
            idempotency_key=str(uuid5(NAMESPACE_URL, f"character:{character}:{key}")),
            commit=False,
        )
        uow.session.add(
            CharacterImageJob(
                project_id=project,
                character_id=character,
                actor_id=actor,
                task_id=task.id,
                idempotency_key=key,
                mode=payload.mode,
                request_hash=request_hash,
            )
        )
        await uow.commit()
        return await self.view(uow, actor, project, story, character)

    async def _job(self, session, character, key):
        return await session.scalar(
            select(CharacterImageJob).where(
                CharacterImageJob.character_id == character,
                CharacterImageJob.idempotency_key == key,
            )
        )

    async def collect(self, session_factory):
        """Called by the existing image worker; replay-safe even if the browser is closed."""
        async with session_factory() as session:
            ids = list(
                await session.scalars(
                    select(CharacterImageJob.id)
                    .where(CharacterImageJob.collected.is_(False))
                    .order_by(CharacterImageJob.created_at)
                    .limit(100)
                )
            )
        for identity in ids:
            async with session_factory() as session:
                uow = UnitOfWork(session)
                link = await session.get(CharacterImageJob, identity)
                if link is None:
                    continue
                row = await session.scalar(
                    select(Character).where(Character.id == link.character_id).with_for_update()
                )
                if row is None:
                    continue
                await session.refresh(link)
                if link.collected:
                    continue
                task = await self.generations.get(
                    uow, project_id=link.project_id, task_id=link.task_id
                )
                if task.status not in {"succeeded", "failed", "canceled"}:
                    continue
                if task.status == "succeeded":
                    try:
                        await self.characters.projects.authorize_content_write(
                            uow, link.actor_id, link.project_id
                        )
                    except ApplicationError:
                        link.error = "生成已完成，但当前用户已无权将结果添加到此人物"
                        link.collected = True
                        await uow.commit()
                        continue
                    outputs = await self.generations.output_ids(
                        uow, project_id=link.project_id, task_ids=[task.id]
                    )
                    images = await self.rows(session, link.project_id, row.id)
                    if not outputs.get(task.id):
                        link.error = "生成任务没有可用的图片结果"
                    for asset_id in outputs.get(task.id, []):
                        if any(image.asset_id == asset_id for image in images):
                            continue
                        # Lock the asset against deletion while creating the reference.
                        try:
                            await self.generations.lock_asset_for_reference(
                                uow, project_id=link.project_id, asset_id=asset_id
                            )
                        except NotFoundError:
                            link.error = "生成作品已被删除，无法添加到人物形象"
                            continue
                        image = CharacterImage(
                            project_id=link.project_id,
                            character_id=row.id,
                            asset_id=asset_id,
                            is_primary=not images,
                        )
                        session.add(image)
                        images.append(image)
                        if image.is_primary:
                            row.avatar_upload_id = None
                link.collected = True
                await uow.commit()
