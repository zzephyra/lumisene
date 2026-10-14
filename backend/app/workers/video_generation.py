"""Claim queued text-to-video tasks, submit once, then poll outside the API process."""

import asyncio

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.infrastructure.db.session import create_db_engine, create_session_factory
from app.infrastructure.storage.objects import build_object_storage
from app.infrastructure.storage.s3 import S3Storage
from app.modules.generation.video import VideoGenerationService
from app.modules.settings.service import SettingsService

logger = get_logger(__name__)


async def _run() -> None:
    settings = get_settings()
    configure_logging(settings)
    engine = create_db_engine(settings)
    session_factory = create_session_factory(engine)
    storage = build_object_storage(settings)
    if isinstance(storage, S3Storage):
        await _wait_for_bucket(storage)
    async with session_factory() as session:
        await SettingsService(settings).initialize(session)
    service = VideoGenerationService(settings, session_factory=session_factory, storage=storage)
    logger.info("video_generation_worker_started")
    try:
        while True:
            claimed = await service.claim_queued()
            for task_id in claimed:
                await service.dispatch(task_id)
            due = await service.claim_due()
            for task_id in due:
                await service.poll(task_id)
            if not claimed and not due:
                await asyncio.sleep(1)
    finally:
        await engine.dispose()
        logger.info("video_generation_worker_stopped")


async def _wait_for_bucket(storage: S3Storage) -> None:
    last_error = "RuntimeError"
    for _ in range(10):
        try:
            await storage.ensure_bucket()
            return
        except Exception as exc:
            last_error = type(exc).__name__
            await asyncio.sleep(1)
    raise RuntimeError(f"object storage is not ready: {last_error}")


def main() -> None:
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        return


if __name__ == "__main__":
    main()
