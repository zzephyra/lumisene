from abc import ABC, abstractmethod
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field

ImageResults = list[tuple[bytes, str]]


class ModelInfo(BaseModel):
    name: str
    provider: str


class SkillContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_prompt: str = Field(max_length=10000, repr=False)
    model: ModelInfo
    trace_id: str
    scene_context: dict[str, Any] = Field(default_factory=dict, repr=False)


class SkillConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    name: str
    description: str
    version: str
    enabled: bool = True
    supported_models: list[str] = Field(default_factory=list)
    scene_analysis: bool = True
    model_overrides: dict[str, str] = Field(default_factory=dict)


class SkillSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    version: str
    prompt_version: str
    constraints: str = Field(repr=False)
    system_prompt: str = Field(repr=False)
    refine_prompt: str = Field(repr=False)
    task_templates: dict[str, str] = Field(default_factory=dict, repr=False)
    supplement: str = Field(default="", repr=False)
    model_override: str = Field(default="", repr=False)
    model: ModelInfo
    scene_analysis: bool = True
    catalogue_id: str | None = None
    catalogue_version: int | None = None


class ImageAdapter(Protocol):
    async def edit(
        self, *, prompt: str, image: bytes, mask: bytes, full_context: bool = False
    ) -> ImageResults: ...


class BaseSkill(ABC):
    def __init__(self, config: SkillConfig, system_prompt: str, refine_prompt: str) -> None:
        self.config = config
        self.system_prompt = system_prompt
        self.refine_prompt = refine_prompt

    @property
    def key(self) -> str:
        return self.config.key

    @property
    def name(self) -> str:
        return self.config.name

    @property
    def version(self) -> str:
        return self.config.version

    @property
    def description(self) -> str:
        return self.config.description

    @property
    def supported_models(self) -> list[str]:
        return self.config.supported_models

    @abstractmethod
    def validate_input(self, context: SkillContext) -> None: ...

    @abstractmethod
    def build_prompt(self, context: SkillContext, snapshot: SkillSnapshot) -> str: ...

    @abstractmethod
    async def execute(
        self, context: SkillContext, *, prompt: str, snapshot: SkillSnapshot, adapter: ImageAdapter
    ) -> ImageResults: ...
