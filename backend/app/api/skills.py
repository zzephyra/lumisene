from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Response

from app.api.deps import PlatformAdminDep, PlatformAdminReadDep, UowDep
from app.api.security import no_store
from app.infrastructure.ai.skills import (
    SkillCatalogue,
    SkillCreate,
    SkillItem,
    SkillList,
    SkillUpdate,
)

router = APIRouter(prefix="/api/v1/admin/skills", tags=["skills"])
catalogue = SkillCatalogue()


@router.get("", response_model=SkillList)
async def list_skills(
    response: Response,
    uow: UowDep,
    _: PlatformAdminReadDep,
    q: Annotated[str, Query(max_length=120)] = "",
    enabled: bool | None = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    no_store(response)
    return await catalogue.list(uow, q.strip(), enabled, offset, limit)


@router.post("", response_model=SkillItem, status_code=201)
async def create_skill(
    payload: SkillCreate, response: Response, uow: UowDep, principal: PlatformAdminDep
):
    no_store(response)
    return await catalogue.create(uow, principal.user_id, payload)


@router.get("/{skill_id}", response_model=SkillItem)
async def get_skill(skill_id: UUID, response: Response, uow: UowDep, _: PlatformAdminReadDep):
    no_store(response)
    return SkillItem.model_validate(await catalogue.get(uow, skill_id))


@router.patch("/{skill_id}", response_model=SkillItem)
async def update_skill(
    skill_id: UUID,
    payload: SkillUpdate,
    response: Response,
    uow: UowDep,
    principal: PlatformAdminDep,
):
    no_store(response)
    return await catalogue.update(uow, principal.user_id, skill_id, payload)


@router.delete("/{skill_id}", status_code=204)
async def delete_skill(
    skill_id: UUID,
    uow: UowDep,
    principal: PlatformAdminDep,
    expected_version: Annotated[int, Query(ge=1)],
):
    await catalogue.delete(uow, principal.user_id, skill_id, expected_version)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
