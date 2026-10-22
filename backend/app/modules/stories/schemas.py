from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StoryInput(_Strict):
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=4000)
    cover_upload_id: UUID | None = None


class StoryUpdate(StoryInput):
    expected_version: int = Field(ge=1)


class StoryView(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    description: str | None
    cover_upload_id: UUID | None
    cover_url: str | None
    version: int
    created_at: datetime
    updated_at: datetime


class StoryPage(BaseModel):
    items: list[StoryView]
    next_cursor: str | None
