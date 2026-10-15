"""Claim queued text completions and call the model gateway outside the API process."""

import asyncio

from app.infrastructure.ai.adapters.langchain_chat import LangChainCreativeChat
from app.modules.chat.service import ChatService
from app.modules.projects.service import ProjectService
from app.modules.auth.service import AuthService
from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.infrastructure.ai.text_completion import TextCompletionService
from app.infrastructure.db.session import create_db_engine, create_session_factory

logger = get_logger(__name__)


async def _run() -> None:
    settings = get_settings()
    configure_logging(settings)
    engine = create_db_engine(settings)
    session_factory = create_session_factory(engine)
    service = TextCompletionService(settings, session_factory=session_factory)
    chat = ChatService(settings, ProjectService(AuthService(settings)), session_factory, LangChainCreativeChat())
    logger.info("text_completion_worker_started")
    try:
        while True:
            completion_ids = await service.queued_ids()
            for turn_id in await chat.queued_ids():
                await chat.execute(turn_id)
            if not completion_ids:
                await asyncio.sleep(1)
                continue
            for completion_id in completion_ids:
                await service.execute(completion_id)
    finally:
        await engine.dispose()
        logger.info("text_completion_worker_stopped")


def main() -> None:
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        return


if __name__ == "__main__":
    main()
