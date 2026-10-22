"""Compose existing media jobs and editor exports with durable shot associations."""

import base64
from uuid import NAMESPACE_URL, uuid4, uuid5

from app.core.errors import ApplicationError, ConflictError, ValidationError
from app.infrastructure.ai.catalog import (
    require_assigned,
    require_editor_model,
)
from app.infrastructure.ai.video_parameters import video_options
from app.modules.characters.images import CharacterImagesService
from app.modules.editor.schemas import Composition, CreateDocument
from app.modules.generation.inputs import GenerationInputService
from app.modules.production.models import ProductionRun
from app.modules.production.prompts import shot_prompt
from app.modules.production.schemas import Board, CapabilityView, PromptView


class ProductionMedia:
    def __init__(self, productions):
        self.service = productions

    async def capabilities(self, uow):
        settings = self.service.images.settings
        result = []
        for operation in ["text_to_image", "image_to_image", "text_to_video", "image_to_video"]:
            try:
                config = (
                    await require_editor_model(uow, settings, operation)
                    if operation.startswith("image_to")
                    else await require_assigned(uow.session, operation)
                )
                if not settings.model_endpoint(config.secret_ref):
                    raise ValidationError("尚未配置模型服务端凭据")
                parameters = (
                    video_options(config, settings, reference=operation == "image_to_video")
                    if operation.endswith("video")
                    else {}
                )
                result.append(
                    CapabilityView(
                        operation=operation,
                        available=True,
                        model_name=config.model_name,
                        model_config_id=config.id,
                        parameters=parameters,
                        max_reference_images=1 if operation.startswith("image_to") else 0,
                    )
                )
            except ApplicationError as exc:
                result.append(
                    CapabilityView(operation=operation, available=False, reason=exc.message)
                )
        return result

    async def prompt(self, uow, actor, project, identity, shot_id):
        row = await self.service.get(uow, actor, project, identity)
        board, scene, shot = self.service.shot(row, shot_id)
        context = await self.service.plots.characters.storyline_context(
            uow, actor, project, row.story_id
        )
        return PromptView(
            prompt=shot_prompt(board, scene, shot, context["characters"]),
            reference_asset_id=shot.reference_asset_id,
            character_image_id=shot.character_image_id,
            constraints=["人物一致性依赖实际首帧；当前适配器不支持多图人物锁定或尾帧"],
        )

    async def generate(
        self, uow, actor, project, identity, shot_id, payload, key, *, executing=False
    ):
        service = self.service
        row = await service.get(uow, actor, project, identity, lock=True)
        request = {"shot_id": str(shot_id), **payload.model_dump(mode="json")}
        old, digest = await service.replay(uow, row, actor, key, request)
        if old:
            return await service.view(uow, actor, project, identity)
        service.version(row, payload.expected_version)
        if not executing:
            await service.require_editable(uow, row)
        board, scene, shot = service.shot(row, shot_id)
        if not shot.confirmed:
            raise ValidationError("请先保存并确认当前镜头")
        for run in await service.runs(uow, row):
            if run.shot_id == shot_id and run.kind == payload.kind:
                state = await service.run_view(uow, actor, row, run)
                if state.status in ["queued", "running", "submitting", "cancel_requested"]:
                    raise ConflictError("此镜头已有同类任务，请等待结果")
        await service.validate(uow, actor, row, board)
        context = await service.plots.characters.storyline_context(
            uow, actor, project, row.story_id
        )
        prompt = shot.prompt.strip() or shot_prompt(board, scene, shot, context["characters"])
        asset_id = (
            shot.selected_image_id
            if payload.kind == "video" and shot.selected_image_id
            else shot.reference_asset_id
        )
        has_reference = bool(asset_id or shot.character_image_id or shot.reference_upload_id)
        operation = ("image_to_" if has_reference else "text_to_") + payload.kind
        capability = next(c for c in await self.capabilities(uow) if c.operation == operation)
        if not capability.available:
            raise ValidationError(capability.reason or "此操作不可用")
        for name, value in payload.parameters.items():
            if name not in capability.parameters or value not in capability.parameters[name]:
                raise ValidationError("模型不支持所选参数")
        input_id = None
        if has_reference:
            if asset_id:
                content = await service.images.reference_image_bytes(
                    uow, project_id=project, asset_id=asset_id
                )
            elif shot.reference_upload_id:
                await service.resources.detail(
                    uow, actor, project, row.story_id, "upload", shot.reference_upload_id
                )
                media = await service.plots.stories.uploads.referenced_file(
                    uow.session, shot.reference_upload_id
                )
                if media.size > service.images.settings.image_max_size:
                    raise ValidationError("环境参考图片过大")
                content = await service.resources.upload_storage.get_object(
                    object_key=media.object_key
                )
            else:
                content = await CharacterImagesService(
                    service.plots.characters, service.images
                ).reference_bytes(
                    uow,
                    actor,
                    project,
                    row.story_id,
                    shot.reference_character_id,
                    shot.character_image_id,
                )
            input_id = uuid4()
            # Input upload commits separately. Recheck version and idempotency afterward.
            await GenerationInputService(service.images.settings, service.images.storage).save(
                uow,
                project_id=project,
                actor_id=actor,
                input_id=input_id,
                image_base64=base64.b64encode(content).decode(),
                mask_base64=None,
            )
            row = await service.get(uow, actor, project, identity, lock=True)
            old, _ = await service.replay(uow, row, actor, key, request)
            if old:
                return await service.view(uow, actor, project, identity)
            service.version(row, payload.expected_version)
            for run in await service.runs(uow, row):
                if (
                    run.shot_id == shot_id
                    and run.kind == payload.kind
                    and (await service.run_view(uow, actor, row, run)).status
                    in ["queued", "running", "submitting", "cancel_requested"]
                ):
                    raise ConflictError("此镜头已有同类任务")
        generator = service.images if payload.kind == "image" else service.videos
        task = await generator.submit(
            uow,
            project_id=project,
            actor_id=actor,
            prompt=prompt,
            parameters=payload.parameters,
            input_id=input_id,
            idempotency_key=str(uuid5(NAMESPACE_URL, f"production:{identity}:{key}")),
            commit=False,
        )
        request.update(
            {
                "prompt": prompt,
                "characters": context,
                "reference_asset_id": str(asset_id) if asset_id else None,
            }
        )
        uow.session.add(
            ProductionRun(
                project_id=project,
                production_id=identity,
                actor_id=actor,
                shot_id=shot_id,
                kind=payload.kind,
                task_id=task.id,
                idempotency_key=key,
                request_hash=digest,
                request=request,
            )
        )
        await uow.commit()
        return await service.view(uow, actor, project, identity)

    async def export(self, uow, actor, project, identity, payload, key):
        service = self.service
        row = await service.get(uow, actor, project, identity, lock=True)
        request = {"kind": "export", **payload.model_dump(mode="json")}
        old, digest = await service.replay(uow, row, actor, key, request)
        if old:
            return await service.view(uow, actor, project, identity)
        service.version(row, payload.expected_version)
        board = Board.model_validate(row.board)
        shots = [s for scene in board.scenes for s in scene.shots]
        if not shots or any(not s.confirmed or not s.selected_video_id for s in shots):
            raise ValidationError("每个镜头必须确认并选择成功的视频版本后才能导出")
        seen: dict = {}
        for shot in shots:
            previous = seen.get(shot.selected_video_id)
            if previous is not None:
                raise ValidationError(
                    "不同镜头使用了同一条视频，不能自动合成。请为缺少独立结果的镜头重新生成。"
                )
            seen[shot.selected_video_id] = shot.id
        await service.validate(uow, actor, row, board)
        clips = []
        cursor = 0
        for shot in shots:
            asset = await service.images.lock_asset_for_reference(
                uow, project_id=project, asset_id=shot.selected_video_id
            )
            if not asset.duration_ms:
                raise ValidationError("视频尚无可靠时长元数据，不能导出")
            frames = int(asset.duration_ms * 30 / 1000)
            clips.append(
                {
                    "id": str(uuid4()),
                    "asset_id": str(asset.id),
                    "source_start_frame": 0,
                    "source_end_frame": frames,
                    "original_duration": frames,
                    "timeline_start_frame": cursor,
                    "duration": frames,
                    "muted": row.settings.get("audio_mode") == "silent",
                }
            )
            cursor += frames
        composition = Composition(
            width=payload.width,
            height=payload.height,
            duration_in_frames=cursor,
            frame="fill",
            tracks=[{"clips": clips}],
        )
        document = await service.editor.create(
            uow,
            project,
            actor,
            CreateDocument(title=row.title, composition=composition),
            commit=False,
        )
        task = await service.editor.submit(
            uow,
            project,
            actor,
            document.id,
            document.version,
            str(uuid5(NAMESPACE_URL, f"production-export:{identity}:{key}")),
            commit=False,
        )
        uow.session.add(
            ProductionRun(
                project_id=project,
                production_id=identity,
                actor_id=actor,
                kind="export",
                render_id=task.id,
                editor_document_id=document.id,
                idempotency_key=key,
                request_hash=digest,
                request=request,
            )
        )
        await uow.commit()
        return await service.view(uow, actor, project, identity)

    async def remove_version(self, uow, actor, project, identity, run_id):
        service = self.service
        row = await service.get(uow, actor, project, identity, lock=True)
        await service.require_editable(uow, row)
        run = next((r for r in await service.runs(uow, row) if r.id == run_id), None)
        if not run or run.kind not in ["image", "video"]:
            raise ValidationError("没有可移除的生成版本")
        view = await service.run_view(uow, actor, row, run)
        if view.status not in ["succeeded", "failed", "canceled"]:
            raise ConflictError("任务执行中，不能移除版本")
        board = Board.model_validate(row.board)
        used = {
            i
            for scene in board.scenes
            for shot in scene.shots
            for i in [shot.selected_image_id, shot.selected_video_id, shot.reference_asset_id]
            if i
        }
        if used.intersection(view.output_asset_ids):
            raise ConflictError("请先取消采用或更换此版本")
        await uow.session.delete(run)
        await uow.session.flush()
        await service.retain_assets(uow, row, board)
        await uow.commit()
        return await service.view(uow, actor, project, identity)
