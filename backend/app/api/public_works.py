from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Header, Query, Response
from pydantic import BaseModel

from app.api.deps import ImageGenerationDep, MutationDep, PrincipalDep, ProjectServiceDep, UowDep
from app.api.generation import serve_asset_content
from app.api.security import no_store
from app.modules.generation.publication import PublicationService

router = APIRouter(prefix="/api/v1", tags=["works"])


class WorkPublication(BaseModel):
    id: UUID
    public: bool
    can_publish: bool


class PublicationRequest(BaseModel):
    public: bool


class PublicWork(BaseModel):
    id: UUID
    kind: Literal["image", "video"]
    width: int | None
    height: int | None
    published_at: datetime


@router.get("/projects/{project_id}/assets/publication", response_model=list[WorkPublication])
async def publications(
    project_id: UUID,
    response: Response,
    uow: UowDep,
    principal: PrincipalDep,
    projects: ProjectServiceDep,
    offset: int = Query(0, ge=0),
) -> list[WorkPublication]:
    rows = await PublicationService(projects).project_works(
        uow, principal.user_id, project_id, offset
    )
    no_store(response)
    return [
        WorkPublication(
            id=row.id,
            public=row.published_at is not None,
            can_publish=row.created_by == principal.user_id,
        )
        for row in rows
    ]


@router.patch(
    "/projects/{project_id}/assets/{asset_id}/publication", response_model=WorkPublication
)
async def publish(
    project_id: UUID,
    asset_id: UUID,
    payload: PublicationRequest,
    response: Response,
    uow: UowDep,
    principal: MutationDep,
    projects: ProjectServiceDep,
) -> WorkPublication:
    row = await PublicationService(projects).set_public(
        uow, principal.user_id, project_id, asset_id, payload.public
    )
    no_store(response)
    return WorkPublication(id=row.id, public=row.published_at is not None, can_publish=True)


@router.get("/public/users/{user_id}/works", response_model=list[PublicWork])
async def public_works(
    user_id: UUID,
    response: Response,
    uow: UowDep,
    projects: ProjectServiceDep,
    offset: int = Query(0, ge=0),
    kind: Literal["image", "video"] | None = None,
) -> list[PublicWork]:
    rows = await PublicationService(projects).public_works(uow, user_id, offset, kind)
    no_store(response)
    return [
        PublicWork(
            id=row.id,
            kind=row.kind.lower(),
            width=row.width,
            height=row.height,
            published_at=row.published_at,
        )
        for row in rows
    ]


@router.get("/public/users/{user_id}/works/{asset_id}/content")
async def public_content(
    user_id: UUID,
    asset_id: UUID,
    uow: UowDep,
    projects: ProjectServiceDep,
    generations: ImageGenerationDep,
    range_header: Annotated[str | None, Header(alias="Range")] = None,
) -> Response:
    row = await PublicationService(projects).public_asset(uow, user_id, asset_id)
    return await serve_asset_content(row, uow, generations, range_header)
