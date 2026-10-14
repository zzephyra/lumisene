from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class _StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateModelConfigRequest(_StrictRequest):
    provider: str
    model_name: str
    capability: str
    parameters_schema: dict[str, Any]
    limits: dict[str, Any]
    secret_ref: str


class DisableModelConfigRequest(_StrictRequest):
    enabled: bool


class PublicModelConfig(BaseModel):
    id: UUID
    provider: str
    model_name: str
    capability: str
    config_version: int
    parameters_schema: dict[str, Any]
    limits: dict[str, Any]


class PublicModelConfigList(BaseModel):
    items: list[PublicModelConfig]


class AdminModelConfig(PublicModelConfig):
    secret_ref: str
    enabled: bool
    created_at: datetime
    updated_at: datetime


class AdminModelConfigList(BaseModel):
    items: list[AdminModelConfig]


class ProviderModelOption(BaseModel):
    name: str
    alias_zh: str
    alias_en: str
    capabilities: list[str]
    inputs: list[str] = []
    parameters: dict[str, Any]


class ProviderCatalogItem(BaseModel):
    id: str
    alias_zh: str
    alias_en: str
    models: list[ProviderModelOption]


class ProviderCatalogList(BaseModel):
    items: list[ProviderCatalogItem]


class ModelAssignmentItem(BaseModel):
    capability: str
    model_config_id: UUID | None = None
    provider: str | None = None
    model_name: str | None = None
    config_version: int | None = None


class ModelAssignmentList(BaseModel):
    items: list[ModelAssignmentItem]


class AssignModelRequest(_StrictRequest):
    model_config_id: UUID


class SubmitTextCompletionRequest(_StrictRequest):
    prompt: str


class TextCompletionErrorBody(BaseModel):
    code: str
    message: str


class TextCompletionResponse(BaseModel):
    id: UUID
    status: str
    content: str | None
    error: TextCompletionErrorBody | None
