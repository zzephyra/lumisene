from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response

from app.api.deps import MutationDep, PrincipalDep, SettingsDep, UowDep
from app.infrastructure.ai.text_completion import TextCompletionService
from app.modules.characters.router import Service as CharactersDep
from app.modules.storyline.ai import PlotAIService
from app.modules.storyline.schemas import (
    ApplyPlotInput,
    ChapterInput,
    ChapterList,
    ChapterUpdate,
    ChapterView,
    PlotGenerateInput,
    PlotJobView,
    ReorderInput,
    SceneInput,
    SceneList,
    SceneUpdate,
    SceneView,
)
from app.modules.storyline.service import StorylineService

router = APIRouter(
    prefix="/api/v1/projects/{project_id}/stories/{story_id}/plot", tags=["storyline"]
)


def plots(characters: CharactersDep):
    return StorylineService(characters.stories, characters)


PlotDep = Annotated[StorylineService, Depends(plots)]


def ai(plots: PlotDep, settings: SettingsDep):
    return PlotAIService(plots, TextCompletionService(settings))


AIDep = Annotated[PlotAIService, Depends(ai)]


@router.get("/chapters", response_model=ChapterList)
async def chapters(
    project_id: UUID, story_id: UUID, principal: PrincipalDep, uow: UowDep, service: PlotDep
):
    return await service.chapters(uow, principal.user_id, project_id, story_id)


@router.post("/chapters", response_model=ChapterView, status_code=201)
async def create_chapter(
    project_id: UUID,
    story_id: UUID,
    payload: ChapterInput,
    principal: MutationDep,
    uow: UowDep,
    service: PlotDep,
):
    return await service.save(uow, principal.user_id, project_id, story_id, payload)


@router.put("/chapters/order", status_code=204)
async def chapter_order(
    project_id: UUID,
    story_id: UUID,
    payload: ReorderInput,
    principal: MutationDep,
    uow: UowDep,
    service: PlotDep,
):
    await service.reorder(uow, principal.user_id, project_id, story_id, payload)
    return Response(status_code=204)


@router.get("/chapters/{chapter_id}", response_model=ChapterView)
async def chapter(
    project_id: UUID,
    story_id: UUID,
    chapter_id: UUID,
    principal: PrincipalDep,
    uow: UowDep,
    service: PlotDep,
):
    return await service.detail(uow, principal.user_id, project_id, story_id, chapter_id)


@router.patch("/chapters/{chapter_id}", response_model=ChapterView)
async def update_chapter(
    project_id: UUID,
    story_id: UUID,
    chapter_id: UUID,
    payload: ChapterUpdate,
    principal: MutationDep,
    uow: UowDep,
    service: PlotDep,
):
    return await service.save(
        uow, principal.user_id, project_id, story_id, payload, identity=chapter_id
    )


@router.delete("/chapters/{chapter_id}", status_code=204)
async def delete_chapter(
    project_id: UUID,
    story_id: UUID,
    chapter_id: UUID,
    principal: MutationDep,
    uow: UowDep,
    service: PlotDep,
    expected_version: int = Query(ge=1),
):
    await service.delete(uow, principal.user_id, project_id, story_id, chapter_id, expected_version)
    return Response(status_code=204)


@router.get("/chapters/{chapter_id}/scenes", response_model=SceneList)
async def scenes(
    project_id: UUID,
    story_id: UUID,
    chapter_id: UUID,
    principal: PrincipalDep,
    uow: UowDep,
    service: PlotDep,
):
    return await service.scenes(uow, principal.user_id, project_id, story_id, chapter_id)


@router.post("/chapters/{chapter_id}/scenes", response_model=SceneView, status_code=201)
async def create_scene(
    project_id: UUID,
    story_id: UUID,
    chapter_id: UUID,
    payload: SceneInput,
    principal: MutationDep,
    uow: UowDep,
    service: PlotDep,
):
    return await service.save(
        uow, principal.user_id, project_id, story_id, payload, chapter=chapter_id, scene=True
    )


@router.put("/chapters/{chapter_id}/scenes/order", status_code=204)
async def scene_order(
    project_id: UUID,
    story_id: UUID,
    chapter_id: UUID,
    payload: ReorderInput,
    principal: MutationDep,
    uow: UowDep,
    service: PlotDep,
):
    await service.reorder(uow, principal.user_id, project_id, story_id, payload, chapter=chapter_id)
    return Response(status_code=204)


@router.get("/scenes/{scene_id}", response_model=SceneView)
async def scene(
    project_id: UUID,
    story_id: UUID,
    scene_id: UUID,
    principal: PrincipalDep,
    uow: UowDep,
    service: PlotDep,
):
    return await service.detail(uow, principal.user_id, project_id, story_id, scene_id, scene=True)


@router.patch("/scenes/{scene_id}", response_model=SceneView)
async def update_scene(
    project_id: UUID,
    story_id: UUID,
    scene_id: UUID,
    payload: SceneUpdate,
    principal: MutationDep,
    uow: UowDep,
    service: PlotDep,
):
    return await service.save(
        uow, principal.user_id, project_id, story_id, payload, identity=scene_id, scene=True
    )


@router.delete("/scenes/{scene_id}", status_code=204)
async def delete_scene(
    project_id: UUID,
    story_id: UUID,
    scene_id: UUID,
    principal: MutationDep,
    uow: UowDep,
    service: PlotDep,
    expected_version: int = Query(ge=1),
):
    await service.delete(
        uow, principal.user_id, project_id, story_id, scene_id, expected_version, scene=True
    )
    return Response(status_code=204)


@router.get("/jobs", response_model=list[PlotJobView])
async def jobs(
    project_id: UUID, story_id: UUID, principal: PrincipalDep, uow: UowDep, service: AIDep
):
    return await service.jobs(uow, principal.user_id, project_id, story_id)


@router.post("/jobs", response_model=PlotJobView, status_code=202)
async def generate(
    project_id: UUID,
    story_id: UUID,
    payload: PlotGenerateInput,
    principal: MutationDep,
    uow: UowDep,
    service: AIDep,
    idempotency_key: str = Header(),
):
    return await service.submit(
        uow, principal.user_id, project_id, story_id, payload, idempotency_key
    )


@router.post("/jobs/{job_id}/apply", response_model=PlotJobView)
async def apply(
    project_id: UUID,
    story_id: UUID,
    job_id: UUID,
    payload: ApplyPlotInput,
    principal: MutationDep,
    uow: UowDep,
    service: AIDep,
):
    return await service.apply(uow, principal.user_id, project_id, story_id, job_id, payload.result)


@router.delete("/jobs/{job_id}", status_code=204)
async def cancel(
    project_id: UUID,
    story_id: UUID,
    job_id: UUID,
    principal: MutationDep,
    uow: UowDep,
    service: AIDep,
):
    await service.cancel(uow, principal.user_id, project_id, story_id, job_id)
    return Response(status_code=204)
