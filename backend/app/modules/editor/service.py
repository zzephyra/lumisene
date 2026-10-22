import asyncio
import hashlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from app.core.config import Settings
from app.core.errors import ConflictError, DomainError, NotFoundError, VersionConflictError
from app.core.logging import get_logger
from app.infrastructure.db.session import UnitOfWork
from app.infrastructure.media.render import render
from app.modules.auth.service import AuthService
from app.modules.editor.models import (
    EditorDocument,
    EditorDocumentAsset,
    EditorRender,
    EditorRenderAsset,
)
from app.modules.editor.schemas import Composition, CreateDocument, SaveDocument
from app.modules.generation.service import ImageGenerationService
from app.modules.projects.service import ProjectService
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

if TYPE_CHECKING:
    from app.modules.generation.models import Asset

logger = get_logger(__name__)
MAX_SOURCE_BYTES = 256 * 1024 * 1024


class EditorService:
    def __init__(self, settings: Settings, assets: ImageGenerationService | None = None) -> None:
        self.projects = ProjectService(AuthService(settings))
        self.assets = assets or ImageGenerationService(settings)

    async def authorize(self, uow: UnitOfWork, project_id: UUID, actor_id: UUID) -> None:
        await self.projects.authorize_content_write(uow, actor_id, project_id)

    async def validate_assets(
        self, uow: UnitOfWork, project_id: UUID, composition: Composition
    ) -> dict[str, "Asset"]:
        assets = {}
        for asset_id in {c.asset_id for c in composition.tracks[0].clips}:
            asset = await self.assets.asset_for_download(
                uow, project_id=project_id, asset_id=asset_id
            )
            if asset.kind != "VIDEO" or asset.size_bytes > MAX_SOURCE_BYTES:
                raise DomainError("编辑器仅支持不超过 256 MiB 的视频")
            assets[str(asset_id)] = asset
        if sum(a.size_bytes for a in assets.values()) > MAX_SOURCE_BYTES * 2:
            raise DomainError("工程素材总量不能超过 512 MiB")
        return assets

    async def get(
        self,
        uow: UnitOfWork,
        project_id: UUID,
        actor_id: UUID,
        document_id: UUID,
        *,
        lock: bool = False,
    ) -> EditorDocument:
        await self.authorize(uow, project_id, actor_id)
        stmt = select(EditorDocument).where(
            EditorDocument.project_id == project_id, EditorDocument.id == document_id
        )
        if lock:
            stmt = stmt.with_for_update()
        document = (await uow.session.execute(stmt)).scalar_one_or_none()
        if document is None:
            raise NotFoundError("剪辑工程不存在")
        return document

    async def list(self, uow: UnitOfWork, project_id: UUID, actor_id: UUID) -> list[EditorDocument]:
        await self.authorize(uow, project_id, actor_id)
        return list(
            (
                await uow.session.execute(
                    select(EditorDocument)
                    .where(EditorDocument.project_id == project_id)
                    .order_by(EditorDocument.updated_at.desc())
                    .limit(100)
                )
            ).scalars()
        )

    async def create(
        self,
        uow: UnitOfWork,
        project_id: UUID,
        actor_id: UUID,
        payload: CreateDocument,
        *,
        commit: bool = True,
    ) -> EditorDocument:
        await self.authorize(uow, project_id, actor_id)
        await self.validate_assets(uow, project_id, payload.composition)
        row = EditorDocument(
            project_id=project_id,
            created_by=actor_id,
            title=payload.title,
            composition=payload.composition.model_dump(mode="json"),
            version=1,
        )
        uow.session.add(row)
        await uow.session.flush()
        await self.replace_document_assets(uow, row)
        if commit:
            await uow.commit()
        return row

    async def save(
        self,
        uow: UnitOfWork,
        project_id: UUID,
        actor_id: UUID,
        document_id: UUID,
        payload: SaveDocument,
    ) -> EditorDocument:
        row = await self.get(uow, project_id, actor_id, document_id, lock=True)
        if row.version != payload.expected_version:
            raise VersionConflictError("工程已被其他页面修改，请保留本地工程后重新打开")
        await self.validate_assets(uow, project_id, payload.composition)
        row.title, row.composition = payload.title, payload.composition.model_dump(mode="json")
        row.version += 1
        row.updated_at = datetime.now(UTC)
        await self.replace_document_assets(uow, row)
        await uow.commit()
        return row

    async def submit(
        self,
        uow: UnitOfWork,
        project_id: UUID,
        actor_id: UUID,
        document_id: UUID,
        version: int,
        key: str,
        *,
        commit: bool = True,
    ) -> EditorRender:
        if not key.strip() or len(key) > 128:
            raise DomainError("Invalid idempotency key")
        row = await self.get(uow, project_id, actor_id, document_id, lock=True)
        fingerprint = hashlib.sha256(f"{document_id}:{version}".encode()).hexdigest()
        stmt = select(EditorRender).where(
            EditorRender.project_id == project_id,
            EditorRender.actor_id == actor_id,
            EditorRender.idempotency_key == key,
        )
        existing = (await uow.session.execute(stmt)).scalar_one_or_none()
        if existing:
            if existing.request_hash != fingerprint:
                raise ConflictError("此请求标识已用于其他导出")
            return existing
        if row.version != version:
            raise VersionConflictError("请先保存最新工程")
        if not row.composition["tracks"][0]["clips"]:
            raise DomainError("请先添加视频片段")
        await self.validate_assets(uow, project_id, Composition.model_validate(row.composition))
        active = (
            await uow.session.execute(
                select(EditorRender.id).where(
                    EditorRender.document_id == document_id,
                    EditorRender.status.in_(["queued", "running"]),
                )
            )
        ).first()
        if active:
            raise ConflictError("此工程已有导出正在处理")
        task = EditorRender(
            project_id=project_id,
            actor_id=actor_id,
            document_id=document_id,
            idempotency_key=key,
            request_hash=fingerprint,
            snapshot=row.composition,
            status="queued",
        )
        uow.session.add(task)
        try:
            await uow.session.flush()
            for asset_id in {UUID(c["asset_id"]) for c in row.composition["tracks"][0]["clips"]}:
                uow.session.add(
                    EditorRenderAsset(project_id=project_id, render_id=task.id, asset_id=asset_id)
                )
            if commit:
                await uow.commit()
        except IntegrityError:
            if not commit:
                raise
            await uow.rollback()
            existing = (await uow.session.execute(stmt)).scalar_one()
            if existing.request_hash != fingerprint:
                raise ConflictError("此请求标识已用于其他导出") from None
            return existing
        return task

    async def task(
        self, uow: UnitOfWork, project_id: UUID, actor_id: UUID, task_id: UUID
    ) -> EditorRender:
        await self.authorize(uow, project_id, actor_id)
        row = (
            await uow.session.execute(
                select(EditorRender).where(
                    EditorRender.project_id == project_id, EditorRender.id == task_id
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFoundError("导出任务不存在")
        return row

    async def replace_document_assets(self, uow: UnitOfWork, row: EditorDocument) -> None:
        await uow.session.execute(
            delete(EditorDocumentAsset).where(
                EditorDocumentAsset.project_id == row.project_id,
                EditorDocumentAsset.document_id == row.id,
            )
        )
        for asset_id in {UUID(c["asset_id"]) for c in row.composition["tracks"][0]["clips"]}:
            uow.session.add(
                EditorDocumentAsset(
                    project_id=row.project_id, document_id=row.id, asset_id=asset_id
                )
            )
        await uow.session.flush()

    async def latest_render(
        self, uow: UnitOfWork, project_id: UUID, actor_id: UUID, document_id: UUID
    ) -> EditorRender | None:
        await self.get(uow, project_id, actor_id, document_id)
        return (
            await uow.session.execute(
                select(EditorRender)
                .where(
                    EditorRender.project_id == project_id, EditorRender.document_id == document_id
                )
                .order_by(EditorRender.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def execute_next(self, factory: async_sessionmaker[AsyncSession]) -> bool:
        async with factory() as session:
            # Bounded execution is 15 minutes; interrupted workers are visible failures after 20.
            await session.execute(
                update(EditorRender)
                .where(
                    EditorRender.status == "running",
                    EditorRender.updated_at < datetime.now(UTC) - timedelta(minutes=20),
                )
                .values(status="failed", error="导出进程中断，请重新导出")
            )
            row = (
                await session.execute(
                    select(EditorRender)
                    .where(EditorRender.status == "queued")
                    .order_by(EditorRender.created_at)
                    .with_for_update(skip_locked=True)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if row is None:
                await session.commit()
                return False
            row.status = "running"
            row.updated_at = datetime.now(UTC)
            task_id, project_id, actor_id, snapshot = (
                row.id,
                row.project_id,
                row.actor_id,
                row.snapshot,
            )
            await session.commit()
        try:
            async with asyncio.timeout(900):
                async with factory() as session:
                    uow = UnitOfWork(session)
                    await self.authorize(uow, project_id, actor_id)
                    assets = await self.validate_assets(
                        uow, project_id, Composition.model_validate(snapshot)
                    )
                    keys = {key: asset.object_key for key, asset in assets.items()}
                with TemporaryDirectory(prefix="fluxora-edit-") as tmp:
                    paths = {}
                    for key, object_key in keys.items():
                        data = await self.assets.storage.get_object(object_key=object_key)
                        if len(data) > MAX_SOURCE_BYTES:
                            raise DomainError("源视频超出处理限制")
                        path = Path(tmp) / f"{key}.mp4"
                        await asyncio.to_thread(path.write_bytes, data)
                        paths[key] = path
                    output = await render(snapshot, paths, Path(tmp))
                    if output.stat().st_size > MAX_SOURCE_BYTES:
                        raise DomainError("导出文件超过 256 MiB")
                    content = await asyncio.to_thread(output.read_bytes)
                asset_id = uuid4()
                object_key = f"projects/{project_id}/editor/{task_id}/{asset_id}.mp4"
                await self.assets.storage.put_object(
                    object_key=object_key, content=content, content_type="video/mp4"
                )
                async with factory() as session:
                    uow = UnitOfWork(session)
                    await self.authorize(uow, project_id, actor_id)
                    task = (
                        await session.execute(
                            select(EditorRender)
                            .where(EditorRender.id == task_id, EditorRender.status == "running")
                            .with_for_update()
                        )
                    ).scalar_one_or_none()
                    if task is None:
                        return True
                    await self.assets.register_editor_output(
                        uow,
                        project_id=project_id,
                        actor_id=actor_id,
                        asset_id=asset_id,
                        object_key=object_key,
                        content=content,
                        width=snapshot["width"],
                        height=snapshot["height"],
                    )
                    task.status, task.output_asset_id = "succeeded", asset_id
                    await uow.commit()
        except Exception as exc:
            logger.warning(
                "editor_render_failed", task_id=str(task_id), error_type=type(exc).__name__
            )
            async with factory() as session:
                await session.execute(
                    update(EditorRender)
                    .where(EditorRender.id == task_id, EditorRender.status == "running")
                    .values(status="failed", error="视频导出失败，请检查素材可用性后重试")
                )
                await session.commit()
        return True
