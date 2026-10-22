from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.modules.characters.schemas import CharacterInput, Contract


class AddCharacterImage(Contract):
    upload_id: UUID


class GenerateCharacterImage(Contract):
    profile: CharacterInput | None = None
    mode: Literal["candidate", "reference"] = "candidate"
    instruction: str = Field(default="", max_length=2000)


class CharacterImageView(Contract):
    id: UUID
    character_id: UUID
    image_url: str
    source: Literal["upload", "ai_generated"]
    is_primary: bool
    created_at: datetime


class CharacterImageJobView(Contract):
    id: UUID
    task_id: UUID
    status: str
    error: str | None = None
    progress: int | None = None
    collected: bool


class CharacterImagesView(Contract):
    images: list[CharacterImageView]
    jobs: list[CharacterImageJobView]
