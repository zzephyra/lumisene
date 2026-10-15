from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.infrastructure.ai.chat_contract import ChatAnswer


class CreateConversation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    title: str = Field(min_length=1, max_length=120)


class SendTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    prompt: str = Field(min_length=1, max_length=10000)


class ConversationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    created_at: datetime


class TurnResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    prompt: str
    status: Literal["queued", "running", "succeeded", "failed", "canceled"]
    generation_task_id: UUID | None
    reply: str | None
    proposal: ChatAnswer | None
    error_code: str | None
    error_message: str | None
    created_at: datetime
