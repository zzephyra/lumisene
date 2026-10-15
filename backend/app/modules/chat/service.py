"""Persistent creative dialogue with explicit inline image generation."""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from time import monotonic
from typing import Protocol
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.errors import ApplicationError, ConflictError, NotFoundError, ValidationError
from app.core.logging import get_logger
from app.infrastructure.ai.catalog import require_assigned
from app.infrastructure.ai.chat_contract import ChatAnswer
from app.infrastructure.ai.models import ModelConfig
from app.infrastructure.db.session import UnitOfWork
from app.modules.chat.models import ChatTurn, Conversation
from app.modules.generation.service import ImageGenerationService
from app.modules.projects.service import ProjectService

logger = get_logger(__name__)


class CreativeChatClient(Protocol):
    async def converse(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        messages: list[dict[str, str]],
        on_reply: Callable[[str], Awaitable[None]] | None = None,
    ) -> ChatAnswer: ...


class ChatService:
    def __init__(
        self,
        settings: Settings,
        projects: ProjectService,
        factory: async_sessionmaker[AsyncSession] | None = None,
        client: CreativeChatClient | None = None,
    ):
        self.settings, self.projects, self.factory, self.client = (
            settings,
            projects,
            factory,
            client,
        )

    async def generate_image(
        self,
        uow: UnitOfWork,
        project_id: UUID,
        conversation_id: UUID,
        turn_id: UUID,
        actor_id: UUID,
        *,
        commit: bool = True,
    ) -> ChatTurn:
        # Hold the turn lock until both task and association are committed.
        await self.projects.authorize_content_write(uow, actor_id, project_id)
        row = await uow.session.scalar(
            select(ChatTurn)
            .where(
                ChatTurn.id == turn_id,
                ChatTurn.project_id == project_id,
                ChatTurn.conversation_id == conversation_id,
            )
            .with_for_update()
        )
        if row is None:
            raise NotFoundError("对话消息不存在")
        images = ImageGenerationService(self.settings)
        previous_task = row.generation_task_id
        if previous_task:
            previous = await images.get(uow, project_id=project_id, task_id=previous_task)
            if previous.status not in {"failed", "canceled"}:
                return row
        if row.status != "succeeded" or not row.proposal:
            raise ValidationError("这条消息没有可生成的图片方案")
        proposal = ChatAnswer.model_validate(row.proposal)
        if proposal.intent != "image_generation" or not proposal.generation_prompt:
            raise ValidationError("这条消息没有可生成的图片方案")
        task = await images.submit(
            uow,
            project_id=project_id,
            actor_id=actor_id,
            prompt=proposal.generation_prompt,
            parameters={"n": 1},
            idempotency_key=f"chat-image-{previous_task or turn_id}",
            commit=False,
        )
        row.generation_task_id = task.id
        if commit:
            await uow.commit()
        return row

    async def conversations(
        self, uow: UnitOfWork, project_id: UUID, actor_id: UUID, offset: int
    ) -> list[Conversation]:
        await self.projects.get_project(uow, actor_id, project_id)
        return list(
            await uow.session.scalars(
                select(Conversation)
                .where(Conversation.project_id == project_id)
                .order_by(Conversation.created_at.desc(), Conversation.id.desc())
                .offset(offset)
                .limit(50)
            )
        )

    async def create(
        self, uow: UnitOfWork, project_id: UUID, actor_id: UUID, conversation_id: UUID, title: str
    ) -> Conversation:
        await self.projects.authorize_content_write(uow, actor_id, project_id)
        existing = await uow.session.get(Conversation, conversation_id)
        if existing:
            if existing.project_id != project_id or existing.created_by != actor_id:
                raise NotFoundError("Conversation was not found")
            return existing
        row = Conversation(
            id=conversation_id,
            project_id=project_id,
            created_by=actor_id,
            title=title.strip()[:120] or "新对话",
        )
        uow.session.add(row)
        await uow.commit()
        return row

    async def _conversation(
        self, uow: UnitOfWork, project_id: UUID, conversation_id: UUID
    ) -> Conversation:
        row = await uow.session.scalar(
            select(Conversation)
            .where(Conversation.project_id == project_id, Conversation.id == conversation_id)
            .with_for_update()
        )
        if row is None:
            raise NotFoundError("Conversation was not found")
        return row

    async def turns(
        self, uow: UnitOfWork, project_id: UUID, conversation_id: UUID, actor_id: UUID, offset: int
    ) -> list[ChatTurn]:
        await self.projects.get_project(uow, actor_id, project_id)
        await self._conversation(uow, project_id, conversation_id)
        return list(
            await uow.session.scalars(
                select(ChatTurn)
                .where(
                    ChatTurn.project_id == project_id, ChatTurn.conversation_id == conversation_id
                )
                .order_by(ChatTurn.created_at.desc(), ChatTurn.id.desc())
                .offset(offset)
                .limit(50)
            )
        )

    async def submit(
        self,
        uow: UnitOfWork,
        project_id: UUID,
        conversation_id: UUID,
        actor_id: UUID,
        request_id: UUID,
        prompt: str,
    ) -> ChatTurn:
        await self.projects.authorize_content_write(uow, actor_id, project_id)
        await self._conversation(uow, project_id, conversation_id)
        prompt = prompt.strip()
        if not 1 <= len(prompt) <= 10000:
            raise ValidationError("对话内容须为 1 至 10000 字符")
        scope = (ChatTurn.project_id == project_id, ChatTurn.conversation_id == conversation_id)
        prior = await uow.session.scalar(
            select(ChatTurn).where(*scope, ChatTurn.request_id == request_id)
        )
        if prior:
            if prior.prompt != prompt or prior.actor_id != actor_id:
                raise ConflictError("请求标识已被使用")
            return prior
        active = await uow.session.scalar(
            select(ChatTurn.id).where(*scope, ChatTurn.status.in_(["queued", "running"]))
        )
        if active:
            raise ConflictError("请等待当前回复完成")
        config = await require_assigned(uow.session, "text_generation")
        if self.settings.model_endpoint(config.secret_ref) is None:
            raise ValidationError("请先配置对话模型服务")
        rows = list(
            await uow.session.scalars(
                select(ChatTurn)
                .where(*scope, ChatTurn.status == "succeeded")
                .order_by(ChatTurn.created_at.desc(), ChatTurn.id.desc())
                .limit(20)
            )
        )
        history: list[dict[str, str]] = []
        budget = 40000 - len(prompt)
        for row in rows:
            answer = row.reply or ""
            if row.proposal and row.proposal.get("generation_prompt"):
                answer += "\n创作方案：" + row.proposal["generation_prompt"]
            if len(row.prompt) + len(answer) > budget:
                break
            history[0:0] = [
                {"role": "user", "content": row.prompt},
                {"role": "assistant", "content": answer},
            ]
            budget -= len(row.prompt) + len(answer)
        history.append({"role": "user", "content": prompt})
        row = ChatTurn(
            project_id=project_id,
            conversation_id=conversation_id,
            actor_id=actor_id,
            request_id=request_id,
            model_config_id=config.id,
            config_version=config.config_version,
            prompt=prompt,
            context=history,
            status="queued",
        )
        uow.session.add(row)
        await uow.commit()
        return row

    async def queued_ids(self) -> list[UUID]:
        if self.factory is None:
            raise RuntimeError("Chat worker requires a session factory")
        async with self.factory() as session:
            # A lost model response is not replayed automatically (may have been billed).
            await session.execute(
                update(ChatTurn)
                .where(
                    ChatTurn.status == "running",
                    ChatTurn.updated_at < datetime.now(UTC) - timedelta(minutes=3),
                )
                .values(
                    status="failed",
                    error_code="interrupted",
                    error_message="回复中断，请重新发送",
                    updated_at=datetime.now(UTC),
                )
            )
            await session.commit()
            return list(
                await session.scalars(
                    select(ChatTurn.id)
                    .where(ChatTurn.status == "queued")
                    .order_by(ChatTurn.created_at)
                    .limit(5)
                )
            )

    async def execute(self, turn_id: UUID) -> None:
        if self.factory is None or self.client is None:
            raise RuntimeError("Chat worker requires a model client and session factory")
        async with self.factory() as session:
            row = await session.scalar(
                select(ChatTurn).where(ChatTurn.id == turn_id).with_for_update()
            )
            if row is None or row.status != "queued":
                return
            row.status = "running"
            row.updated_at = datetime.now(UTC)
            project_id, actor_id, config_id, messages = (
                row.project_id,
                row.actor_id,
                row.model_config_id,
                row.context,
            )
            await session.commit()
        try:
            async with self.factory() as session:
                uow = UnitOfWork(session)
                await self.projects.authorize_content_write(uow, actor_id, project_id)
                config = await session.get(ModelConfig, config_id)
                if config is None or not config.enabled or config.capability != "text_generation":
                    raise ValidationError("对话模型已停用，请联系管理员")
                model, endpoint = config.model_name, self.settings.model_endpoint(config.secret_ref)
                await uow.commit()
            if endpoint is None:
                raise ValidationError("对话模型服务未配置")
            last_flush = 0.0

            async def persist_reply(reply: str) -> None:
                nonlocal last_flush
                if monotonic() - last_flush < 0.3:
                    return
                async with self.factory() as progress_session:
                    await progress_session.execute(
                        update(ChatTurn)
                        .where(ChatTurn.id == turn_id, ChatTurn.status == "running")
                        .values(reply=reply, updated_at=datetime.now(UTC))
                    )
                    await progress_session.commit()
                last_flush = monotonic()

            result = await self.client.converse(
                base_url=endpoint[0],
                api_key=endpoint[1],
                model=model,
                messages=messages,
                on_reply=persist_reply,
            )
            result = ChatAnswer.model_validate(result)
            values = dict(status="succeeded", reply=result.reply, proposal=result.model_dump())
        except Exception as exc:
            logger.info("creative_chat_failed", turn_id=str(turn_id), error_type=type(exc).__name__)
            values = dict(
                status="failed",
                error_code=exc.code if isinstance(exc, ApplicationError) else "provider_error",
                error_message=exc.message[:300]
                if isinstance(exc, ApplicationError)
                else "对话暂时不可用，请重试",
            )
        async with self.factory() as session:
            await session.execute(
                update(ChatTurn)
                .where(ChatTurn.id == turn_id, ChatTurn.status == "running")
                .values(**values, updated_at=datetime.now(UTC))
            )
            if values["status"] == "succeeded" and result.intent == "image_generation":
                try:
                    async with session.begin_nested():
                        conversation_id = await session.scalar(
                            select(ChatTurn.conversation_id).where(ChatTurn.id == turn_id)
                        )
                        await self.generate_image(
                            UnitOfWork(session),
                            project_id,
                            conversation_id,
                            turn_id,
                            actor_id,
                            commit=False,
                        )
                except Exception as exc:
                    logger.info(
                        "chat_auto_image_failed",
                        turn_id=str(turn_id),
                        error_type=type(exc).__name__,
                    )
                    await session.execute(
                        update(ChatTurn)
                        .where(ChatTurn.id == turn_id)
                        .values(
                            error_code="image_submission_failed",
                            error_message=exc.message[:300]
                            if isinstance(exc, ApplicationError)
                            else "图片任务创建失败，请重试",
                        )
                    )
            await session.commit()
