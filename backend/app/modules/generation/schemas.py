from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class _StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateGenerationRequest(_StrictRequest):
    prompt: str
    parameters: dict = Field(default_factory=dict)
    reference_asset_ids: list[UUID] = Field(default_factory=list)
    input_id: UUID | None = None
    kind: str = "image"


class GenerationErrorBody(BaseModel):
    code: str
    message: str
    retryable: bool


class GenerationTaskResponse(BaseModel):
    id: UUID
    status: str
    phase: str | None
    progress: int | None
    model_config_id: UUID
    created_at: datetime
    updated_at: datetime
    error: GenerationErrorBody | None
    output_asset_ids: list[UUID]
    reconciliation_required: bool
    allowed_actions: list[str]
    prompt: str
    kind: str = "image"


class GenerationTaskList(BaseModel):
    items: list[GenerationTaskResponse]


class SaveGenerationInputRequest(_StrictRequest):
    id: UUID
    image_base64: str = Field(min_length=1, max_length=111848108)
    mask_base64: str | None = Field(default=None, min_length=1, max_length=111848108)


class GenerationInputResponse(BaseModel):
    id: UUID
    width: int
    height: int


class ImageEditLimits(BaseModel):
    max_width: int
    max_height: int
    max_pixels: int


class ImageEditorOption(BaseModel):
    limits: ImageEditLimits | None = None
    capability: str
    available: bool
    reason: str | None
    model_name: str | None
    resolutions: list[str]
    duration: int | None
