from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class Clip(StrictModel):
    id: UUID
    asset_id: UUID
    source_start_frame: int = Field(ge=0)
    source_end_frame: int = Field(gt=0, le=18000)
    original_duration: int = Field(gt=0, le=18000)
    timeline_start_frame: int = Field(ge=0, le=17999)
    duration: int = Field(gt=0, le=18000)
    volume: float = Field(ge=0, le=1, default=1)
    muted: bool = False
    speed: Literal[1] = 1

    @model_validator(mode="after")
    def boundaries(self):
        if self.source_end_frame > self.original_duration:
            raise ValueError("Source end exceeds media duration")
        if self.source_end_frame - self.source_start_frame != self.duration:
            raise ValueError("Source range must equal clip duration")
        return self


class VideoTrack(StrictModel):
    id: Literal["video"] = "video"
    type: Literal["video"] = "video"
    clips: list[Clip] = Field(max_length=100)


class Composition(StrictModel):
    schema_version: Literal[1] = 1
    fps: Literal[30] = 30
    width: int = Field(ge=240, le=1920, multiple_of=2)
    height: int = Field(ge=240, le=1920, multiple_of=2)
    duration_in_frames: int = Field(ge=1, le=18000)
    frame: Literal["fit", "fill"] = "fit"
    tracks: list[VideoTrack] = Field(min_length=1, max_length=1)

    @model_validator(mode="after")
    def timeline(self):
        end = 0
        ids = set()
        for clip in sorted(self.tracks[0].clips, key=lambda item: item.timeline_start_frame):
            if clip.id in ids or clip.timeline_start_frame < end:
                raise ValueError("Duplicate or overlapping clips")
            ids.add(clip.id)
            end = clip.timeline_start_frame + clip.duration
        if end > self.duration_in_frames:
            raise ValueError("Clip exceeds composition duration")
        return self


class SaveDocument(StrictModel):
    title: str = Field(min_length=1, max_length=120)
    composition: Composition
    expected_version: int = Field(ge=1)


class CreateDocument(StrictModel):
    title: str = Field(min_length=1, max_length=120, default="未命名剪辑")
    composition: Composition


class DocumentResponse(StrictModel):
    id: UUID
    project_id: UUID
    title: str
    composition: Composition
    version: int
    updated_at: datetime


class DocumentList(StrictModel):
    items: list[DocumentResponse]
    next_cursor: str | None = None


class RenderRequest(StrictModel):
    expected_version: int = Field(ge=1)


class RenderResponse(StrictModel):
    id: UUID
    document_id: UUID
    status: Literal["queued", "running", "succeeded", "failed", "canceled"]
    output_asset_id: UUID | None
    error: str | None


class MediaResponse(StrictModel):
    id: UUID
    width: int | None
    height: int | None


class MediaList(StrictModel):
    items: list[MediaResponse]
    next_cursor: str | None = None
