"""Queue one explicit text-to-video generation and finish it outside the request."""

import asyncio
import hashlib
import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Protocol
from uuid import UUID, uuid4

from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.errors import (
    ApplicationError,
    CancellationUnsupportedError,
    ConflictError,
    NotFoundError,
    ProviderTaskFailedError,
    ValidationError,
)
from app.core.errors import TimeoutError as ProviderTimeout
from app.core.logging import get_logger
from app.infrastructure.ai.adapters.dashscope_video import DashScopeVideo
from app.infrastructure.ai.catalog import (
    require_assigned,
    require_editor_model,
)
from app.infrastructure.ai.domain import json_object
from app.infrastructure.ai.models import ModelConfig
from app.infrastructure.ai.video_parameters import validate_video_parameters
from app.infrastructure.db.session import UnitOfWork
from app.infrastructure.media.render import probe
from app.infrastructure.storage.objects import build_object_storage
from app.modules.generation.inputs import require_input
from app.modules.generation.models import GenerationTask
from app.modules.generation.persistence import (
    describe_outputs,
    put_if_changed,
    register_stored_assets,
    remember_objects,
    storage_identity,
)

logger = get_logger(__name__)
_IDEMPOTENCY_KEY = re.compile(r"^[\x21-\x7e]{1,128}$")
_VIDEO_SIZES = frozenset({"1920*1080", "1080*1920", "1440*1440"})
_VIDEO_PROMPT_MAX = 800
_ACTIVE = ("submitting", "running")


class VideoClient(Protocol):
    async def submit(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        prompt: str,
        size: str | None,
        duration: int,
        image: bytes | None = None,
        resolution: str | None = None,
    ) -> str:
        """Return the provider task id. A timeout must stay distinguishable from rejection."""

    async def poll(
        self,
        *,
        base_url: str,
        api_key: str,
        provider_task_id: str,
    ) -> tuple[str, tuple[bytes, str] | None]:
        """Return pending, succeeded with bytes, or failed."""


class ObjectStorage(Protocol):
    async def put_object(self, *, object_key: str, content: bytes, content_type: str) -> None:
        """Store private bytes."""

    async def get_object(self, *, object_key: str) -> bytes:
        """Read private bytes after the caller has authorized the asset."""


class VideoGenerationService:
    def __init__(
        self,
        settings: Settings,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        client: VideoClient | None = None,
        storage: ObjectStorage | None = None,
    ) -> None:
        self.settings = settings
        self.session_factory = session_factory
        self.client = client or DashScopeVideo()
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
        if not self.settings.object_storage_configured:
            raise ValidationError("Object storage is not configured")
        source = None
        if input_id:
            config = await require_editor_model(uow, self.settings, "image_to_video")
            source = await require_input(uow.session, project_id, input_id, inpaint=False)
        else:
            config = await require_assigned(uow.session, "text_to_video")
        safe_parameters = validate_video_parameters(
            config, self.settings, parameters, reference=bool(source)
        )
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
                "kind": "video",
                "operation": "image_to_video" if source else "text_to_video",
            },
            input_id=input_id,
            kind="video",
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
        logger.info("video_generation_queued", task_id=str(row.id), project_id=str(project_id))
        return row

    async def cancel(self, uow: UnitOfWork, *, project_id: UUID, task_id: UUID) -> GenerationTask:
        row = await self.cancel_in_transaction(uow, project_id=project_id, task_id=task_id)
        await uow.commit()
        return row

    async def cancel_in_transaction(
        self, uow: UnitOfWork, *, project_id: UUID, task_id: UUID
    ) -> GenerationTask:
        now = datetime.now(UTC)
        stmt = (
            update(GenerationTask)
            .where(
                GenerationTask.id == task_id,
                GenerationTask.project_id == project_id,
                GenerationTask.kind == "video",
                GenerationTask.status == "queued",
            )
            .values(status="canceled", finished_at=now, updated_at=now)
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
        if row is None or row.kind != "video":
            raise NotFoundError("Generation task was not found")
        if row.status in _ACTIVE:
            raise CancellationUnsupportedError(
                "This video generation cannot be canceled after it starts"
            )
        return row

    async def claim_queued(self, limit: int = 1) -> list[UUID]:
        factory = self._factory()
        now = datetime.now(UTC)
        async with factory() as session:
            candidates = list(
                (
                    await session.execute(
                        select(GenerationTask.id)
                        .where(
                            GenerationTask.kind == "video",
                            GenerationTask.status == "queued",
                        )
                        .order_by(GenerationTask.created_at)
                        .limit(limit)
                    )
                )
                .scalars()
                .all()
            )
            claimed: list[UUID] = []
            for task_id in candidates:
                moved = (
                    await session.execute(
                        update(GenerationTask)
                        .where(
                            GenerationTask.id == task_id,
                            GenerationTask.status == "queued",
                            GenerationTask.kind == "video",
                        )
                        .values(
                            status="submitting",
                            phase="submitting",
                            started_at=now,
                            updated_at=now,
                            lease_token=GenerationTask.lease_token + 1,
                        )
                        .returning(GenerationTask.id)
                    )
                ).one_or_none()
                if moved is not None:
                    claimed.append(moved.id)
            await session.commit()
            return claimed

    async def dispatch(self, task_id: UUID) -> None:
        loaded = await self._load_submission(task_id)
        if loaded is None:
            return
        prompt, model_config_id, parameters, reconciliation = loaded
        if reconciliation:
            return
        try:
            provider_task_id = await self._call_submit(
                model_config_id, prompt, parameters, task_id=task_id
            )
        except ProviderTimeout:
            logger.info("video_generation_submit_unknown", task_id=str(task_id))
            await self._mark_unknown(task_id)
            return
        except ApplicationError as exc:
            logger.info(
                "video_generation_failed",
                task_id=str(task_id),
                error_type=type(exc).__name__,
            )
            await self._fail(task_id, exc.code, exc.message)
            return
        except Exception as exc:
            logger.info(
                "video_generation_failed",
                task_id=str(task_id),
                error_type=type(exc).__name__,
            )
            await self._fail(task_id, "provider_error", "The model provider request failed")
            return
        await self._mark_running(task_id, provider_task_id)

    async def claim_due(self, limit: int = 3) -> list[UUID]:
        factory = self._factory()
        now = datetime.now(UTC)
        async with factory() as session:
            candidates = list(
                (
                    await session.execute(
                        select(GenerationTask.id)
                        .where(
                            GenerationTask.kind == "video",
                            GenerationTask.status == "running",
                            GenerationTask.provider_task_id.is_not(None),
                            or_(
                                GenerationTask.next_poll_at.is_(None),
                                GenerationTask.next_poll_at <= now,
                            ),
                        )
                        .order_by(GenerationTask.next_poll_at.asc().nullsfirst())
                        .limit(limit)
                    )
                )
                .scalars()
                .all()
            )
            claimed: list[UUID] = []
            for task_id in candidates:
                moved = (
                    await session.execute(
                        update(GenerationTask)
                        .where(
                            GenerationTask.id == task_id,
                            GenerationTask.status == "running",
                            or_(
                                GenerationTask.next_poll_at.is_(None),
                                GenerationTask.next_poll_at <= now,
                            ),
                        )
                        .values(next_poll_at=now + timedelta(seconds=60), updated_at=now)
                        .returning(GenerationTask.id)
                    )
                ).one_or_none()
                if moved is not None:
                    claimed.append(moved.id)
            await session.commit()
            return claimed

    async def poll(self, task_id: UUID) -> None:
        loaded = await self._load_poll(task_id)
        if loaded is None:
            return
        model_config_id, provider_task_id, started_at = loaded
        if await self.finish_persisted(task_id):
            return
        try:
            state, video = await self._call_poll(model_config_id, provider_task_id)
        except ProviderTaskFailedError as exc:
            await self._fail(task_id, exc.code, exc.message)
            return
        except ProviderTimeout:
            await self._schedule(task_id, started_at)
            return
        except ApplicationError as exc:
            await self._schedule(task_id, started_at)
            logger.info(
                "video_generation_poll_retry",
                task_id=str(task_id),
                error_type=type(exc).__name__,
            )
            return
        if state == "pending" or (video is None and state != "failed"):
            await self._schedule(task_id, started_at)
            return
        if state == "failed" or video is None:
            await self._fail(task_id, "provider_failed", "The model provider request failed")
            return
        project_id, actor_id = await self._owners(task_id)
        if project_id is None or actor_id is None:
            return
        try:
            await self._store(task_id, project_id, actor_id, video)
        except Exception as exc:
            logger.info(
                "video_generation_store_failed",
                task_id=str(task_id),
                error_type=type(exc).__name__,
            )
            await self._fail(
                task_id,
                "output_persist_failed",
                "The generated video could not be stored",
            )

    async def _load_submission(
        self,
        task_id: UUID,
    ) -> tuple[str, UUID, dict, bool] | None:
        factory = self._factory()
        invalid = False
        async with factory() as session:
            row = await session.get(GenerationTask, task_id)
            if row is None or row.kind != "video" or row.status != "submitting":
                return None
            if row.provider_task_id or row.reconciliation_required:
                return "", row.model_config_id, {}, True
            snapshot = row.request_snapshot if isinstance(row.request_snapshot, dict) else {}
            prompt = snapshot.get("prompt")
            parameters = snapshot.get("parameters")
            if not isinstance(prompt, str):
                invalid = True
            else:
                return (
                    prompt,
                    row.model_config_id,
                    parameters if isinstance(parameters, dict) else {},
                    False,
                )
        if invalid:
            await self._fail(task_id, "validation_error", "Prompt must be 1-10000 characters")
        return None

    async def _load_poll(self, task_id: UUID) -> tuple[UUID, str, datetime | None] | None:
        factory = self._factory()
        async with factory() as session:
            row = await session.get(GenerationTask, task_id)
            if (
                row is None
                or row.kind != "video"
                or row.status != "running"
                or not row.provider_task_id
            ):
                return None
            return row.model_config_id, row.provider_task_id, row.started_at

    async def _owners(self, task_id: UUID) -> tuple[UUID | None, UUID | None]:
        factory = self._factory()
        async with factory() as session:
            row = await session.get(GenerationTask, task_id)
            if row is None:
                return None, None
            return row.project_id, row.actor_id

    async def _endpoint(self, model_config_id: UUID) -> tuple[str, str, str]:
        factory = self._factory()
        async with factory() as session:
            config = await session.get(ModelConfig, model_config_id)
            if (
                config is None
                or not config.enabled
                or config.capability not in {"text_to_video", "image_to_video"}
            ):
                raise NotFoundError("Model config was not found")
            model_name = config.model_name
            secret_ref = config.secret_ref
        endpoint = self.settings.model_endpoint(secret_ref)
        if endpoint is None:
            raise ValidationError("Secret reference is not configured")
        base_url, api_key = endpoint
        return base_url, api_key, model_name

    async def _call_submit(
        self, model_config_id: UUID, prompt: str, parameters: dict, *, task_id: UUID | None = None
    ) -> str:
        base_url, api_key, model_name = await self._endpoint(model_config_id)
        async with self._factory()() as session:
            task = await session.get(GenerationTask, task_id) if task_id else None
            source = (
                await require_input(session, task.project_id, task.input_id, inpaint=False)
                if task and task.input_id
                else None
            )
        if source:
            image = await self.storage.get_object(object_key=source.image_key)
            return await self.client.submit(
                base_url=base_url,
                api_key=api_key,
                model=model_name,
                prompt=prompt,
                size=None,
                duration=parameters["duration"],
                image=image,
                resolution=parameters["resolution"],
            )
        size, duration = _provider_options(parameters)
        return await self.client.submit(
            base_url=base_url,
            api_key=api_key,
            model=model_name,
            prompt=prompt,
            size=size,
            duration=duration,
        )

    async def _call_poll(
        self,
        model_config_id: UUID,
        provider_task_id: str,
    ) -> tuple[str, tuple[bytes, str] | None]:
        base_url, api_key, _model_name = await self._endpoint(model_config_id)
        return await self.client.poll(
            base_url=base_url,
            api_key=api_key,
            provider_task_id=provider_task_id,
        )

    async def _mark_running(self, task_id: UUID, provider_task_id: str) -> None:
        now = datetime.now(UTC)
        factory = self._factory()
        async with factory() as session:
            await session.execute(
                update(GenerationTask)
                .where(
                    GenerationTask.id == task_id,
                    GenerationTask.status == "submitting",
                    GenerationTask.reconciliation_required.is_(False),
                )
                .values(
                    status="running",
                    phase="generating",
                    provider_task_id=provider_task_id,
                    next_poll_at=now + timedelta(seconds=5),
                    updated_at=now,
                )
            )
            await session.commit()

    async def _mark_unknown(self, task_id: UUID) -> None:
        now = datetime.now(UTC)
        factory = self._factory()
        async with factory() as session:
            await session.execute(
                update(GenerationTask)
                .where(GenerationTask.id == task_id, GenerationTask.status == "submitting")
                .values(reconciliation_required=True, phase="reconciling", updated_at=now)
            )
            await session.commit()

    async def _schedule(self, task_id: UUID, started_at: datetime | None) -> None:
        now = datetime.now(UTC)
        elapsed = 0 if started_at is None else max(0, int((now - started_at).total_seconds()))
        delay = 5 if elapsed < 60 else 15 if elapsed < 300 else 30
        factory = self._factory()
        async with factory() as session:
            await session.execute(
                update(GenerationTask)
                .where(GenerationTask.id == task_id, GenerationTask.status == "running")
                .values(next_poll_at=now + timedelta(seconds=delay), updated_at=now)
            )
            await session.commit()

    async def _store(
        self,
        task_id: UUID,
        project_id: UUID,
        actor_id: UUID,
        video: tuple[bytes, str],
    ) -> None:
        del actor_id
        items = describe_outputs(project_id, task_id, [video])
        try:
            with TemporaryDirectory(prefix="lumi-probe-") as directory:
                path = Path(directory) / "source.mp4"
                await asyncio.to_thread(path.write_bytes, video[0])
                metadata = await probe(path)
                items[0].update({k: metadata[k] for k in ("duration_ms", "width", "height")})
        except (ValueError, OSError, TimeoutError):
            # Preserve the raw result; never invent timing for an unprobeable source.
            logger.warning("video_metadata_unavailable", task_id=str(task_id))
        await put_if_changed(
            self.storage,
            object_key=items[0]["object_key"],
            content=video[0],
            content_type=items[0]["mime"],
        )
        provider, bucket = storage_identity(self.storage, self.settings)
        factory = self._factory()
        async with factory() as session:
            await remember_objects(session, task_id, items)
        async with factory() as session:
            await register_stored_assets(session, task_id, storage_provider=provider, bucket=bucket)
        logger.info("video_generation_succeeded", task_id=str(task_id))

    async def finish_persisted(self, task_id: UUID) -> bool:
        factory = self._factory()
        async with factory() as session:
            task = await session.get(GenerationTask, task_id)
            if task is None or task.phase != "persisting":
                return False
        provider, bucket = storage_identity(self.storage, self.settings)
        async with factory() as session:
            return await register_stored_assets(
                session, task_id, storage_provider=provider, bucket=bucket
            )

    async def _fail(self, task_id: UUID, code: str, message: str) -> None:
        now = datetime.now(UTC)
        factory = self._factory()
        async with factory() as session:
            await session.execute(
                update(GenerationTask)
                .where(
                    GenerationTask.id == task_id,
                    GenerationTask.status.in_(("submitting", "running")),
                )
                .values(
                    status="failed",
                    phase=None,
                    error_code=code,
                    error_message=(message or "")[:300] or None,
                    finished_at=now,
                    updated_at=now,
                )
            )
            await session.commit()

    def _factory(self) -> async_sessionmaker[AsyncSession]:
        if self.session_factory is None:
            raise RuntimeError("Video generation worker requires a session factory")
        return self.session_factory


def _clean_key(value: str) -> str:
    if _IDEMPOTENCY_KEY.fullmatch(value) is None:
        raise ValidationError("Idempotency key is invalid")
    return value


def _clean_prompt(value: str) -> str:
    cleaned = value.strip()
    if not 1 <= len(cleaned) <= _VIDEO_PROMPT_MAX:
        raise ValidationError("Prompt must be 1-800 characters")
    return cleaned


def _parameters(value: dict) -> dict:
    cleaned = json_object(value, label="Parameters")
    if set(cleaned) - {"size", "duration"}:
        raise ValidationError("Parameters are not supported for this model")
    result: dict = {}
    duration = cleaned.get("duration", 5)
    if isinstance(duration, bool) or not isinstance(duration, int) or duration != 5:
        raise ValidationError("Video duration must be 5 seconds")
    result["duration"] = duration
    if "size" in cleaned:
        size = cleaned["size"]
        if not isinstance(size, str) or size not in _VIDEO_SIZES:
            raise ValidationError("Video size is not supported")
        result["size"] = size
    return result


def _provider_options(parameters: dict) -> tuple[str | None, int]:
    size = parameters.get("size")
    duration = parameters.get("duration", 5)
    if size is not None and (not isinstance(size, str) or size not in _VIDEO_SIZES):
        raise ValidationError("Video size is not supported")
    if isinstance(duration, bool) or not isinstance(duration, int) or duration != 5:
        raise ValidationError("Video duration must be 5 seconds")
    return (size if isinstance(size, str) else None), duration


def _request_hash(model_config_id: UUID, prompt: str, parameters: dict) -> str:
    payload = json.dumps(
        {
            "kind": "video",
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
