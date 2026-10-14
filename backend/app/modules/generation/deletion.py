"""Soft-delete a work, then optionally enqueue deletion of the cloud object."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.modules.editor.models import EditorDocumentAsset, EditorRender, EditorRenderAsset
from app.modules.generation.models import Asset, AssetPurgeJob
from app.modules.settings.service import SettingsService


def deletion_plan(*, policy: str, editor_refs: int, other_ready: int) -> str:
    """Return blocked, retain, or purge. The policy argument is the snapshotted value."""

    if editor_refs > 0:
        return "blocked"
    if policy == "delete_cloud_file" and other_ready == 0:
        return "purge"
    return "retain"


def purge_outcome(missing: bool, failed: bool) -> str:
    if missing or not failed:
        return "purged"
    return "failed"


class AssetDeletionService:
    def __init__(self, settings_service: SettingsService) -> None:
        self._settings = settings_service

    async def delete(
        self,
        session: AsyncSession,
        *,
        project_id: UUID,
        asset_id: UUID,
        actor_id: UUID,
    ) -> dict:
        asset = await session.scalar(
            select(Asset)
            .where(Asset.id == asset_id, Asset.project_id == project_id)
            .with_for_update()
        )
        if asset is None:
            raise NotFoundError("Asset was not found")
        if asset.status == "deleted":
            job = await session.scalar(select(AssetPurgeJob).where(AssetPurgeJob.asset_id == asset.id))
            return _result(asset, job.policy if job else "retain_cloud_file", job.status if job else None)
        editor_refs = await _editor_refs(session, project_id, asset.id)
        other_ready = await session.scalar(
            select(func.count())
            .select_from(Asset)
            .where(
                Asset.object_key == asset.object_key,
                Asset.id != asset.id,
                Asset.status == "ready",
                Asset.deleted_at.is_(None),
            )
        )
        policy, revision = await self._settings.deletion_policy(session)
        plan = deletion_plan(policy=policy, editor_refs=editor_refs, other_ready=int(other_ready or 0))
        if plan == "blocked":
            raise ConflictError("作品仍被编辑器或导出任务使用，不能删除")
        now = datetime.now(UTC)
        asset.status = "deleted"
        asset.deleted_at = now
        asset.deleted_by = actor_id
        purge_status = None
        if plan == "purge":
            existing = await session.scalar(
                select(AssetPurgeJob).where(AssetPurgeJob.asset_id == asset.id)
            )
            if existing is None:
                session.add(
                    AssetPurgeJob(
                        asset_id=asset.id,
                        project_id=project_id,
                        object_key=asset.object_key,
                        storage_provider=asset.storage_provider,
                        bucket=asset.bucket,
                        policy=policy,
                        settings_revision=revision,
                        status="pending",
                    )
                )
            asset.purge_status = "pending"
            purge_status = "pending"
        await session.commit()
        return _result(asset, policy, purge_status)


async def _editor_refs(session: AsyncSession, project_id: UUID, asset_id: UUID) -> int:
    document = await session.scalar(
        select(func.count())
        .select_from(EditorDocumentAsset)
        .where(
            EditorDocumentAsset.project_id == project_id,
            EditorDocumentAsset.asset_id == asset_id,
        )
    )
    render = await session.scalar(
        select(func.count())
        .select_from(EditorRenderAsset)
        .where(EditorRenderAsset.project_id == project_id, EditorRenderAsset.asset_id == asset_id)
    )
    output = await session.scalar(
        select(func.count())
        .select_from(EditorRender)
        .where(EditorRender.project_id == project_id, EditorRender.output_asset_id == asset_id)
    )
    return int(document or 0) + int(render or 0) + int(output or 0)


async def process_purge_jobs(session_factory, settings) -> None:
    """Delete cloud objects for jobs that were queued under the cleanup policy."""

    from app.infrastructure.storage.objects import QiniuObjectStorage
    from app.infrastructure.storage.s3 import S3Storage

    qiniu = QiniuObjectStorage(settings) if settings.qiniu_configured else None
    s3 = S3Storage(settings) if settings.s3_endpoint_url.strip() else None
    async with session_factory() as session:
        jobs = (
            await session.execute(
                select(AssetPurgeJob)
                .where(AssetPurgeJob.status.in_(("pending", "failed")), AssetPurgeJob.attempts < 8)
                .limit(5)
                .with_for_update(skip_locked=True)
            )
        ).scalars().all()
        for job in jobs:
            others = await session.scalar(
                select(func.count())
                .select_from(Asset)
                .where(
                    Asset.object_key == job.object_key,
                    Asset.id != job.asset_id,
                    Asset.status == "ready",
                    Asset.deleted_at.is_(None),
                )
            )
            if int(others or 0) > 0:
                job.attempts += 1
                job.status = "failed" if job.attempts >= 8 else "pending"
                job.last_error = "云端文件仍被其他作品引用"
                continue
            storage = qiniu if job.storage_provider == "qiniu" else s3
            if storage is None:
                job.attempts += 1
                job.status = "failed"
                job.last_error = "对象存储未配置，无法清理云端文件"
                continue
            try:
                await storage.delete_object(object_key=job.object_key)
            except Exception:
                job.attempts += 1
                job.status = "failed"
                job.last_error = "云端文件清理失败，将重试"
                continue
            job.status = "purged"
            job.last_error = None
            asset = await session.get(Asset, job.asset_id)
            if asset is not None:
                asset.purge_status = "purged"
        await session.commit()


def migration_decision(*, provider: str, readable: bool) -> str:
    if provider == "qiniu":
        return "skipped"
    if not readable:
        return "unrecoverable"
    return "migrate"


def _result(asset: Asset, policy: str, purge_status: str | None) -> dict:
    return {
        "asset_id": asset.id,
        "deleted_at": asset.deleted_at,
        "policy": policy,
        "purge_status": purge_status,
    }
