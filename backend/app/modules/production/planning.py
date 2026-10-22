"""LLM planning is asynchronous and cannot overwrite the confirmed board."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from pydantic import ValidationError as SchemaError
from sqlalchemy import select

from app.core.errors import ApplicationError, ConflictError, ValidationError
from app.core.logging import get_logger
from app.infrastructure.db.session import UnitOfWork
from app.modules.characters.images import CharacterImagesService
from app.modules.production.duration import allocate
from app.modules.production.media import ProductionMedia
from app.modules.production.models import ProductionRun
from app.modules.production.prompts import (
    plan_prompt,
    restore_missing_origins,
    validate_origins,
    validate_plan,
)
from app.modules.production.schemas import Board, ProductionSettings, SaveBoard

logger = get_logger(__name__)


class ProductionPlanning:
    def __init__(self, productions):
        self.productions = productions

    async def submit(self, uow, actor, project, identity, payload, key):
        service = self.productions
        row = await service.get(uow, actor, project, identity, lock=True)
        request = {"kind": "plan", **payload.model_dump(mode="json")}
        old, digest = await service.replay(uow, row, actor, key, request)
        if old:
            return await service.view(uow, actor, project, identity)
        service.version(row, payload.expected_version)
        await service.require_editable(uow, row)
        if any(
            r.kind == "plan" and r.status in ["queued", "running"]
            for r in await service.runs(uow, row)
        ):
            raise ConflictError("已有规划正在生成")
        capabilities = await ProductionMedia(service).capabilities(uow)
        durations = sorted(
            {
                v
                for c in capabilities
                if c.available and c.operation.endswith("video")
                for v in c.parameters.get("duration", [])
            }
        )
        request["settings_snapshot"] = row.settings
        request["durations"] = durations
        instruction = payload.instruction
        if payload.shot_id:
            _, _, shot = service.shot(row, payload.shot_id)
            request["board_snapshot"] = row.board
            request["shot_duration"] = shot.duration
            instruction += (
                "\n仅重新规划一个镜头，输出一个场景且恰好一个镜头，保持其来源与叙事意图："
                + shot.model_dump_json()
            )
        prompt = plan_prompt(
            row.snapshot,
            instruction,
            row.settings,
            max_clip=max(durations) if durations else None,
        )
        task = await service.completions.submit(
            uow, project_id=project, actor_id=actor, prompt=prompt, commit=False
        )
        uow.session.add(
            ProductionRun(
                project_id=project,
                production_id=row.id,
                actor_id=actor,
                kind="plan",
                completion_id=task.id,
                request=request,
                request_hash=digest,
                idempotency_key=key,
            )
        )
        await uow.commit()
        return await service.view(uow, actor, project, identity)

    async def retry_validation(self, uow, actor, project, identity, run_id):
        """Recheck stored output in a new run without another model call."""
        service = self.productions
        row = await service.get(uow, actor, project, identity, lock=True)
        await service.require_editable(uow, row)
        runs = await service.runs(uow, row)
        original = next((r for r in runs if r.id == run_id), None)
        if not original or original.kind != "plan" or original.status != "failed":
            raise ValidationError("只能重新校验失败的分镜规划")
        key = "revalidate:" + str(run_id)
        existing = next((r for r in runs if r.idempotency_key == key), None)
        if existing:
            return existing.id
        if any(r.kind == "plan" and r.status in ["queued", "running"] for r in runs):
            raise ConflictError("已有规划正在生成")
        service.version(row, original.request["expected_version"])
        completion = await service.completions.get(
            uow, project_id=project, completion_id=original.completion_id
        )
        if completion.status != "succeeded":
            raise ValidationError("没有可重新校验的模型结果")
        retry = ProductionRun(
            project_id=project,
            production_id=identity,
            actor_id=actor,
            kind="plan",
            completion_id=original.completion_id,
            request=dict(original.request),
            request_hash=original.request_hash,
            idempotency_key=key,
        )
        uow.session.add(retry)
        await uow.commit()
        return retry.id

    async def collect(self, factory):
        async with factory() as session:
            ids = list(
                await session.scalars(
                    select(ProductionRun.id)
                    .where(
                        ProductionRun.kind == "plan",
                        ProductionRun.status.in_(["queued", "running"]),
                    )
                    .limit(100)
                )
            )
        for identity in ids:
            async with factory() as session:
                uow = UnitOfWork(session)
                job = await session.scalar(
                    select(ProductionRun)
                    .where(ProductionRun.id == identity)
                    .with_for_update(skip_locked=True)
                )
                if not job or job.status not in ["queued", "running"]:
                    continue
                task = await self.productions.completions.get(
                    uow, project_id=job.project_id, completion_id=job.completion_id
                )
                if task.status == "succeeded":
                    stage = "format"
                    try:
                        result = validate_plan(task.content or "")
                        stage = "access"
                        row = await self.productions.get(
                            uow, job.actor_id, job.project_id, job.production_id
                        )
                        stage = "origins"
                        restore_missing_origins(result, row.snapshot)
                        if row.snapshot["chapters"] and any(
                            not s.source_chapter_id for scene in result.scenes for s in scene.shots
                        ):
                            raise ValueError("规划缺少原文来源")
                        validate_origins(result, row.snapshot)
                        stage = "references"
                        await self.productions.validate(uow, job.actor_id, row, result)
                        stage = "duration"
                        if job.request.get("shot_id"):
                            if len(result.scenes) != 1 or len(result.scenes[0].shots) != 1:
                                raise ValueError("单镜头规划必须恰好包含一个镜头")
                            result.scenes[0].shots[0].duration = job.request["shot_duration"]
                        else:
                            result = allocate(
                                result,
                                ProductionSettings.model_validate(
                                    job.request.get("settings_snapshot", {})
                                ),
                                job.request.get("durations", []),
                            )
                        stage = "media"
                        images = CharacterImagesService(
                            self.productions.plots.characters, self.productions.images
                        )

                        config = job.request.get("settings_snapshot", {})
                        choices = {
                            UUID(k): UUID(v) if v else None
                            for k, v in config.get("character_references", {}).items()
                        }
                        for scene in result.scenes:
                            for shot in scene.shots:
                                for character in shot.character_ids:
                                    if character not in choices and not config.get(
                                        "prefer_character_images", True
                                    ):
                                        choices[character] = None
                                    if character not in choices:
                                        view = await images.view(
                                            uow,
                                            job.actor_id,
                                            row.project_id,
                                            row.story_id,
                                            character,
                                        )
                                        choices[character] = next(
                                            (i.id for i in view.images if i.is_primary), None
                                        )
                                    if choices[character]:
                                        shot.reference_character_id = character
                                        shot.character_image_id = choices[character]
                                        break
                        for scene in result.scenes:
                            for shot in scene.shots:
                                refs = (
                                    job.request.get("settings_snapshot", {})
                                    .get("scene_references", {})
                                    .get(str(shot.source_scene_id), [])
                                )
                                if refs and not shot.character_image_id:
                                    ref = refs[0]
                                    if ref["source"] == "upload":
                                        shot.reference_upload_id = UUID(ref["id"])
                                    else:
                                        shot.reference_asset_id = UUID(ref["id"])
                        stage = "references"
                        await self.productions.validate(uow, job.actor_id, row, result)
                        if job.request.get("shot_id"):
                            replacement = result.scenes[0].shots[0]
                            replacement.id = UUID(job.request["shot_id"])
                            merged = Board.model_validate(job.request["board_snapshot"])
                            for scene in merged.scenes:
                                scene.shots = [
                                    replacement if s.id == replacement.id else s
                                    for s in scene.shots
                                ]
                            result = merged
                        job.result, job.status = result.model_dump(mode="json"), "succeeded"
                    except (ValueError, ApplicationError) as exc:
                        job.status = "failed"
                        job.error = planning_error(stage, exc)
                        logger.warning(
                            "production_plan_validation_failed",
                            run_id=str(job.id),
                            stage=stage,
                            error_type=type(exc).__name__,
                            fields=[
                                {"loc": list(e["loc"]), "type": e["type"]}
                                for e in exc.errors(include_input=False, include_context=False)
                            ][:10]
                            if isinstance(exc, SchemaError)
                            else [],
                        )
                elif task.status in ["failed", "canceled"]:
                    job.status, job.error = "failed", task.error_message or "规划失败"
                elif datetime.now(UTC) - job.created_at > timedelta(minutes=15):
                    job.status, job.error = "failed", "规划等待超时，请检查文本 Worker"
                else:
                    job.status = task.status
                await uow.commit()

    async def apply(self, uow, actor, project, identity, run_id, payload):
        service = self.productions
        row = await service.get(uow, actor, project, identity, lock=True)
        run = next((r for r in await service.runs(uow, row) if r.id == run_id), None)
        if not run or run.kind != "plan" or run.status != "succeeded":
            raise ValidationError("规划尚未完成")
        if run.applied:
            return await service.view(uow, actor, project, identity)
        service.version(row, payload.expected_version)
        if payload.expected_version != run.request["expected_version"]:
            raise ConflictError("规划后分镜已编辑，请在预览中手动整合，不能覆盖最新分镜")
        run.applied = True
        return await service.save(
            uow,
            actor,
            project,
            identity,
            SaveBoard(expected_version=payload.expected_version, board=payload.board),
        )


def planning_error(stage: str, exc: Exception) -> str:
    """Never expose model output, credentials or raw validation payloads in a toast."""
    if isinstance(exc, SchemaError):
        errors = exc.errors(include_input=False, include_context=False)
        location = errors[0]["loc"] if errors else ()
        labels = {
            "character_ids": "人物引用",
            "duration": "时长",
            "setting": "场景类型",
            "narrative_role": "叙事作用",
            "prompt": "视频描述",
            "dialogue": "对白",
        }
        label = next((v for k, v in labels.items() if k in location), "分镜字段")
        return f"AI 返回的{label}格式不符合要求，请重新规划"
    return {
        "format": "AI 返回的分镜格式无效，请重新规划",
        "access": "无法访问当前故事，请检查访问权限",
        "origins": "分镜引用与选定剧本原文不匹配，请重新规划",
        "references": "分镜人物或素材引用无效，请检查所选人物与素材",
        "duration": "分镜时长无法满足当前设置，请调整目标时长或镜头数量",
        "media": "人物形象或场景参考不可用，请重新选择参考素材",
    }.get(stage, "分镜校验失败，请重试")
