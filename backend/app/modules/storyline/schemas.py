"""Versioned storyline documents; dialogue stores IDs rather than duplicated names."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ChapterInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    summary: str = Field(default="", max_length=4000)
    status: Literal["draft", "completed"] = "draft"


class ChapterUpdate(ChapterInput):
    expected_version: int = Field(ge=1)


class ChapterView(ChapterInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    version: int
    order_index: int
    scene_count: int = 0
    created_at: datetime
    updated_at: datetime


class SceneBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    type: Literal["action", "dialogue", "narration"]
    content: str = Field(max_length=10000)
    character_id: UUID | None = None

    @model_validator(mode="after")
    def reference(self):
        if self.type == "dialogue" and self.character_id is None:
            raise ValueError("对白必须选择人物")
        if self.type != "dialogue":
            self.character_id = None
        return self


class SceneInput(ChapterInput):
    location: str = Field(default="", max_length=200)
    time_of_day: str = Field(default="", max_length=80)
    setting: Literal["", "interior", "exterior"] = ""
    character_ids: list[UUID] = Field(default_factory=list, max_length=100)
    schema_version: Literal[1] = 1
    blocks: list[SceneBlock] = Field(default_factory=list, max_length=300)

    @model_validator(mode="after")
    def unique_blocks(self):
        if len({b.id for b in self.blocks}) != len(self.blocks):
            raise ValueError("内容块 ID 不能重复")
        if sum(len(b.content) for b in self.blocks) > 100000:
            raise ValueError("场景正文超过 100000 字符")
        return self


class SceneUpdate(SceneInput):
    expected_version: int = Field(ge=1)


class SceneView(SceneInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    chapter_id: UUID
    version: int
    order_index: int
    created_at: datetime
    updated_at: datetime


class ReorderInput(BaseModel):
    ids: list[UUID] = Field(max_length=1000)
    expected_version: int = Field(ge=1)


class ChapterList(BaseModel):
    version: int
    items: list[ChapterView]


class SceneList(BaseModel):
    version: int
    items: list[SceneView]


class GeneratedChapter(ChapterInput):
    scenes: list[SceneInput] = Field(default_factory=list, max_length=10)


class PlotResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chapters: list[GeneratedChapter] = Field(default_factory=list, max_length=10)
    blocks: list[SceneBlock] = Field(default_factory=list, max_length=100)


class PlotGenerateInput(BaseModel):
    idea: str = Field(min_length=1, max_length=3000)
    chapter_count: int = Field(default=3, ge=1, le=10)
    style: str = Field(default="", max_length=120)
    depth: Literal["outline", "structure"] = "structure"
    operation: Literal["outline", "continue", "polish", "action", "dialogue", "rewrite"] = "outline"
    scene_id: UUID | None = None
    block_id: UUID | None = None
    expected_version: int | None = Field(default=None, ge=1)


class PlotJobView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    status: Literal["queued", "running", "succeeded", "failed", "canceled"]
    error: str | None
    result: PlotResult | None
    applied: bool
    request: PlotGenerateInput
    created_at: datetime


class ApplyPlotInput(BaseModel):
    result: PlotResult
