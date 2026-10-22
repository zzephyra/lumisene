"""Queue one explicit image generation and finish it outside the request transaction."""

import asyncio
import hashlib
import json
import re
import traceback
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.errors import (
    ApplicationError,
    CancellationUnsupportedError,
    ConflictError,
    NotFoundError,
    ValidationError,
)
from app.core.errors import TimeoutError as ProviderTimeout
from app.core.logging import get_logger
from app.infrastructure.ai.adapters.openai_images import OpenAICompatibleImages
from app.infrastructure.ai.adapters.outpainting import NativeOutpainting, validate_parameters
from app.infrastructure.ai.adapters.wan_image_edit import WanImageEditing, expansion_parameters
from app.infrastructure.ai.catalog import (
    require_assigned,
    require_editor_model,
    require_outpaint_model,
)
from app.infrastructure.ai.domain import PROMPT_MAX_LENGTH, json_object
from app.infrastructure.ai.inpainting import composite_edits as _composite_edits
from app.infrastructure.ai.models import ModelConfig
from app.infrastructure.db.session import UnitOfWork
from app.infrastructure.storage.objects import build_object_storage
from app.modules.generation.inputs import require_input
from app.modules.generation.models import Asset, GenerationOutput, GenerationTask
from app.modules.generation.persistence import (
    describe_outputs,
    put_if_changed,
    register_stored_assets,
    remember_objects,
    storage_identity,
)

logger = get_logger(__name__)
_IDEMPOTENCY_KEY = re.compile(r"^[\x21-\x7e]{1,128}$")


class ImageClient(Protocol):
    async def reference(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        prompt: str,
        image: bytes,
        size: str | None = None,
        count: int = 1,
    ) -> list[tuple[bytes, str]]: ...

    async def edit(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        prompt: str,
        image: bytes,
        mask: bytes,
        full_context: bool = False,
    ) -> list[tuple[bytes, str]]: ...

    async def generate(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        prompt: str,
        size: str | None = None,
        count: int = 1,
    ) -> list[tuple[bytes, str]]:
        """Return image bytes and mime types. Implementations must not log the API key."""


class ObjectStorage(Protocol):
    async def put_object(self, *, object_key: str, content: bytes, content_type: str) -> None:
        """Store private bytes."""

    async def get_object(self, *, object_key: str) -> bytes:
        """Read private bytes after the caller has authorized the asset."""


class ImageGenerationService:
    def __init__(
        self,
        settings: Settings,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        client: ImageClient | None = None,
        storage: ObjectStorage | None = None,
        image_edit_client: WanImageEditing | None = None,
    ) -> None:
        self.settings = settings
        self.outpaint_client = NativeOutpainting()
        self.image_edit_client = image_edit_client or WanImageEditing()
        self.session_factory = session_factory
        self.client = client or OpenAICompatibleImages()
        self.storage = storage or build_object_storage(settings)

    async def submit(
        self,
        uow: UnitOfWork,
        *,
        project_id: UUID,
        actor_id: UUID,
        prompt: str,
        parameters: dict,
        idempotency_key: str,
        input_id: UUID | None = None,
        commit: bool = True,
    ) -> GenerationTask:
        key = _clean_key(idempotency_key)
        cleaned = _clean_prompt(prompt)
        safe_parameters = (
            {} if input_id and set(parameters) == {"outpaint"} else _parameters(parameters)
        )
        if not self.settings.object_storage_configured:
            raise ValidationError("Object storage is not configured")
        source = None
        if input_id:
            source = await require_input(uow.session, project_id, input_id, inpaint=None)
            if "outpaint" in parameters:
                if source.mask_key:
                    raise ValidationError("扩图已改用专用模型，请刷新页面，仅上传原图")
                config = await require_outpaint_model(uow, self.settings)
                safe_parameters = {
                    "outpaint": validate_parameters(
                        parameters["outpaint"], source.width, source.height
                    )
                }
            else:
                operation = "image_inpaint" if source.mask_key else "image_to_image"
                config = await require_editor_model(uow, self.settings, operation)
                if source.mask_key and parameters:
                    raise ValidationError("局部重绘不支持额外生成参数")

        else:
            config = await require_assigned(uow.session, "text_to_image")
        if source and config.model_name == "wanx2.1-imageedit":
            if len(cleaned) > 800:
                raise ValidationError("图像编辑描述不能超过 800 字符")
            if not (512 <= source.width <= 4096 and 512 <= source.height <= 4096):
                raise ValidationError("图像编辑原图宽高须为 512–4096 像素")
            if "outpaint" in safe_parameters:
                expansion_parameters(safe_parameters["outpaint"], source.width, source.height)
            elif safe_parameters.get("n", 1) != 1:
                raise ValidationError("图像编辑每次生成一张图片")
        if self.settings.model_endpoint(config.secret_ref) is None:
            raise ValidationError("Secret reference is not configured")
        hash_parameters = (
            {**safe_parameters, "input_sha256": source.sha256} if source else safe_parameters
        )
        request_hash = _request_hash(config.id, cleaned, hash_parameters)
        existing = await _by_key(uow.session, project_id, actor_id, key)
        if existing is not None:
            return _same_request(existing, request_hash)
        row = GenerationTask(
            id=uuid4(),
            project_id=project_id,
            actor_id=actor_id,
            model_config_id=config.id,
            config_version=config.config_version,
            idempotency_key=key,
            request_hash=request_hash,
            request_snapshot={
                "prompt": cleaned,
                "parameters": safe_parameters,
                **(
                    {"outpaint_protocol": 3}
                    if source and config.model_name == "wanx2.1-imageedit"
                    else {"outpaint_protocol": 2}
                    if "outpaint" in safe_parameters
                    else {}
                ),
                "operation": "image_outpaint"
                if "outpaint" in safe_parameters
                else ("image_inpaint" if source.mask_key else "image_to_image")
                if source
                else "text_to_image",
            },
            input_id=input_id,
            kind="image",
            status="queued",
            phase=None,
            progress=None,
            reconciliation_required=False,
            provider=config.provider,
            provider_task_id=None,
            error_code=None,
            error_message=None,
            lease_token=0,
            started_at=None,
            finished_at=None,
        )
        uow.session.add(row)
        try:
            await uow.session.flush()
            if commit:
                await uow.commit()
        except IntegrityError:
            if not commit:
                raise
            await uow.rollback()
            raced = await _by_key(uow.session, project_id, actor_id, key)
            if raced is None:
                raise ConflictError("Generation request conflicted") from None
            return _same_request(raced, request_hash)
        logger.info("image_generation_queued", task_id=str(row.id), project_id=str(project_id))
        return row

    async def get(self, uow: UnitOfWork, *, project_id: UUID, task_id: UUID) -> GenerationTask:
        row = await _get(uow.session, project_id, task_id)
        if row is None:
            raise NotFoundError("Generation task was not found")
        return row

    async def list_tasks(
        self,
        uow: UnitOfWork,
        *,
        project_id: UUID,
        limit: int = 20,
        offset: int = 0,
        kind: str | None = None,
    ) -> list[GenerationTask]:
        stmt = select(GenerationTask).where(GenerationTask.project_id == project_id)
        if kind is not None:
            stmt = stmt.where(GenerationTask.kind == kind)
        stmt = stmt.order_by(GenerationTask.created_at.desc(), GenerationTask.id.desc()).limit(
            min(max(limit, 1), 20)
        )
        return list((await uow.session.execute(stmt.offset(offset))).scalars().all())

    async def output_ids(
        self,
        uow: UnitOfWork,
        *,
        project_id: UUID,
        task_ids: list[UUID],
    ) -> dict[UUID, list[UUID]]:
        if not task_ids:
            return {}
        stmt = (
            select(GenerationOutput.task_id, GenerationOutput.asset_id, GenerationOutput.ordinal)
            .where(
                GenerationOutput.project_id == project_id,
                GenerationOutput.task_id.in_(task_ids),
            )
            .order_by(GenerationOutput.ordinal)
        )
        found: dict[UUID, list[UUID]] = {task_id: [] for task_id in task_ids}
        for task_id, asset_id, _ordinal in (await uow.session.execute(stmt)).all():
            found.setdefault(task_id, []).append(asset_id)
        return found

    async def cancel(self, uow: UnitOfWork, *, project_id: UUID, task_id: UUID) -> GenerationTask:
        row = await self.cancel_in_transaction(uow, project_id=project_id, task_id=task_id)
        await uow.commit()
        return row

    async def cancel_in_transaction(
        self, uow: UnitOfWork, *, project_id: UUID, task_id: UUID
    ) -> GenerationTask:
        stmt = (
            update(GenerationTask)
            .where(
                GenerationTask.id == task_id,
                GenerationTask.project_id == project_id,
                GenerationTask.kind == "image",
                GenerationTask.status == "queued",
            )
            .values(status="canceled", finished_at=datetime.now(UTC), updated_at=datetime.now(UTC))
            .returning(GenerationTask.id)
        )
        canceled = (await uow.session.execute(stmt)).one_or_none()
        if canceled is not None:
            await uow.session.flush()
            row = await _get(uow.session, project_id, task_id)
            if row is None:
                raise NotFoundError("Generation task was not found")
            return row
        row = await _get(uow.session, project_id, task_id)
        if row is None:
            raise NotFoundError("Generation task was not found")
        if row.status == "running":
            raise CancellationUnsupportedError(
                "This image generation cannot be canceled after it starts"
            )
        if row.kind != "image":
            raise NotFoundError("Generation task was not found")
        return row

    async def asset_for_download(
        self,
        uow: UnitOfWork,
        *,
        project_id: UUID,
        asset_id: UUID,
    ) -> Asset:
        stmt = select(Asset).where(
            Asset.id == asset_id,
            Asset.project_id == project_id,
            Asset.status == "ready",
        )
        asset = (await uow.session.execute(stmt)).scalar_one_or_none()
        if asset is None:
            raise NotFoundError("Asset was not found")
        return asset

    async def lock_asset_for_reference(
        self, uow: UnitOfWork, *, project_id: UUID, asset_id: UUID
    ) -> Asset:
        asset = await uow.session.scalar(
            select(Asset)
            .where(Asset.id == asset_id, Asset.project_id == project_id, Asset.status == "ready")
            .with_for_update()
        )
        if asset is None:
            raise NotFoundError("Asset was not found")
        return asset

    async def reference_image_bytes(self, uow, *, project_id, asset_id):
        """Authorized callers supply a project-scoped asset, never a remote URL."""
        from app.infrastructure.storage.objects import S3Storage

        asset = await self.asset_for_download(uow, project_id=project_id, asset_id=asset_id)
        if asset.kind != "IMAGE" or asset.size_bytes > self.settings.image_max_size:
            raise ValidationError("参考素材必须是大小限制内的图片")
        storage = self.storage
        if asset.storage_provider == "s3" and getattr(storage, "provider_name", None) == "qiniu":
            storage = S3Storage(self.settings)
        return await storage.get_object(object_key=asset.object_key)

    async def asset_for_member(
        self,
        uow: UnitOfWork,
        *,
        project_id: UUID,
        asset_id: UUID,
    ) -> Asset:
        asset = (
            await uow.session.execute(
                select(Asset).where(Asset.id == asset_id, Asset.project_id == project_id)
            )
        ).scalar_one_or_none()
        if asset is None:
            raise NotFoundError("Asset was not found")
        return asset

    async def project_images(self, uow, *, project_id):
        return list(
            await uow.session.scalars(
                select(Asset)
                .where(
                    Asset.project_id == project_id, Asset.kind == "IMAGE", Asset.status == "ready"
                )
                .order_by(Asset.created_at.desc())
                .limit(100)
            )
        )

    async def editor_assets(self, uow: UnitOfWork, *, project_id: UUID) -> list[Asset]:
        rows = await uow.session.execute(
            select(Asset)
            .where(Asset.project_id == project_id, Asset.status == "ready", Asset.kind == "VIDEO")
            .order_by(Asset.created_at.desc())
            .limit(100)
        )
        return list(rows.scalars())

    async def register_editor_output(
        self,
        uow: UnitOfWork,
        *,
        project_id: UUID,
        actor_id: UUID,
        asset_id: UUID,
        object_key: str,
        content: bytes,
        width: int,
        height: int,
    ) -> Asset:
        provider, bucket = storage_identity(self.storage, self.settings)
        asset = Asset(
            id=asset_id,
            project_id=project_id,
            created_by=actor_id,
            kind="VIDEO",
            status="ready",
            object_key=object_key,
            mime="video/mp4",
            size_bytes=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
            width=width,
            height=height,
            storage_provider=provider,
            bucket=bucket,
        )
        uow.session.add(asset)
        await uow.session.flush()
        return asset

    async def queued_ids(self, limit: int = 5) -> list[UUID]:
        factory = self._factory()
        async with factory() as session:
            stmt = (
                select(GenerationTask.id)
                .where(GenerationTask.status == "queued", GenerationTask.kind == "image")
                .order_by(GenerationTask.created_at)
                .limit(limit)
            )
            return list((await session.execute(stmt)).scalars().all())

    async def execute(self, task_id: UUID) -> None:
        claimed = await self._claim(task_id)
        if claimed is None:
            return
        project_id, actor_id, prompt, model_config_id, parameters = claimed
        try:
            async with self._factory()() as session:
                current = await session.get(GenerationTask, task_id)
                native_edit = current.request_snapshot.get("outpaint_protocol") == 3
            if "outpaint" in parameters or native_edit:
                await self._submit_outpaint(task_id)
                return
            images = await self._call_provider(model_config_id, prompt, parameters, task_id=task_id)
            await self._store(task_id, project_id, actor_id, images)
        except ApplicationError as exc:
            logger.info(
                "image_generation_failed",
                task_id=str(task_id),
                error_type=type(exc).__name__,
            )
            await self._fail(task_id, exc.code, exc.message)
        except Exception as exc:
            # Record locations only: exception messages/locals can contain credentials or images.
            frames = traceback.extract_tb(exc.__traceback__)
            logger.error(
                "image_generation_failed",
                task_id=str(task_id),
                error_type=type(exc).__name__,
                error_locations=[f"{frame.name}:{frame.lineno}" for frame in frames],
            )
            await self._fail(
                task_id,
                "processing_error",
                "图片处理发生异常，请稍后重试；管理员可通过任务记录定位原因",
            )

    async def _claim(self, task_id: UUID) -> tuple[UUID, UUID, str, UUID, dict] | None:
        factory = self._factory()
        async with factory() as session:
            stmt = (
                update(GenerationTask)
                .where(
                    GenerationTask.id == task_id,
                    GenerationTask.status == "queued",
                    GenerationTask.kind == "image",
                )
                .values(
                    status="running",
                    phase="generating",
                    started_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                )
                .returning(
                    GenerationTask.project_id,
                    GenerationTask.actor_id,
                    GenerationTask.request_snapshot,
                    GenerationTask.model_config_id,
                )
            )
            result = (await session.execute(stmt)).one_or_none()
            if result is None:
                await session.rollback()
                return None
            await session.commit()
            snapshot = result.request_snapshot
            prompt = snapshot.get("prompt") if isinstance(snapshot, dict) else None
            raw_parameters = snapshot.get("parameters") if isinstance(snapshot, dict) else None
            if not isinstance(prompt, str):
                await self._fail(task_id, "validation_error", "Prompt must be 1-10000 characters")
                return None
            parameters = raw_parameters if isinstance(raw_parameters, dict) else {}
            return result.project_id, result.actor_id, prompt, result.model_config_id, parameters

    async def _call_provider(
        self,
        model_config_id: UUID,
        prompt: str,
        parameters: dict,
        task_id: UUID | None = None,
    ) -> list[tuple[bytes, str]]:
        factory = self._factory()
        async with factory() as session:
            config = await session.get(ModelConfig, model_config_id)
            if (
                config is None
                or not config.enabled
                or config.capability not in {"text_to_image", "image_inpaint"}
            ):
                raise NotFoundError("Model config was not found")
            model_name = config.model_name
            secret_ref = config.secret_ref
            source = None
            task = await session.get(GenerationTask, task_id) if task_id else None
            if task is not None and task.input_id is not None:
                source = await require_input(session, task.project_id, task.input_id, inpaint=None)
        endpoint = self.settings.model_endpoint(secret_ref)
        if endpoint is None:
            raise ValidationError("Secret reference is not configured")
        base_url, api_key = endpoint
        if source is not None:
            image = await self.storage.get_object(object_key=source.image_key)
            if not source.mask_key:
                size, count = _provider_options(parameters)
                return await self.client.reference(
                    base_url=base_url,
                    api_key=api_key,
                    model=model_name,
                    prompt=prompt,
                    image=image,
                    size=size,
                    count=count,
                )
            mask = await self.storage.get_object(object_key=source.mask_key)
            images = await self.client.edit(
                base_url=base_url,
                api_key=api_key,
                model=model_name,
                prompt=prompt,
                image=image,
                mask=mask,
            )
            return await asyncio.to_thread(_composite_edits, image, mask, images)
        size, count = _provider_options(parameters)
        return await self.client.generate(
            base_url=base_url,
            api_key=api_key,
            model=model_name,
            prompt=prompt,
            size=size,
            count=count,
        )

    async def _submit_outpaint(self, task_id: UUID) -> None:
        async with self._factory()() as session:
            task = await session.get(GenerationTask, task_id)
            if task.request_snapshot.get("outpaint_protocol") not in {2, 3}:
                raise ValidationError("旧扩图任务已停止支持，请使用专用扩图重新提交")
            config = await session.get(ModelConfig, task.model_config_id)
            if (
                not config
                or not config.enabled
                or config.model_name not in {"image-out-painting", "wanx2.1-imageedit"}
            ):
                raise ValidationError("专用扩图模型已停用或不存在")
            endpoint = self.settings.model_endpoint(config.secret_ref)
            if not endpoint:
                raise ValidationError("扩图模型凭据未配置")
            source = await require_input(session, task.project_id, task.input_id, inpaint=None)
            parameters = task.request_snapshot["parameters"].get("outpaint", {})
        image = await self.storage.get_object(object_key=source.image_key)
        await self.save_outpaint_debug_assets(
            task,
            {
                "original.png": image,
                "request.json": json.dumps(
                    {
                        "model": config.model_name,
                        "operation": task.request_snapshot.get("operation"),
                        "prompt": task.request_snapshot.get("prompt"),
                        "parameters": parameters,
                    }
                ).encode(),
            },
        )
        # Persist intent before the irreversible submit. Unknown outcomes are never resubmitted.
        async with self._factory()() as session:
            await session.execute(
                update(GenerationTask)
                .where(GenerationTask.id == task_id)
                .values(
                    reconciliation_required=True,
                    phase="provider_submit",
                    updated_at=datetime.now(UTC),
                )
            )
            await session.commit()
        try:
            client = (
                self.image_edit_client
                if task.request_snapshot.get("outpaint_protocol") == 3
                else self.outpaint_client
            )
            extra = {}
            if task.request_snapshot.get("outpaint_protocol") == 3:
                extra = {
                    "operation": task.request_snapshot["operation"],
                    "prompt": task.request_snapshot["prompt"],
                    "mask": await self.storage.get_object(object_key=source.mask_key)
                    if source.mask_key
                    else None,
                }
            remote_id = await client.submit(
                base_url=endpoint[0],
                api_key=endpoint[1],
                image=image,
                parameters=parameters,
                **extra,
            )
        except ProviderTimeout:
            return
        async with self._factory()() as session:
            await session.execute(
                update(GenerationTask)
                .where(GenerationTask.id == task_id)
                .values(
                    provider_task_id=remote_id,
                    reconciliation_required=False,
                    phase="generating",
                    next_poll_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                )
            )
            await session.commit()

    async def poll_outpaints(self) -> None:
        """Short, leased queries. A process restart resumes remote IDs, never submits again."""
        now = datetime.now(UTC)
        async with self._factory()() as session:
            rows = list(
                (
                    await session.scalars(
                        select(GenerationTask)
                        .where(
                            GenerationTask.kind == "image",
                            GenerationTask.status == "running",
                            GenerationTask.request_snapshot["outpaint_protocol"]
                            .as_integer()
                            .in_([2, 3]),
                            GenerationTask.provider_task_id.is_not(None),
                            GenerationTask.reconciliation_required.is_(False),
                            (
                                GenerationTask.next_poll_at.is_(None)
                                | (GenerationTask.next_poll_at <= now)
                            ),
                            (
                                GenerationTask.lease_expires_at.is_(None)
                                | (GenerationTask.lease_expires_at <= now)
                            ),
                        )
                        .with_for_update(skip_locked=True)
                        .limit(1)
                    )
                ).all()
            )
            for row in rows:
                row.lease_token += 1
                row.lease_expires_at = now + timedelta(minutes=5)
                row.next_poll_at = now + timedelta(seconds=5)
            await session.commit()
        for task in rows:
            try:
                async with self._factory()() as session:
                    config = await session.get(ModelConfig, task.model_config_id)
                endpoint = self.settings.model_endpoint(config.secret_ref) if config else None
                if not endpoint:
                    raise ValidationError("扩图模型凭据未配置")
                client = (
                    self.image_edit_client
                    if task.request_snapshot.get("outpaint_protocol") == 3
                    else self.outpaint_client
                )
                state, result = await client.poll(
                    base_url=endpoint[0], api_key=endpoint[1], task_id=task.provider_task_id
                )
                if state == "succeeded":
                    await self._store(
                        task.id,
                        task.project_id,
                        task.actor_id,
                        [result],
                        lease_token=task.lease_token,
                    )
                elif state == "failed":
                    await self._fail(
                        task.id,
                        "provider_failed",
                        "扩图服务生成失败或已取消",
                        lease_token=task.lease_token,
                    )
            except Exception as exc:
                # Query/download failure is not evidence of generation failure.
                logger.warning(
                    "outpaint_poll_failed", task_id=str(task.id), error_type=type(exc).__name__
                )
            finally:
                async with self._factory()() as session:
                    await session.execute(
                        update(GenerationTask)
                        .where(
                            GenerationTask.id == task.id,
                            GenerationTask.lease_token == task.lease_token,
                            GenerationTask.status == "running",
                        )
                        .values(
                            lease_expires_at=None,
                            next_poll_at=datetime.now(UTC) + timedelta(seconds=5),
                            reconciliation_required=bool(
                                task.started_at and now - task.started_at > timedelta(hours=24)
                            ),
                        )
                    )
                    await session.commit()

    async def save_outpaint_debug_assets(self, task: GenerationTask, artifacts: dict) -> None:
        """Private project asset; index in PG, bytes in object storage, including failures."""
        import io
        import zipfile

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in artifacts.items():
                archive.writestr(name, data)
        content = buffer.getvalue()
        asset_id = uuid4()
        key = f"projects/{task.project_id}/assets/{asset_id}/outpaint-debug.zip"
        provider, bucket = storage_identity(self.storage, self.settings)
        factory = self._factory()
        async with factory() as session:
            session.add(
                Asset(
                    id=asset_id,
                    project_id=task.project_id,
                    kind="FILE",
                    object_key=key,
                    sha256=hashlib.sha256(content).hexdigest(),
                    mime="application/zip",
                    size_bytes=len(content),
                    status="uploading",
                    created_by=task.actor_id,
                    storage_provider=provider,
                    bucket=bucket,
                )
            )
            await session.commit()
        try:
            await self.storage.put_object(
                object_key=key, content=content, content_type="application/zip"
            )
        except Exception:
            async with factory() as session:
                await session.execute(
                    update(Asset).where(Asset.id == asset_id).values(status="failed")
                )
                await session.commit()
            raise
        async with factory() as session:
            row = (
                await session.execute(
                    select(GenerationTask)
                    .where(
                        GenerationTask.id == task.id, GenerationTask.project_id == task.project_id
                    )
                    .with_for_update()
                )
            ).scalar_one()
            row.request_snapshot = dict(row.request_snapshot, outpaint_debug_asset_id=str(asset_id))
            await session.execute(update(Asset).where(Asset.id == asset_id).values(status="ready"))
            await session.commit()

    async def _store(
        self,
        task_id: UUID,
        project_id: UUID,
        actor_id: UUID,
        images: list[tuple[bytes, str]],
        lease_token: int | None = None,
    ) -> None:
        del actor_id
        if lease_token is not None:
            factory = self._factory()
            async with factory() as session:
                task = await session.get(GenerationTask, task_id)
                if task is None or task.status != "running" or task.lease_token != lease_token:
                    return
        items = describe_outputs(project_id, task_id, images)
        for (content, _mime), item in zip(images, items, strict=True):
            await put_if_changed(
                self.storage,
                object_key=item["object_key"],
                content=content,
                content_type=item["mime"],
            )
        provider, bucket = storage_identity(self.storage, self.settings)
        factory = self._factory()
        async with factory() as session:
            await remember_objects(session, task_id, items)
        async with factory() as session:
            await register_stored_assets(
                session,
                task_id,
                storage_provider=provider,
                bucket=bucket,
            )
        logger.info("image_generation_succeeded", task_id=str(task_id))

    async def recover_persisted(self) -> None:
        factory = self._factory()
        async with factory() as session:
            task_ids = list(
                (
                    await session.execute(
                        select(GenerationTask.id)
                        .where(
                            GenerationTask.status == "running",
                            GenerationTask.phase == "persisting",
                            GenerationTask.kind == "image",
                        )
                        .limit(5)
                    )
                ).scalars()
            )
        provider, bucket = storage_identity(self.storage, self.settings)
        for task_id in task_ids:
            async with factory() as session:
                await register_stored_assets(
                    session,
                    task_id,
                    storage_provider=provider,
                    bucket=bucket,
                )

    async def _fail(
        self, task_id: UUID, code: str, message: str, lease_token: int | None = None
    ) -> None:
        factory = self._factory()
        async with factory() as session:
            await session.execute(
                update(GenerationTask)
                .where(
                    GenerationTask.id == task_id,
                    GenerationTask.status == "running",
                    *(
                        [GenerationTask.lease_token == lease_token]
                        if lease_token is not None
                        else []
                    ),
                )
                .values(
                    status="failed",
                    phase=None,
                    error_code=code,
                    error_message=(message or "")[:300] or None,
                    finished_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                )
            )
            await session.commit()

    def _factory(self) -> async_sessionmaker[AsyncSession]:
        if self.session_factory is None:
            raise RuntimeError("Image generation worker requires a session factory")
        return self.session_factory


def _clean_key(value: str) -> str:
    if _IDEMPOTENCY_KEY.fullmatch(value) is None:
        raise ValidationError("Idempotency key is invalid")
    return value


def _clean_prompt(value: str) -> str:
    cleaned = value.strip()
    if not 1 <= len(cleaned) <= PROMPT_MAX_LENGTH:
        raise ValidationError("Prompt must be 1-10000 characters")
    return cleaned


_IMAGE_SIZES = frozenset(
    {
        "1024x1024",
        "864x1152",
        "1152x864",
        "1280x720",
        "720x1280",
        "1248x832",
        "832x1248",
        "1568x672",
        "2048x2048",
        "1536x2048",
        "2048x1536",
        "2048x1152",
        "1152x2048",
        "2048x1366",
        "1366x2048",
        "2048x878",
    }
)


def _parameters(value: dict) -> dict:
    cleaned = json_object(value, label="Parameters")
    if set(cleaned) - {"size", "n"}:
        raise ValidationError("Parameters are not supported for this model")
    result: dict = {}
    if "n" in cleaned:
        count = cleaned["n"]
        if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 4:
            raise ValidationError("Image count must be 1-4")
        result["n"] = count
    if "size" in cleaned:
        size = cleaned["size"]
        if not isinstance(size, str) or size not in _IMAGE_SIZES:
            raise ValidationError("Image size is not supported")
        result["size"] = size
    return result


def _provider_options(parameters: dict) -> tuple[str | None, int]:
    size = parameters.get("size")
    count = parameters.get("n", 1)
    if size is not None and (not isinstance(size, str) or size not in _IMAGE_SIZES):
        raise ValidationError("Image size is not supported")
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 4:
        raise ValidationError("Image count must be 1-4")
    return (size if isinstance(size, str) else None), count


def _request_hash(model_config_id: UUID, prompt: str, parameters: dict) -> str:
    payload = json.dumps(
        {
            "model_config_id": str(model_config_id),
            "parameters": parameters,
            "prompt": prompt,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _same_request(existing: GenerationTask, request_hash: str) -> GenerationTask:
    if existing.request_hash != request_hash:
        raise ConflictError("Idempotency key was reused with a different request")
    return existing


async def _by_key(
    session: AsyncSession,
    project_id: UUID,
    actor_id: UUID,
    idempotency_key: str,
) -> GenerationTask | None:
    stmt = select(GenerationTask).where(
        GenerationTask.project_id == project_id,
        GenerationTask.actor_id == actor_id,
        GenerationTask.idempotency_key == idempotency_key,
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def _get(session: AsyncSession, project_id: UUID, task_id: UUID) -> GenerationTask | None:
    stmt = select(GenerationTask).where(
        GenerationTask.id == task_id,
        GenerationTask.project_id == project_id,
    )
    return (await session.execute(stmt)).scalar_one_or_none()
