"""Versioned, bounded production documents; IDs survive reorders and edits."""

from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class ChapterSelection(Strict):
    chapter_id: UUID
    scene_ids: list[UUID] | None = Field(default=None, max_length=100)


class MediaReference(Strict):
    source: Literal["upload", "generated"]
    id: UUID


class ProductionSettings(Strict):
    wizard_step: int = Field(default=0, ge=0, le=5)
    audio_mode: Literal["source", "silent"] = "source"
    character_references: dict[UUID, UUID | None] = Field(default_factory=dict)
    scene_references: dict[UUID, list[MediaReference]] = Field(default_factory=dict)

    mode: Literal["smart", "professional"] = "smart"
    target_duration: int = Field(default=90, ge=5, le=600)
    retention: Literal["strict", "balanced", "concise"] = "balanced"
    aspect_ratio: Literal["9:16", "16:9", "1:1"] = "9:16"
    resolution: Literal["720", "1080"] = "1080"
    fps: Literal[30] = 30
    visual_style: str = Field(default="", max_length=500)
    language: str = Field(default="中文", min_length=1, max_length=30)
    prefer_character_images: bool = True
    character_consistency: Literal["reference", "text"] = "reference"
    scene_consistency: Literal["continuous", "independent"] = "continuous"
    target_shots: int | None = Field(default=None, ge=1, le=100)
    pacing: Literal["slow", "balanced", "fast"] = "balanced"
    camera_style: str = Field(default="克制、服务叙事", max_length=200)
    dialogue_retention: Literal["full", "core", "minimal"] = "core"
    allow_transitions: bool = False


class SourceScene(Strict):
    id: UUID
    title: str
    summary: str = ""
    version: int
    character_ids: list[UUID] = Field(default_factory=list)
    blocks: list[dict] = Field(default_factory=list)


class SourceChapter(Strict):
    id: UUID
    title: str
    summary: str = ""
    version: int
    scenes: list[SourceScene]
    text_length: int = 0
    character_names: list[str] = Field(default_factory=list)


class ProductionSource(Strict):
    story_id: UUID
    title: str
    chapters: list[SourceChapter]


class Shot(Strict):
    id: UUID = Field(default_factory=uuid4)
    source_chapter_id: UUID | None = None
    source_scene_id: UUID | None = None
    narrative_role: Literal[
        "conflict", "dialogue", "climax", "transition", "establishing", "action", "turning_point"
    ] = "action"
    dialogue: str = Field(default="", max_length=3000)
    generation_duration: int | None = Field(default=None, gt=0, le=120)
    script_excerpt: str = Field(default="", max_length=3000)
    description: str = Field(default="", max_length=2000)
    character_ids: list[UUID] = Field(default_factory=list, max_length=20)
    framing: str = Field(default="中景", max_length=100)
    angle: str = Field(default="平视", max_length=100)
    movement: str = Field(default="固定", max_length=100)
    action: str = Field(default="", max_length=600)
    emotion: str = Field(default="", max_length=300)
    environment: str = Field(default="", max_length=600)
    duration: float = Field(default=5, gt=0, le=120)
    prompt: str = Field(default="", max_length=800)
    confirmed: bool = False
    reference_upload_id: UUID | None = None
    reference_asset_id: UUID | None = None
    character_image_id: UUID | None = None
    reference_character_id: UUID | None = None
    selected_image_id: UUID | None = None
    selected_video_id: UUID | None = None

    @model_validator(mode="after")
    def reference_pair(self):
        if bool(self.character_image_id) != bool(self.reference_character_id):
            raise ValueError("人物参考需要人物与图片 ID")
        if self.reference_character_id and self.reference_character_id not in self.character_ids:
            raise ValueError("参考形象必须属于当前镜头的人物")
        return self


class ProductionScene(Strict):
    source_chapter_ids: list[UUID] = Field(default_factory=list, max_length=100)
    id: UUID = Field(default_factory=uuid4)
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    setting: Literal["interior", "exterior", ""] = ""
    time_of_day: str = Field(default="", max_length=100)
    character_ids: list[UUID] = Field(default_factory=list, max_length=20)
    shots: list[Shot] = Field(default_factory=list, max_length=100)


class Board(Strict):
    dismissed_reviews: list[str] = Field(default_factory=list, max_length=100)
    adaptation_summary: str = Field(default="", max_length=3000)
    risks: list[str] = Field(default_factory=list, max_length=30)
    scenes: list[ProductionScene] = Field(default_factory=list, max_length=50)
    visual_style: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def unique(self):
        shots = [s for scene in self.scenes for s in scene.shots]
        ids = [scene.id for scene in self.scenes] + [s.id for s in shots]
        if len(shots) > 100 or len(ids) != len(set(ids)):
            raise ValueError("最多100个镜头，场景和镜头 ID 不得重复")
        return self


class CreateProduction(Strict):
    selections: list[ChapterSelection] | None = Field(default=None, max_length=100)
    settings: ProductionSettings = Field(default_factory=ProductionSettings)
    story_id: UUID
    title: str = Field(min_length=1, max_length=120)


class SaveBoard(Strict):
    expected_version: int = Field(ge=1)
    board: Board


class PlanInput(Strict):
    shot_id: UUID | None = None
    expected_version: int = Field(ge=1)
    instruction: str = Field(default="", max_length=1000)


class GenerateShot(Strict):
    expected_version: int = Field(ge=1)
    kind: Literal["image", "video"]
    parameters: dict = Field(default_factory=dict)


class ExportInput(Strict):
    expected_version: int = Field(ge=1)
    width: int = Field(default=1920, ge=240, le=1920, multiple_of=2)
    height: int = Field(default=1080, ge=240, le=1920, multiple_of=2)


class ProductionSummary(Strict):
    id: UUID
    story_id: UUID
    title: str
    version: int
    updated_at: datetime


class RunView(Strict):
    id: UUID
    shot_id: UUID | None
    kind: str
    status: str
    error: str | None = None
    output_asset_ids: list[UUID] = Field(default_factory=list)
    result: Board | None = None
    applied: bool = False
    created_at: datetime
    prompt: str = ""
    editor_document_id: UUID | None = None


class Readiness(Strict):
    allowed: bool
    billing: str
    message: str
    pending_shots: int


class ProductionView(ProductionSummary):
    settings: ProductionSettings
    snapshot: dict
    board: Board
    runs: list[RunView]
    readiness: Readiness


class CapabilityView(Strict):
    operation: str
    available: bool
    model_name: str | None = None
    model_config_id: UUID | None = None
    parameters: dict = Field(default_factory=dict)
    reason: str | None = None
    negative_prompt: bool = False
    last_frame: bool = False
    max_reference_images: int = 0


class PromptView(Strict):
    prompt: str
    reference_asset_id: UUID | None
    character_image_id: UUID | None
    constraints: list[str]


class ImageChoice(Strict):
    id: UUID
    created_at: datetime


class SaveProductionSettings(Strict):
    expected_version: int = Field(ge=1)
    settings: ProductionSettings


class SourceImpact(Strict):
    fingerprint: str
    changed_chapter_ids: list[UUID]
    affected_shot_ids: list[UUID]
    removed_chapter_ids: list[UUID]
    has_changes: bool


class SyncSource(Strict):
    expected_version: int = Field(ge=1)
    fingerprint: str
    selections: list[ChapterSelection] | None = Field(default=None, max_length=100)


class ExecuteProduction(Strict):
    expected_version: int = Field(ge=1)
    acknowledge_unpriced: bool = False
    auto_export: bool = True
