from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ChatAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reply: str = Field(min_length=1, max_length=16000)
    intent: Literal["chat", "image_generation", "video_generation", "clarification"]
    generation_prompt: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def check_proposal(self):
        if self.intent in {"image_generation", "video_generation"}:
            if not self.generation_prompt or not self.generation_prompt.strip():
                raise ValueError("A generation intent requires a concrete prompt")
        else:
            self.generation_prompt = None
        return self
