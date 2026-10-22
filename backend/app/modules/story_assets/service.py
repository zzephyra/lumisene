import asyncio
from collections import OrderedDict

from sqlalchemy import func, select

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.infrastructure.storage.objects import QiniuObjectStorage
from app.infrastructure.storage.s3 import S3Storage
from app.modules.generation.deletion import AssetDeletionService
from app.modules.settings.service import SettingsService
from app.modules.story_assets.media import FORMATS, thumbnail, validate_signature
from app.modules.story_assets.models import StoryAssetLink
from app.modules.story_assets.repository import LibraryRepository
from app.modules.story_assets.schemas import LibraryAsset, LibraryOptions, LibraryPage

_THUMBNAILS: OrderedDict[str, bytes] = OrderedDict()
_ALLOWED = [mime for values in FORMATS.values() for mime in values]


class StoryAssetService:
    def __init__(self, stories, characters, plots, generations, settings, upload_storage=None):
        self.stories = stories
        self.characters = characters
        self.plots = plots
        self.generations = generations
        self.settings = settings
        self.uploads = stories.uploads
        self.upload_storage = upload_storage or QiniuObjectStorage(settings)
        self.repo = LibraryRepository()

    async def authorize(self, uow, actor, project, story, write=False):
        await self.stories.get(uow, actor, project, story)
        if write:
            await self.stories.projects.authorize_content_write(uow, actor, project)

    def view(self, row, actor, project, story):
        source, identity = row["source"], row["id"]
        root = f"/api/v1/projects/{project}/stories/{story}/resources/{source}/{identity}"
        image = row["kind"] == "image"
        return LibraryAsset(
            id=identity,
            source=source,
            asset_id=identity if source == "generated" else None,
            upload_id=identity if source == "upload" else None,
            name=row["name"],
            filename=row["filename"],
            kind=row["kind"],
            mime=row["mime"],
            size=row["size"],
            width=row["width"],
            height=row["height"],
            duration_ms=row["duration_ms"],
            created_at=row["created_at"],
            references=row["references"],
            category=row["category"],
            direct_link_id=row["direct_link_id"],
            preview_url=root + "/content",
            thumbnail_url=root + "/thumbnail" if image else None,
            can_delete=bool(row["direct_link_id"])
            and row["owner_id"] == actor
            and len(row["references"]) == 1,
        )

    async def options(self, uow, actor, project, story):
        await self.authorize(uow, actor, project, story)
        return LibraryOptions(
            limits={
                "image": self.settings.image_max_size,
                "video": self.settings.video_max_size,
                "file": self.settings.file_max_size,
            },
            formats=FORMATS,
        )

    async def list(
        self,
        uow,
        actor,
        project,
        story,
        category="all",
        search="",
        sort="newest",
        offset=0,
        limit=30,
    ):
        await self.authorize(uow, actor, project, story)
        query = self.repo.query(project, story, category, search)
        count = await uow.session.scalar(select(func.count()).select_from(query))
        if sort == "name":
            order = query.c.name.asc()
        elif sort == "oldest":
            order = query.c.added_at.asc()
        else:
            order = query.c.added_at.desc()
        rows = (
            await uow.session.execute(
                select(query)
                .order_by(order, query.c.source, query.c.id)
                .offset(offset)
                .limit(limit)
            )
        ).mappings().all()
        next_offset = offset + limit if offset + limit < count else None
        return LibraryPage(
            items=[self.view(row, actor, project, story) for row in rows],
            total=count,
            next_offset=next_offset,
        )

    async def detail(self, uow, actor, project, story, source, identity):
        await self.authorize(uow, actor, project, story)
        query = self.repo.query(project, story)
        row = (
            await uow.session.execute(
                select(query).where(query.c.source == source, query.c.id == identity)
            )
        ).mappings().one_or_none()
        if row is None:
            raise NotFoundError("资源不属于当前剧本")
        return self.view(row, actor, project, story)

    async def attach(self, uow, actor, project, story, payload):
        await self.authorize(uow, actor, project, story, True)
        source = "upload" if payload.upload_id else "generated"
        identity = payload.upload_id or payload.asset_id
        if source == "upload":
            media = await self.uploads.lock_owned(uow.session, actor, identity)
            if media.content_type not in _ALLOWED:
                raise ValidationError("资源库仅支持图片、视频及 PDF/TXT/Markdown")
            content = await self.upload_storage.get_prefix(
                object_key=media.object_key, max_bytes=65536
            )
            validate_signature(media.content_type, content)
            filename = media.original_filename
        else:
            media = await self.generations.lock_asset_for_reference(
                uow, project_id=project, asset_id=identity
            )
            if media.mime not in _ALLOWED:
                raise ValidationError("此文件类型不能添加到资源库")
            filename = f"生成作品 · {identity}"
        if payload.scene_id:
            await self.plots.detail(uow, actor, project, story, payload.scene_id, scene=True)
            if payload.category != "scene":
                raise ValidationError("场景引用需要选择场景分类")
        link = await self.repo.link(uow.session, project, story, source, identity)
        if link is None:
            link = StoryAssetLink(
                project_id=project,
                story_id=story,
                upload_id=payload.upload_id,
                asset_id=payload.asset_id,
                name=payload.name.strip() or filename,
                category=payload.category,
                scene_id=payload.scene_id,
                created_by=actor,
            )
            uow.session.add(link)
        await uow.commit()
        return await self.detail(uow, actor, project, story, source, identity)

    async def rename(self, uow, actor, project, story, source, identity, name):
        await self.authorize(uow, actor, project, story, True)
        link = await self.repo.link(uow.session, project, story, source, identity)
        if link is None:
            raise ConflictError("人物图片名称由人物档案维护")
        if not name.strip():
            raise ValidationError("名称不能为空")
        link.name = name.strip()
        await uow.commit()
        return await self.detail(uow, actor, project, story, source, identity)

    async def remove(self, uow, actor, project, story, source, identity, original=False):
        await self.authorize(uow, actor, project, story, True)
        if source == "upload":
            media = await self.uploads.lock_referenced(uow.session, identity)
            owner = media.user_id
        else:
            media = await self.generations.lock_asset_for_reference(
                uow, project_id=project, asset_id=identity
            )
            owner = media.created_by
        link = await self.repo.link(uow.session, project, story, source, identity)
        if link is None:
            raise ConflictError("没有可移除的直接引用，请前往人物档案管理图片")
        if original and owner != actor:
            raise ConflictError("只有原文件所有者可以删除原始资源")
        await uow.session.delete(link)
        await uow.session.flush()
        policy, _revision = await SettingsService(self.settings).deletion_policy(uow.session)
        if original and source == "upload":
            await self.uploads.delete(uow, actor, identity)
        elif original:
            await AssetDeletionService(SettingsService(self.settings)).delete(
                uow.session, project_id=project, asset_id=identity, actor_id=actor
            )
        else:
            await uow.commit()
        return {"removed": True, "policy": policy}

    async def content(self, uow, actor, project, story, source, identity, mode="content"):
        view = await self.detail(uow, actor, project, story, source, identity)
        if source == "upload":
            media = await self.uploads.referenced_file(uow.session, identity)
            storage = self.upload_storage
        else:
            media = await self.generations.asset_for_download(
                uow, project_id=project, asset_id=identity
            )
            storage = self.generations.storage
            provider = getattr(storage, "provider_name", None)
            if media.storage_provider == "s3" and provider == "qiniu":
                storage = S3Storage(self.settings)
        key = media.object_key
        await uow.commit()
        if mode == "thumbnail":
            if view.kind != "image" or view.size > self.settings.image_max_size:
                raise ValidationError("此资源没有图片缩略图")
            cache_key = f"{source}:{identity}"
            if cache_key not in _THUMBNAILS:
                data = await storage.get_object(object_key=key)
                _THUMBNAILS[cache_key] = await asyncio.to_thread(thumbnail, data)
                while len(_THUMBNAILS) > 128:
                    _THUMBNAILS.popitem(last=False)
            return "bytes", _THUMBNAILS[cache_key], "image/jpeg"
        if mode == "text":
            text_ready = view.mime in ("text/plain", "text/markdown") and view.size <= 1024 * 1024
            if not text_ready:
                raise ValidationError("仅支持预览 1MB 以内的 UTF-8 文本文档，请下载原文件")
            data = await storage.get_object(object_key=key)
            try:
                return "text", data.decode("utf-8-sig"), "text/plain"
            except UnicodeDecodeError as exc:
                raise ValidationError("无法解码，请下载原文件") from exc
        signer = getattr(storage, "signed_download_url", None)
        if signer:
            return "redirect", await signer(object_key=key), view.mime
        return "bytes", await storage.get_object(object_key=key), view.mime
