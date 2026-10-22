"""Submit and finish one explicit text completion.

The HTTP handler only queues the row. The worker calls the provider outside any transaction.
"""

from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.errors import ApplicationError, NotFoundError, ValidationError
from app.core.logging import get_logger
from app.infrastructure.ai.adapters.openai_compatible import OpenAICompatibleChat
from app.infrastructure.ai.catalog import require_assigned
from app.infrastructure.ai.domain import PROMPT_MAX_LENGTH
from app.infrastructure.ai.models import ModelConfig, TextCompletion
from app.infrastructure.db.session import UnitOfWork

logger = get_logger(__name__)


class ChatClient(Protocol):
    async def complete(self, *, base_url: str, api_key: str, model: str, prompt: str) -> str:
        """Return the assistant text. Implementations must not log the API key."""


class TextCompletionService:
    def __init__(
        self,
        settings: Settings,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        client: ChatClient | None = None,
    ) -> None:
        self.settings = settings
        self.session_factory = session_factory
        self.client = client or OpenAICompatibleChat(
            timeout_seconds=settings.text_completion_timeout_seconds
        )

    async def submit(
        self,
        uow: UnitOfWork,
        *,
        project_id: UUID,
        actor_id: UUID,
        prompt: str,
        commit: bool = True,
    ) -> TextCompletion:
        cleaned = _clean_prompt(prompt)
        config = await require_assigned(uow.session, "text_generation")
        if self.settings.model_endpoint(config.secret_ref) is None:
            raise ValidationError("Secret reference is not configured")
        row = TextCompletion(
            id=uuid4(),
            project_id=project_id,
            actor_id=actor_id,
            model_config_id=config.id,
            config_version=config.config_version,
            prompt=cleaned,
            status="queued",
            content=None,
            error_code=None,
            error_message=None,
        )
        uow.session.add(row)
        await uow.session.flush()
        if commit:
            await uow.commit()
        logger.info("text_completion_queued", completion_id=str(row.id), project_id=str(project_id))
        return row

    async def get(
        self,
        uow: UnitOfWork,
        *,
        project_id: UUID,
        completion_id: UUID,
    ) -> TextCompletion:
        row = await _get(uow.session, project_id, completion_id)
        if row is None:
            raise NotFoundError("Text completion was not found")
        return row

    async def queued_ids(self, limit: int = 5) -> list[UUID]:
        factory = self._factory()
        async with factory() as session:
            stmt = (
                select(TextCompletion.id)
                .where(TextCompletion.status == "queued")
                .order_by(TextCompletion.created_at)
                .limit(limit)
            )
            return list((await session.execute(stmt)).scalars().all())

    async def execute(self, completion_id: UUID) -> None:
        claimed = await self._claim(completion_id)
        if claimed is None:
            return
        prompt, model_config_id = claimed
        try:
            content = await self._call_provider(model_config_id, prompt)
        except ApplicationError as exc:
            logger.info(
                "text_completion_failed",
                completion_id=str(completion_id),
                error_type=type(exc).__name__,
            )
            await self._finish(
                completion_id,
                status="failed",
                error_code=exc.code,
                error_message=exc.message,
            )
            return
        except Exception as exc:
            logger.info(
                "text_completion_failed",
                completion_id=str(completion_id),
                error_type=type(exc).__name__,
            )
            await self._finish(
                completion_id,
                status="failed",
                error_code="provider_error",
                error_message="The model provider request failed",
            )
            return
        await self._finish(completion_id, status="succeeded", content=content)
        logger.info("text_completion_succeeded", completion_id=str(completion_id))

    async def _claim(self, completion_id: UUID) -> tuple[str, UUID] | None:
        factory = self._factory()
        async with factory() as session:
            stmt = (
                update(TextCompletion)
                .where(TextCompletion.id == completion_id, TextCompletion.status == "queued")
                .values(status="running", updated_at=datetime.now(UTC))
                .returning(TextCompletion.prompt, TextCompletion.model_config_id)
            )
            result = (await session.execute(stmt)).one_or_none()
            if result is None:
                await session.rollback()
                return None
            await session.commit()
            return result.prompt, result.model_config_id

    async def _call_provider(self, model_config_id: UUID, prompt: str) -> str:
        factory = self._factory()
        async with factory() as session:
            config = await session.get(ModelConfig, model_config_id)
            if config is None or not config.enabled or config.capability != "text_generation":
                raise NotFoundError("Model config was not found")
            model_name = config.model_name
            secret_ref = config.secret_ref
        endpoint = self.settings.model_endpoint(secret_ref)
        if endpoint is None:
            raise ValidationError("Secret reference is not configured")
        base_url, api_key = endpoint
        return await self.client.complete(
            base_url=base_url,
            api_key=api_key,
            model=model_name,
            prompt=prompt,
        )

    async def _finish(
        self,
        completion_id: UUID,
        *,
        status: str,
        content: str | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> None:
        factory = self._factory()
        async with factory() as session:
            await session.execute(
                update(TextCompletion)
                .where(TextCompletion.id == completion_id, TextCompletion.status == "running")
                .values(
                    status=status,
                    content=content,
                    error_code=error_code,
                    error_message=(error_message or "")[:300] or None,
                    updated_at=datetime.now(UTC),
                )
            )
            await session.commit()

    def _factory(self) -> async_sessionmaker[AsyncSession]:
        if self.session_factory is None:
            raise RuntimeError("Text completion worker requires a session factory")
        return self.session_factory


def _clean_prompt(value: str) -> str:
    cleaned = value.strip()
    if not 1 <= len(cleaned) <= PROMPT_MAX_LENGTH:
        raise ValidationError("Prompt must be 1-10000 characters")
    return cleaned


async def _get(
    session: AsyncSession,
    project_id: UUID,
    completion_id: UUID,
) -> TextCompletion | None:
    stmt = select(TextCompletion).where(
        TextCompletion.id == completion_id,
        TextCompletion.project_id == project_id,
    )
    return (await session.execute(stmt)).scalar_one_or_none()
