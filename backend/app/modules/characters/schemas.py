"""Versioned, bounded character contracts; unknown facts remain empty."""

from typing import Any, Literal, cast
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True, str_strip_whitespace=True)


class Fact(Contract):
    value: str = Field(default="", max_length=4000)
    source_type: Literal["explicit", "inferred", "user"] = "user"
    evidence_refs: list[UUID] = Field(default_factory=list, max_length=30)
    confidence: float | None = Field(default=None, ge=0, le=1)
    review_status: Literal["pending", "confirmed", "rejected"] = "pending"


class Profile(Contract):
    schema_version: Literal[1] = 1
    personality: dict[str, Fact] = Field(default_factory=dict, max_length=20)
    appearance: dict[str, Fact] = Field(default_factory=dict, max_length=20)
    background: dict[str, Fact] = Field(default_factory=dict, max_length=20)
    motivation: dict[str, Fact] = Field(default_factory=dict, max_length=20)
    character_arc: dict[str, Fact] = Field(default_factory=dict, max_length=20)
    custom_attributes: dict[str, Fact] = Field(default_factory=dict, max_length=20)


class CharacterInput(Contract):
    avatar_upload_id: UUID | None = None
    name: str = Field(min_length=1, max_length=120)
    title: str = Field(default="", max_length=160)
    role_type: str = Field(default="", max_length=40)
    gender: str = Field(default="", max_length=40)
    age: str = Field(default="", max_length=40)
    occupation: str = Field(default="", max_length=160)
    aliases: list[str] = Field(default_factory=list, max_length=30)
    profile_data: Profile = Field(default_factory=Profile)


class CharacterUpdate(CharacterInput):
    expected_version: int = Field(ge=1)


def _card_summary(profile: object) -> str:
    if not isinstance(profile, dict):
        return ""
    for group in ("personality", "background", "motivation"):
        facts = profile.get(group)
        if not isinstance(facts, dict):
            continue
        for fact in facts.values():
            text = fact.get("value") if isinstance(fact, dict) else ""
            if isinstance(text, str) and text.strip():
                return text.strip()[:160]
    return ""


class CharacterSummary(Contract):
    id: UUID
    name: str
    title: str
    role_type: str
    age: str = ""
    occupation: str = ""
    summary: str = ""
    avatar_url: str | None = None
    version: int

    @model_validator(mode="before")
    @classmethod
    def read_card(cls, value: object) -> object:
        if isinstance(value, dict) or not hasattr(value, "profile_data"):
            return value
        character = cast(Any, value)
        return {
            "id": character.id,
            "name": character.name,
            "title": character.title or "",
            "role_type": character.role_type or "",
            "age": character.age or "",
            "occupation": character.occupation or "",
            "summary": _card_summary(character.profile_data),
            "version": character.version,
        }


class CharacterView(CharacterInput):
    avatar_url: str | None = None
    id: UUID
    project_id: UUID
    version: int


class RelationshipEvent(Contract):
    description: str = Field(max_length=4000)
    sequence: int = Field(ge=0)
    evidence_refs: list[UUID] = Field(default_factory=list, max_length=30)


class RelationshipInput(Contract):
    source_character_id: UUID
    target_character_id: UUID
    relationship_type: str = Field(min_length=1, max_length=80)
    direction: Literal["undirected", "directed", "mutual"] = "undirected"
    description: str = Field(default="", max_length=4000)
    status: str = Field(default="", max_length=80)
    confidence: float | None = Field(default=None, ge=0, le=1)
    evidence_refs: list[UUID] = Field(default_factory=list, max_length=30)
    events: list[RelationshipEvent] = Field(default_factory=list, max_length=100)


class RelationshipUpdate(RelationshipInput):
    expected_version: int = Field(ge=1)


class RelationshipView(RelationshipInput):
    id: UUID
    project_id: UUID
    version: int


class Position(Contract):
    x: float = Field(ge=-100000, le=100000, allow_inf_nan=False)
    y: float = Field(ge=-100000, le=100000, allow_inf_nan=False)


class Viewport(Position):
    zoom: float = Field(ge=0.05, le=4, allow_inf_nan=False)


class LayoutInput(Contract):
    expected_version: int = Field(ge=0)
    node_positions: dict[UUID, Position] = Field(default_factory=dict, max_length=1000)
    viewport: Viewport = Field(default_factory=lambda: Viewport(x=0, y=0, zoom=1))


class LayoutView(Contract):
    version: int = 0
    node_positions: dict[str, Position] = Field(default_factory=dict)
    viewport: Viewport = Field(default_factory=lambda: Viewport(x=0, y=0, zoom=1))


class GraphView(Contract):
    characters: list[CharacterSummary]
    relationships: list[RelationshipView]
    layout: LayoutView
