"""Durable orchestration of existing video tasks, never a second provider client.

Input editing is locked while an execution is active. Advisory locking serializes
collectors even when underlying upload services commit. Stable per-shot keys make
worker restarts safe. Completed versions are adopted explicitly by this confirmed run.
"""

from datetime import UTC, datetime
from uuid import UUID

import structlog
from sqlalchemy import select, text

from app.core.errors import ApplicationError, ValidationError
from app.infrastructure.db.session import UnitOfWork
from app.modules.production.media import ProductionMedia
from app.modules.production.models import ProductionRun
from app.modules.production.readiness import readiness
from app.modules.production.schemas import Board, ExportInput, GenerateShot, SaveBoard


class ProductionExecution:
    def __init__(self, service):
        self.service = service

    async def submit(self, uow, actor, project, identity, payload, key):
        service = self.service
        row = await service.get(uow, actor, project, identity, lock=True)
        request = {"kind": "execution", **payload.model_dump(mode="json")}
        old, digest = await service.replay(uow, row, actor, key, request)
        if old:
            return await service.view(uow, actor, project, identity)
        service.version(row, payload.expected_version)
        await service.require_editable(uow, row)
        board = Board.model_validate(row.board)
        check = readiness(board)
        if not check.allowed:
            raise ValidationError(check.message)
        shots = [s for c in board.scenes for s in c.shots]
        if not shots or not all(s.confirmed for s in shots):
            raise ValidationError("请先采用并确认所有镜头")
        await service.validate(uow, actor, row, board)
        capabilities = {c.operation: c for c in await ProductionMedia(service).capabilities(uow)}
        clip_lengths = [
            value
            for capability in capabilities.values()
            if capability.available and capability.operation.endswith("video")
            for value in capability.parameters.get("duration", [])
            if type(value) is int
        ]
        max_clip = max(clip_lengths) if clip_lengths else None
        planned = sum(shot.duration for shot in shots)
        target = row.settings.get("target_duration")
        if isinstance(target, int) and max_clip and planned + 0.5 < target:
            needed = min(100, max(1, -(-target // max_clip)))
            raise ValidationError(
                f"当前分镜合计约 {planned:.0f} 秒，低于目标 {target} 秒。"
                f"模型单次最长 {max_clip} 秒，请重新规划，大约需要 {needed} 个镜头。"
                "也可以把目标时长改成与现有分镜一致后再生成。"
            )
        tasks = []
        for shot in shots:
            if shot.selected_video_id:
                continue
            reference = (
                shot.selected_image_id
                or shot.reference_asset_id
                or shot.reference_upload_id
                or shot.character_image_id
            )
            needs_image = not reference and not capabilities["text_to_video"].available
            capability = capabilities[
                "image_to_video" if reference or needs_image else "text_to_video"
            ]
            if needs_image and not capabilities["text_to_image"].available:
                raise ValidationError("当前视频模型需要首帧，但图片模型不可用，请先选择参考图")
            if not capability.available:
                raise ValidationError(capability.reason or "视频模型不可用")
            durations = sorted(
                value
                for value in capability.parameters.get("duration", [])
                if type(value) is int
            )
            duration = (
                shot.generation_duration if shot.generation_duration in durations else None
            )
            if duration is None:
                duration = next((value for value in durations if value >= shot.duration), None)
            if duration is None and durations and shot.duration > durations[-1]:
                duration = durations[-1]
            if duration is None:
                raise ValidationError("镜头计划时长超过模型能力，请增加不同事件的镜头")
            parameters = {
                name: values[0] for name, values in capability.parameters.items() if values
            }
            parameters["duration"] = duration
            # Choose only advertised provider options; final export dimensions are independent.
            ratio = row.settings.get("aspect_ratio", "9:16")
            sizes = capability.parameters.get("size", [])
            target = {"9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1}[ratio]
            if sizes:
                parameters["size"] = min(
                    sizes, key=lambda v: abs(int(v.split("*")[0]) / int(v.split("*")[1]) - target)
                )
            resolutions = capability.parameters.get("resolution", [])
            preferred = row.settings.get("resolution", "1080") + "P"
            if preferred in resolutions:
                parameters["resolution"] = preferred
            tasks.append(
                {
                    "shot_id": str(shot.id),
                    "parameters": parameters,
                    "needs_image": needs_image,
                    "image_model_config_id": str(capabilities["text_to_image"].model_config_id)
                    if needs_image
                    else None,
                    "operation": capability.operation,
                    "model_config_id": str(capability.model_config_id),
                }
            )
        request.update({"tasks": tasks, "settings": row.settings, "board": row.board})
        uow.session.add(
            ProductionRun(
                project_id=project,
                production_id=identity,
                actor_id=actor,
                kind="execution",
                request=request,
                request_hash=digest,
                idempotency_key=key,
            )
        )
        await uow.commit()
        return await service.view(uow, actor, project, identity)

    async def collect(self, factory):
        async with factory() as session:
            ids = list(
                await session.scalars(
                    select(ProductionRun.id)
                    .where(
                        ProductionRun.kind == "execution",
                        ProductionRun.status.in_(["queued", "running"]),
                    )
                    .limit(100)
                )
            )
        for identity in ids:
            # Session-level lock survives commits; release before returning pooled connection.
            async with factory.kw["bind"].connect() as connection:
                token = identity.int % (2**63 - 1)
                locked = await connection.scalar(
                    text("SELECT pg_try_advisory_lock(:token)"), {"token": token}
                )
                await connection.commit()
                if not locked:
                    continue
                try:
                    async with factory(bind=connection) as session:
                        uow = UnitOfWork(session)
                        job = await session.get(ProductionRun, identity)
                        if not job or job.status not in {"queued", "running"}:
                            continue
                        try:
                            await self.advance(uow, job)
                        except ApplicationError as error:
                            await session.rollback()
                            job = await session.get(ProductionRun, identity)
                            job.status, job.error = "failed", error.message[:300]
                            await uow.commit()
                        except Exception:
                            # Unexpected failures must not leave a run spinning forever.
                            structlog.get_logger().exception(
                                "production_execution_failed", run_id=str(identity)
                            )
                            await session.rollback()
                            job = await session.get(ProductionRun, identity)
                            if job:
                                job.status, job.error = (
                                    "failed",
                                    "制作执行异常，请在工作台检查后重试",
                                )
                                await uow.commit()
                finally:
                    await connection.execute(
                        text("SELECT pg_advisory_unlock(:token)"), {"token": token}
                    )
                    await connection.commit()

    async def advance(self, uow, job):
        service = self.service
        row = await service.get(uow, job.actor_id, job.project_id, job.production_id, lock=True)
        job.status = "running"
        runs = await service.runs(uow, row)
        board = Board.model_validate(row.board)
        shots = {str(s.id): s for c in board.scenes for s in c.shots}
        outputs = {}
        for item in job.request["tasks"]:
            shot = shots[item["shot_id"]]
            if item.get("needs_image") and not shot.selected_image_id:
                image_key = f"{job.id}:{item['shot_id']}:image"
                image_run = next((r for r in runs if r.idempotency_key == image_key), None)
                if image_run is None:
                    capabilities = await ProductionMedia(service).capabilities(uow)
                    image_capability = next(
                        c for c in capabilities if c.operation == "text_to_image"
                    )
                    if (
                        not image_capability.available
                        or str(image_capability.model_config_id) != item["image_model_config_id"]
                    ):
                        raise ValidationError("首帧模型配置已变更，请重新确认生成")
                    await ProductionMedia(service).generate(
                        uow,
                        job.actor_id,
                        row.project_id,
                        row.id,
                        shot.id,
                        GenerateShot(expected_version=row.version, kind="image"),
                        image_key,
                        executing=True,
                    )
                    return
                state = await service.run_view(uow, job.actor_id, row, image_run)
                if state.status in {"failed", "canceled"}:
                    raise ValidationError(state.error or "首帧生成失败，请重试镜头")
                if state.status != "succeeded":
                    await uow.commit()
                    return
                if not state.output_asset_ids:
                    raise ValidationError("首帧完成但没有可用图片")
                shot.selected_image_id = state.output_asset_ids[0]
                await service.save(
                    uow,
                    job.actor_id,
                    row.project_id,
                    row.id,
                    SaveBoard(expected_version=row.version, board=board),
                    executing=True,
                )
            key = f"{job.id}:{item['shot_id']}:video"
            run = next((r for r in runs if r.idempotency_key == key), None)
            if run is None:
                capabilities = await ProductionMedia(service).capabilities(uow)
                current = next(
                    (c for c in capabilities if c.operation == item.get("operation")), None
                )
                if item.get("model_config_id") and (
                    not current
                    or not current.available
                    or str(current.model_config_id) != item["model_config_id"]
                ):
                    raise ValidationError("生成模型配置已变更，请重新确认制作方案")
                await ProductionMedia(service).generate(
                    uow,
                    job.actor_id,
                    row.project_id,
                    row.id,
                    UUID(item["shot_id"]),
                    GenerateShot(
                        expected_version=row.version, kind="video", parameters=item["parameters"]
                    ),
                    key,
                    executing=True,
                )
                return
            state = await service.run_view(uow, job.actor_id, row, run)
            if state.status in {"failed", "canceled"}:
                job.status, job.error = "failed", state.error or "镜头生成失败，可在工作台重试"
                # Retain successful preceding shots so restarting need not regenerate them.
                for shot_id, asset in outputs.items():
                    shots[shot_id].selected_video_id = asset
                await service.save(
                    uow,
                    job.actor_id,
                    row.project_id,
                    row.id,
                    SaveBoard(expected_version=row.version, board=board),
                    executing=True,
                )
                return
            if state.status != "succeeded":
                await uow.commit()
                return
            if not state.output_asset_ids:
                raise ValidationError("生成任务完成但没有可用输出")
            outputs[item["shot_id"]] = state.output_asset_ids[0]
        for shot_id, asset in outputs.items():
            shots[shot_id].selected_video_id = asset
        if row.board != board.model_dump(mode="json"):
            await service.save(
                uow,
                job.actor_id,
                row.project_id,
                row.id,
                SaveBoard(expected_version=row.version, board=board),
                executing=True,
            )
        if job.request.get("auto_export"):
            export_key = f"{job.id}:export"
            export = next(
                (r for r in await service.runs(uow, row) if r.idempotency_key == export_key), None
            )
            if export is None:
                settings = job.request["settings"]
                short = 720 if settings.get("resolution") == "720" else 1080
                long = short * 16 // 9
                ratio = settings.get("aspect_ratio", "9:16")
                width, height = (
                    (short, long)
                    if ratio == "9:16"
                    else (long, short)
                    if ratio == "16:9"
                    else (short, short)
                )
                await ProductionMedia(service).export(
                    uow,
                    job.actor_id,
                    row.project_id,
                    row.id,
                    ExportInput(expected_version=row.version, width=width, height=height),
                    export_key,
                )
                return
            state = await service.run_view(uow, job.actor_id, row, export)
            if state.status not in {"succeeded", "failed", "canceled"}:
                await uow.commit()
                return
            job.status, job.error = state.status, state.error
        else:
            job.status = "succeeded"
        job.updated_at = datetime.now(UTC)
        await uow.commit()
