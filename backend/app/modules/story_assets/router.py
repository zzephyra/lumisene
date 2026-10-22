from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse, Response

from app.api.deps import ImageGenerationDep, MutationDep, PrincipalDep, SettingsDep, UowDep
from app.core.errors import NotFoundError
from app.modules.characters.router import Service as CharactersDep
from app.modules.story_assets.schemas import (
    LibraryAsset,
    LibraryDeleteResult,
    LibraryLinkInput,
    LibraryOptions,
    LibraryPage,
    LibraryRename,
)
from app.modules.story_assets.service import StoryAssetService
from app.modules.storyline.service import StorylineService

router = APIRouter(
    prefix="/api/v1/projects/{project_id}/stories/{story_id}",
    tags=["story-assets"],
)

Source = Literal["upload", "generated"]


def service(
    characters: CharactersDep,
    generations: ImageGenerationDep,
    settings: SettingsDep,
) -> StoryAssetService:
    stories = characters.stories
    return StoryAssetService(
        stories,
        characters,
        StorylineService(stories, characters),
        generations,
        settings,
    )


LibraryDep = Annotated[StoryAssetService, Depends(service)]


def _source(source: str) -> Source:
    if source not in {"upload", "generated"}:
        raise NotFoundError("资源不属于当前剧本")
    return source  # type: ignore[return-value]


@router.get("/resources/options", response_model=LibraryOptions)
async def resource_options(
    project_id: UUID,
    story_id: UUID,
    uow: UowDep,
    principal: PrincipalDep,
    library: LibraryDep,
):
    return await library.options(uow, principal.user_id, project_id, story_id)


@router.get("/resources", response_model=LibraryPage)
async def resources(
    project_id: UUID,
    story_id: UUID,
    uow: UowDep,
    principal: PrincipalDep,
    library: LibraryDep,
    category: Literal["all", "character", "scene", "shot", "video", "document"] = "all",
    search: str = "",
    sort: Literal["newest", "oldest", "name"] = "newest",
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=24, ge=1, le=60),
):
    return await library.list(
        uow,
        principal.user_id,
        project_id,
        story_id,
        category,
        search,
        sort,
        offset,
        limit,
    )


@router.post("/resources", response_model=LibraryAsset)
async def attach_resource(
    project_id: UUID,
    story_id: UUID,
    payload: LibraryLinkInput,
    uow: UowDep,
    principal: MutationDep,
    library: LibraryDep,
):
    return await library.attach(uow, principal.user_id, project_id, story_id, payload)


@router.get("/resources/{source}/{resource_id}", response_model=LibraryAsset)
async def resource_detail(
    project_id: UUID,
    story_id: UUID,
    source: str,
    resource_id: UUID,
    uow: UowDep,
    principal: PrincipalDep,
    library: LibraryDep,
):
    return await library.detail(
        uow, principal.user_id, project_id, story_id, _source(source), resource_id
    )


@router.patch("/resources/{source}/{resource_id}", response_model=LibraryAsset)
async def rename_resource(
    project_id: UUID,
    story_id: UUID,
    source: str,
    resource_id: UUID,
    payload: LibraryRename,
    uow: UowDep,
    principal: MutationDep,
    library: LibraryDep,
):
    return await library.rename(
        uow,
        principal.user_id,
        project_id,
        story_id,
        _source(source),
        resource_id,
        payload.name,
    )


@router.delete("/resources/{source}/{resource_id}", response_model=LibraryDeleteResult)
async def remove_resource(
    project_id: UUID,
    story_id: UUID,
    source: str,
    resource_id: UUID,
    uow: UowDep,
    principal: MutationDep,
    library: LibraryDep,
    original: bool = False,
):
    return await library.remove(
        uow,
        principal.user_id,
        project_id,
        story_id,
        _source(source),
        resource_id,
        original,
    )


@router.get("/resources/{source}/{resource_id}/content")
async def resource_content(
    project_id: UUID,
    story_id: UUID,
    source: str,
    resource_id: UUID,
    uow: UowDep,
    principal: PrincipalDep,
    library: LibraryDep,
):
    kind, payload, mime = await library.content(
        uow, principal.user_id, project_id, story_id, _source(source), resource_id
    )
    if kind == "redirect":
        return RedirectResponse(payload, status_code=302)
    return Response(content=payload, media_type=mime)


@router.get("/resources/{source}/{resource_id}/thumbnail")
async def resource_thumbnail(
    project_id: UUID,
    story_id: UUID,
    source: str,
    resource_id: UUID,
    uow: UowDep,
    principal: PrincipalDep,
    library: LibraryDep,
):
    _kind, payload, mime = await library.content(
        uow,
        principal.user_id,
        project_id,
        story_id,
        _source(source),
        resource_id,
        "thumbnail",
    )
    return Response(content=payload, media_type=mime)


@router.get("/resources/{source}/{resource_id}/text")
async def resource_text(
    project_id: UUID,
    story_id: UUID,
    source: str,
    resource_id: UUID,
    uow: UowDep,
    principal: PrincipalDep,
    library: LibraryDep,
):
    _kind, payload, _mime = await library.content(
        uow, principal.user_id, project_id, story_id, _source(source), resource_id, "text"
    )
    return {"text": payload}
