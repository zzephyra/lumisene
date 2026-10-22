from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import MutationDep, PrincipalDep, ProjectServiceDep, UowDep, UploadServiceDep
from app.modules.stories.schemas import StoryInput, StoryPage, StoryUpdate, StoryView
from app.modules.stories.service import StoryService

router = APIRouter(prefix="/api/v1/projects/{project_id}", tags=["stories"])


def service(projects: ProjectServiceDep, uploads: UploadServiceDep) -> StoryService:
    return StoryService(projects, uploads)


Service = Annotated[StoryService, Depends(service)]


@router.get("/stories", response_model=StoryPage)
async def list_stories(
    project_id: UUID,
    uow: UowDep,
    principal: PrincipalDep,
    stories: Service,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
):
    return await stories.list_stories(
        uow, principal.user_id, project_id, limit=limit, cursor=cursor
    )


@router.post("/stories", response_model=StoryView, status_code=201)
async def create_story(
    project_id: UUID,
    payload: StoryInput,
    uow: UowDep,
    principal: MutationDep,
    stories: Service,
):
    return await stories.create(uow, principal.user_id, project_id, payload)


@router.get("/stories/{story_id}", response_model=StoryView)
async def story(
    project_id: UUID, story_id: UUID, uow: UowDep, principal: PrincipalDep, stories: Service
):
    return await stories.get(uow, principal.user_id, project_id, story_id)


@router.patch("/stories/{story_id}", response_model=StoryView)
async def update_story(
    project_id: UUID,
    story_id: UUID,
    payload: StoryUpdate,
    uow: UowDep,
    principal: MutationDep,
    stories: Service,
):
    return await stories.update(uow, principal.user_id, project_id, story_id, payload)


@router.delete("/stories/{story_id}", status_code=204)
async def delete_story(
    project_id: UUID,
    story_id: UUID,
    uow: UowDep,
    principal: MutationDep,
    stories: Service,
    expected_version: int = Query(ge=1),
):
    await stories.delete(uow, principal.user_id, project_id, story_id, expected_version)
    return Response(status_code=204)
