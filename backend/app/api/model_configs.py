from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Response

from app.api.deps import (
    ModelCatalogDep,
    PlatformAdminDep,
    PlatformAdminReadDep,
    PrincipalDep,
    ProjectServiceDep,
    UowDep,
)
from app.api.security import no_store
from app.infrastructure.ai.schemas import (
    AdminModelConfig,
    AdminModelConfigList,
    AssignModelRequest,
    CreateModelConfigRequest,
    DisableModelConfigRequest,
    ModelAssignmentItem,
    ModelAssignmentList,
    ProviderCatalogList,
    PublicModelConfig,
    PublicModelConfigList,
)

router = APIRouter(prefix="/api/v1", tags=["models"])


@router.get("/projects/{project_id}/models", response_model=PublicModelConfigList)
async def list_project_models(
    project_id: UUID,
    response: Response,
    uow: UowDep,
    principal: PrincipalDep,
    projects: ProjectServiceDep,
    catalog: ModelCatalogDep,
    capability: Annotated[str | None, Query()] = None,
) -> PublicModelConfigList:
    await projects.get_project(uow, principal.user_id, project_id)
    items = await catalog.list_enabled(uow, capability)
    no_store(response)
    return PublicModelConfigList(items=items)


@router.get("/projects/{project_id}/active-model", response_model=PublicModelConfig)
async def get_active_model(
    project_id: UUID,
    response: Response,
    uow: UowDep,
    principal: PrincipalDep,
    projects: ProjectServiceDep,
    catalog: ModelCatalogDep,
    capability: Annotated[str, Query()],
) -> PublicModelConfig:
    await projects.get_project(uow, principal.user_id, project_id)
    item = await catalog.active_model(uow, capability)
    no_store(response)
    return item


@router.get("/admin/model-assignments", response_model=ModelAssignmentList)
async def list_model_assignments(
    response: Response,
    uow: UowDep,
    _: PlatformAdminReadDep,
    catalog: ModelCatalogDep,
) -> ModelAssignmentList:
    items = await catalog.list_assignments(uow)
    no_store(response)
    return ModelAssignmentList(items=items)


@router.put("/admin/model-assignments/{capability}", response_model=ModelAssignmentItem)
async def assign_model(
    capability: str,
    payload: AssignModelRequest,
    response: Response,
    uow: UowDep,
    principal: PlatformAdminDep,
    catalog: ModelCatalogDep,
) -> ModelAssignmentItem:
    item = await catalog.assign(
        uow,
        actor_id=principal.user_id,
        capability=capability,
        model_config_id=payload.model_config_id,
    )
    no_store(response)
    return item


@router.delete("/admin/model-assignments/{capability}", status_code=204)
async def clear_model_assignment(
    capability: str,
    uow: UowDep,
    principal: PlatformAdminDep,
    catalog: ModelCatalogDep,
) -> Response:
    await catalog.clear(uow, actor_id=principal.user_id, capability=capability)
    return Response(status_code=204)


@router.get("/admin/model-catalog", response_model=ProviderCatalogList)
async def list_model_catalog(
    response: Response,
    _: PlatformAdminReadDep,
    catalog: ModelCatalogDep,
) -> ProviderCatalogList:
    no_store(response)
    return ProviderCatalogList(items=catalog.provider_catalog())


@router.get("/admin/model-configs", response_model=AdminModelConfigList)
async def list_model_configs(
    response: Response,
    uow: UowDep,
    _: PlatformAdminReadDep,
    catalog: ModelCatalogDep,
) -> AdminModelConfigList:
    items = await catalog.list_for_admin(uow)
    no_store(response)
    return AdminModelConfigList(items=items)


@router.post("/admin/model-configs", response_model=AdminModelConfig, status_code=201)
async def create_model_config(
    payload: CreateModelConfigRequest,
    response: Response,
    uow: UowDep,
    principal: PlatformAdminDep,
    catalog: ModelCatalogDep,
) -> AdminModelConfig:
    created = await catalog.create(
        uow,
        actor_id=principal.user_id,
        provider=payload.provider,
        model_name=payload.model_name,
        capability=payload.capability,
        parameters_schema=payload.parameters_schema,
        limits=payload.limits,
        secret_ref=payload.secret_ref,
    )
    no_store(response)
    return created


@router.patch("/admin/model-configs/{config_id}", response_model=AdminModelConfig)
async def disable_model_config(
    config_id: UUID,
    payload: DisableModelConfigRequest,
    response: Response,
    uow: UowDep,
    principal: PlatformAdminDep,
    catalog: ModelCatalogDep,
) -> AdminModelConfig:
    updated = await catalog.disable(
        uow,
        actor_id=principal.user_id,
        config_id=config_id,
        enabled=payload.enabled,
    )
    no_store(response)
    return updated
