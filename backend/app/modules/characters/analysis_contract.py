from uuid import UUID

from pydantic import Field, model_validator

from app.modules.characters.schemas import Contract


class ScriptInput(Contract):
    filename: str = Field(min_length=1, max_length=200)
    content_base64: str = Field(max_length=7_000_000)


class ScriptView(Contract):
    id: UUID
    filename: str
    parse_status: str


class AnalysisInput(Contract):
    document_id: UUID


class Evidence(Contract):
    segment_id: UUID
    quote: str = Field(min_length=1, max_length=1500)
    source_type: str = Field(pattern="^(explicit|inferred)$")
    confidence: float = Field(ge=0, le=1)


class CandidateCharacter(Contract):
    key: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    title: str = Field(default="", max_length=160)
    role_type: str = Field(default="", max_length=40)
    age: str = Field(default="", max_length=40)
    gender: str = Field(default="", max_length=40)
    occupation: str = Field(default="", max_length=160)
    personality: str = Field(default="", max_length=4000)
    appearance: str = Field(default="", max_length=4000)
    background: str = Field(default="", max_length=4000)
    motivation: str = Field(default="", max_length=4000)
    aliases: list[str] = Field(default_factory=list, max_length=30)
    evidence: list[Evidence] = Field(min_length=1, max_length=30)


class CandidateRelationship(Contract):
    source: str = Field(max_length=80)
    target: str = Field(max_length=80)
    relationship_type: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=4000)
    direction: str = Field(default="undirected", pattern="^(undirected|directed|mutual)$")
    evidence: list[Evidence] = Field(min_length=1, max_length=30)


class Extraction(Contract):
    characters: list[CandidateCharacter] = Field(default_factory=list, max_length=300)
    relationships: list[CandidateRelationship] = Field(default_factory=list, max_length=1000)
    uncertainties: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def endpoints(self):
        ids = [c.key for c in self.characters]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate character keys")
        for r in self.relationships:
            if r.source not in ids or r.target not in ids or r.source == r.target:
                raise ValueError("invalid relationship endpoints")
        return self


class AnalysisView(Contract):
    id: UUID
    document_id: UUID
    status: str
    current_stage: str
    progress: int
    error_message: str | None
    result: dict
    reviewed: bool
