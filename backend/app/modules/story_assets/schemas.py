from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class LibraryLinkInput(BaseModel):
    upload_id: UUID | None = None
    asset_id: UUID | None = None
    name: str = Field(default='',max_length=200)
    category: Literal['general','scene','shot'] = 'general'
    scene_id: UUID | None = None
    @model_validator(mode='after')
    def source(self):
        if (self.upload_id is None) == (self.asset_id is None):
            raise ValueError('请选择一个上传或生成资源')
        return self

class LibraryRename(BaseModel):
    name: str = Field(min_length=1,max_length=200)

class LibraryReference(BaseModel):
    type: Literal['story','character','scene']
    id: UUID
    name: str
    primary: bool = False

class LibraryAsset(BaseModel):
    id: UUID
    source: Literal['upload','generated']
    asset_id: UUID | None
    upload_id: UUID | None
    name: str
    filename: str
    kind: Literal['image','video','document']
    mime: str
    size: int
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None
    created_at: datetime
    references: list[LibraryReference]
    direct_link_id: UUID | None = None
    category: str
    preview_url: str
    thumbnail_url: str | None = None
    can_delete: bool = False

class LibraryPage(BaseModel):
    items: list[LibraryAsset]
    total: int
    next_offset: int | None = None

class LibraryOptions(BaseModel):
    limits: dict[str,int]
    formats: dict[str,list[str]]

class LibraryDeleteResult(BaseModel):
    removed: bool
    policy: str
