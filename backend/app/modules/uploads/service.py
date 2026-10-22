"""Issue direct-upload credentials and record files after the object store confirms them."""

import asyncio
from datetime import UTC, datetime
from uuid import UUID, uuid4

from app.core.config import Settings
from app.core.errors import (
    ConflictError,
    NotFoundError,
    ProviderError,
    StorageUnavailableError,
    ValidationError,
)
from app.core.logging import get_logger
from app.infrastructure.db.session import UnitOfWork
from app.infrastructure.storage.provider import StorageProvider
from app.infrastructure.storage.qiniu import QiniuStorageProvider
from app.modules.uploads.domain import (
    display_filename,
    extension_for,
    key_belongs_to_user,
    object_key,
)
from app.modules.uploads.models import UploadFile
from app.modules.uploads.repository import UploadRepository

logger = get_logger(__name__)


class UploadService:
    def __init__(
        self,
        settings: Settings,
        provider: StorageProvider | None = None,
        repository: UploadRepository | None = None,
    ) -> None:
        self.settings = settings
        self.provider = provider or QiniuStorageProvider(settings)
        self.repository = repository or UploadRepository()

    async def issue_token(
        self,
        uow: UnitOfWork,
        user_id: UUID,
        *,
        filename: str,
        content_type: str,
        size: int,
        category: str,
        key: str | None,
    ) -> tuple[str, str, str, str, int]:
        self._require_storage()
        name = display_filename(filename)
        extension = extension_for(name, content_type, category)
        limit = self.settings.upload_size_limit(category)
        if size > limit:
            raise ValidationError(
                "File is too large",
                details={"reason": "file_size", "max_size": limit},
            )
        mime = content_type.strip().lower()
        if key is None:
            upload = UploadFile(
                id=uuid4(),
                user_id=user_id,
                bucket=self.settings.qiniu_bucket.strip(),
                object_key="",
                original_filename=name,
                content_type=mime,
                size=size,
                category=category,
                status="pending",
                provider="qiniu",
            )
            upload.object_key = object_key(
                category,
                user_id,
                extension,
                datetime.now(UTC),
                upload.id,
            )
            await self.repository.add(uow.session, upload)
            await uow.session.flush()
            await uow.commit()
        else:
            upload = await self._pending(uow, user_id, key, mime, size, category)
        grant = await asyncio.to_thread(
            self.provider.generate_upload_token,
            key=upload.object_key,
            content_type=mime,
            size=size,
        )
        logger.info(
            "upload_token_generated",
            user_id=str(user_id),
            key=upload.object_key,
            category=category,
            size=size,
        )
        return grant.token, upload.object_key, grant.domain, grant.upload_url, grant.expires_in

    async def complete(self, uow: UnitOfWork, user_id: UUID, key: str) -> UploadFile:
        self._require_storage()
        if not key_belongs_to_user(key, user_id):
            raise NotFoundError("Upload was not found")
        upload = await self.repository.get_by_key_for_user(uow.session, user_id, key)
        if upload is None or upload.status == "deleted":
            raise NotFoundError("Upload was not found")
        if upload.status == "uploaded":
            return upload
        if upload.status == "failed":
            raise ValidationError("Upload could not be confirmed")
        try:
            stat = await asyncio.to_thread(self.provider.stat, key)
        except ProviderError:
            logger.info(
                "upload_failed",
                user_id=str(user_id),
                key=key,
                category=upload.category,
                size=upload.size,
            )
            raise
        limit = self.settings.upload_size_limit(upload.category)
        if stat is None:
            raise ValidationError("Upload could not be confirmed")
        if (
            stat.size < 1
            or stat.size > upload.size
            or stat.size > limit
            or stat.mime_type != upload.content_type
        ):
            upload.status = "failed"
            upload.updated_at = datetime.now(UTC)
            await uow.session.flush()
            await uow.commit()
            await asyncio.to_thread(self.provider.delete, key)
            logger.info(
                "upload_failed",
                user_id=str(user_id),
                key=key,
                category=upload.category,
                size=upload.size,
            )
            raise ValidationError("Upload could not be confirmed")
        upload.status = "uploaded"
        upload.size = stat.size
        upload.url = self.provider.public_url(key)
        upload.updated_at = datetime.now(UTC)
        await uow.session.flush()
        await uow.commit()
        logger.info(
            "upload_completed",
            user_id=str(user_id),
            key=key,
            category=upload.category,
            size=stat.size,
        )
        return upload

    async def delete(self, uow: UnitOfWork, user_id: UUID, upload_id: UUID) -> None:
        upload = await self.repository.get_for_user(uow.session, user_id, upload_id)
        owned = upload is not None and key_belongs_to_user(upload.object_key, user_id)
        if upload is None or upload.status == "deleted" or not owned:
            raise NotFoundError("Upload was not found")
        if await self._still_referenced(uow, upload_id):
            raise ConflictError("文件仍被人物、剧本封面或资源库引用，不能删除")
        self._require_storage()
        await asyncio.to_thread(self.provider.delete, upload.object_key)
        upload.status = "deleted"
        upload.deleted_at = datetime.now(UTC)
        upload.updated_at = upload.deleted_at
        await uow.session.flush()
        await uow.commit()
        logger.info(
            "upload_deleted",
            user_id=str(user_id),
            key=upload.object_key,
            category=upload.category,
            size=upload.size,
        )

    async def lock_owned(self, session, user_id: UUID, upload_id: UUID) -> UploadFile:
        upload = await self.repository.lock_uploaded(session, upload_id, user_id)
        if upload is None:
            raise NotFoundError("上传文件不存在")
        return upload

    async def lock_referenced(self, session, upload_id: UUID) -> UploadFile:
        upload = await self.repository.lock_uploaded(session, upload_id)
        if upload is None:
            raise NotFoundError("上传文件不存在")
        return upload

    async def referenced_file(self, session, upload_id: UUID) -> UploadFile:
        rows = await self.repository.uploaded_by_ids(session, {upload_id})
        if not rows:
            raise NotFoundError("上传文件不存在")
        return rows[0]

    async def list_uploaded(self, uow: UnitOfWork, user_id: UUID) -> list[UploadFile]:
        return await self.repository.list_uploaded(uow.session, user_id, 50)

    async def owned_image(self, session, user_id: UUID, upload_id: UUID) -> UploadFile:
        upload = await self.repository.get_for_user(session, user_id, upload_id)
        if (
            upload is None
            or upload.status != "uploaded"
            or upload.category != "image"
            or upload.content_type not in {"image/jpeg", "image/png", "image/webp"}
            or not upload.url
        ):
            raise NotFoundError("封面不存在")
        return upload

    async def referenced_image_key(self, session, upload_id: UUID) -> str:
        """For an already-authorized entity reference, never an arbitrary client upload ID."""
        rows = await self.repository.uploaded_by_ids(session, {upload_id})
        if not rows or rows[0].category != "image":
            raise NotFoundError("人物图片不存在")
        return rows[0].object_key

    async def cover_urls(self, session, upload_ids: set[UUID]) -> dict[UUID, str]:
        rows = await self.repository.uploaded_by_ids(session, upload_ids)
        return {
            row.id: row.url
            for row in rows
            if row.category == "image" and row.content_type.startswith("image/") and row.url
        }

    async def _pending(
        self,
        uow: UnitOfWork,
        user_id: UUID,
        key: str,
        mime: str,
        size: int,
        category: str,
    ) -> UploadFile:
        if not key_belongs_to_user(key, user_id):
            raise NotFoundError("Upload was not found")
        upload = await self.repository.get_by_key_for_user(uow.session, user_id, key)
        if upload is None or upload.status != "pending":
            raise NotFoundError("Upload was not found")
        if upload.content_type != mime or upload.size != size or upload.category != category:
            raise ValidationError("Upload could not be confirmed")
        return upload

    async def _still_referenced(self, uow: UnitOfWork, upload_id: UUID) -> bool:
        from app.modules.characters.image_references import character_upload_references
        from app.modules.production.references import production_upload_references
        from app.modules.stories.references import story_cover_references
        from app.modules.story_assets.references import story_asset_references

        return bool(
            await production_upload_references(uow.session, upload_id)
            or await character_upload_references(uow.session, upload_id)
            or await story_cover_references(uow.session, upload_id)
            or await story_asset_references(uow.session, upload_id=upload_id)
        )

    def _require_storage(self) -> None:
        if not self.settings.qiniu_configured:
            raise StorageUnavailableError("Upload storage is not configured")
