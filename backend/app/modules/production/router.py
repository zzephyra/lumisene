from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request
from fastapi.routing import APIRoute

from app.api.deps import (
    ImageGenerationDep,
    MutationDep,
    PrincipalDep,
    SettingsDep,
    TextCompletionDep,
    UowDep,
    VideoGenerationDep,
)
from app.core.errors import NotFoundError
from app.modules.editor.service import EditorService
from app.modules.production.execution import ProductionExecution
from app.modules.production.media import ProductionMedia
from app.modules.production.planning import ProductionPlanning
from app.modules.production.schemas import (
    CapabilityView,
    CreateProduction,
    ExecuteProduction,
    ExportInput,
    GenerateShot,
    ImageChoice,
    PlanInput,
    ProductionSource,
    ProductionSummary,
    ProductionView,
    PromptView,
    SaveBoard,
    SaveProductionSettings,
    SourceImpact,
    SyncSource,
)
from app.modules.production.service import ProductionService
from app.modules.production.source import ProductionSources
from app.modules.storyline.router import PlotDep

router = APIRouter(prefix="/api/v1/projects/{project_id}/productions", tags=["productions"])


def service(
    plots: PlotDep,
    images: ImageGenerationDep,
    videos: VideoGenerationDep,
    text: TextCompletionDep,
    settings: SettingsDep,
):
    return ProductionService(plots, images, videos, text, EditorService(settings, images))


Service = Annotated[ProductionService, Depends(service)]


@router.get("", response_model=list[ProductionSummary])
async def productions(project_id: UUID, uow: UowDep, principal: PrincipalDep, service: Service):
    return await service.list(uow, principal.user_id, project_id)


@router.post("", response_model=ProductionView, status_code=201)
async def create(
    project_id: UUID,
    payload: CreateProduction,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
):
    return await service.create(uow, principal.user_id, project_id, payload)


@router.get("/capabilities", response_model=list[CapabilityView])
async def capabilities(project_id: UUID, uow: UowDep, principal: PrincipalDep, service: Service):
    await service.plots.stories.projects.get_project(uow, principal.user_id, project_id)
    return await ProductionMedia(service).capabilities(uow)


@router.get("/images", response_model=list[ImageChoice])
async def images(project_id: UUID, uow: UowDep, principal: PrincipalDep, service: Service):
    await service.plots.stories.projects.get_project(uow, principal.user_id, project_id)
    return await service.images.project_images(uow, project_id=project_id)


@router.get("/{production_id}", response_model=ProductionView)
async def detail(
    project_id: UUID, production_id: UUID, uow: UowDep, principal: PrincipalDep, service: Service
):
    return await service.view(uow, principal.user_id, project_id, production_id)


@router.put("/{production_id}/board", response_model=ProductionView, status_code=200)
async def save(
    project_id: UUID,
    production_id: UUID,
    payload: SaveBoard,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
):
    return await service.save(uow, principal.user_id, project_id, production_id, payload)


@router.post("/{production_id}/plans", response_model=ProductionView, status_code=202)
async def plan(
    project_id: UUID,
    production_id: UUID,
    payload: PlanInput,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
    idempotency_key: str = Header(),
):
    return await ProductionPlanning(service).submit(
        uow, principal.user_id, project_id, production_id, payload, idempotency_key
    )


@router.post(
    "/{production_id}/plans/{run_id}/apply", response_model=ProductionView, status_code=200
)
async def apply(
    project_id: UUID,
    production_id: UUID,
    run_id: UUID,
    payload: SaveBoard,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
):
    return await ProductionPlanning(service).apply(
        uow, principal.user_id, project_id, production_id, run_id, payload
    )


@router.post("/{production_id}/shots/{shot_id}/prompt", response_model=PromptView, status_code=200)
async def prompt(
    project_id: UUID,
    production_id: UUID,
    shot_id: UUID,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
):
    return await ProductionMedia(service).prompt(
        uow, principal.user_id, project_id, production_id, shot_id
    )


@router.post(
    "/{production_id}/shots/{shot_id}/generate", response_model=ProductionView, status_code=202
)
async def generate(
    project_id: UUID,
    production_id: UUID,
    shot_id: UUID,
    payload: GenerateShot,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
    idempotency_key: str = Header(),
):
    return await ProductionMedia(service).generate(
        uow, principal.user_id, project_id, production_id, shot_id, payload, idempotency_key
    )


@router.post("/{production_id}/exports", response_model=ProductionView, status_code=202)
async def export(
    project_id: UUID,
    production_id: UUID,
    payload: ExportInput,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
    idempotency_key: str = Header(),
):
    return await ProductionMedia(service).export(
        uow, principal.user_id, project_id, production_id, payload, idempotency_key
    )


@router.delete("/{production_id}/versions/{run_id}", response_model=ProductionView, status_code=200)
async def remove(
    project_id: UUID,
    production_id: UUID,
    run_id: UUID,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
):
    return await ProductionMedia(service).remove_version(
        uow, principal.user_id, project_id, production_id, run_id
    )


@router.get("/source/{story_id}", response_model=ProductionSource)
async def source(
    project_id: UUID, story_id: UUID, uow: UowDep, principal: PrincipalDep, service: Service
):
    return await ProductionSources(service).source(uow, principal.user_id, project_id, story_id)


@router.put("/{production_id}/settings", response_model=ProductionView)
async def settings(
    project_id: UUID,
    production_id: UUID,
    payload: SaveProductionSettings,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
):
    return await service.save_settings(uow, principal.user_id, project_id, production_id, payload)


@router.get("/{production_id}/source-impact", response_model=SourceImpact)
async def impact(
    project_id: UUID, production_id: UUID, uow: UowDep, principal: PrincipalDep, service: Service
):
    return await ProductionSources(service).impact(
        uow, principal.user_id, project_id, production_id
    )


@router.post("/{production_id}/sync-source", response_model=ProductionView)
async def sync(
    project_id: UUID,
    production_id: UUID,
    payload: SyncSource,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
):
    return await ProductionSources(service).sync(
        uow, principal.user_id, project_id, production_id, payload
    )


@router.post("/{production_id}/execute", response_model=ProductionView, status_code=202)
async def execute(
    project_id: UUID,
    production_id: UUID,
    payload: ExecuteProduction,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
    idempotency_key: str = Header(),
):
    return await ProductionExecution(service).submit(
        uow, principal.user_id, project_id, production_id, payload, idempotency_key
    )


@router.post("/{production_id}/copy-settings", response_model=ProductionView, status_code=201)
async def copy_settings(
    project_id: UUID, production_id: UUID, uow: UowDep, principal: MutationDep, service: Service
):
    return await service.copy_settings(uow, principal.user_id, project_id, production_id)


# Compatibility endpoints remain project scoped; new UI always uses the story-scoped routes.
async def require_story_scope(
    request: Request,
    project_id: UUID,
    story_id: UUID,
    uow: UowDep,
    principal: PrincipalDep,
    service: Service,
):
    await service.plots.stories.get(uow, principal.user_id, project_id, story_id)
    identity = request.path_params.get("production_id")
    if identity:
        row = await service.get(uow, principal.user_id, project_id, UUID(identity))
        if row.story_id != story_id:
            raise NotFoundError("制作任务不属于当前故事")
    elif request.method == "POST" and request.url.path.rstrip("/").endswith("/productions"):
        body = await request.json()
        if not isinstance(body, dict) or body.get("story_id") != str(story_id):
            raise NotFoundError("制作任务必须属于当前故事")


story_router = APIRouter(
    prefix="/api/v1/projects/{project_id}/stories/{story_id}/productions",
    tags=["story-productions"],
    dependencies=[Depends(require_story_scope)],
)


@story_router.get("", response_model=list[ProductionView])
async def story_productions(
    project_id: UUID, story_id: UUID, uow: UowDep, principal: PrincipalDep, service: Service
):
    return await service.list_story(uow, principal.user_id, project_id, story_id)


for route in router.routes:
    if isinstance(route, APIRoute):
        local = route.path.removeprefix(router.prefix)
        if local.startswith("/source/") or (local == "" and "GET" in route.methods):
            continue
        story_router.add_api_route(
            local,
            route.endpoint,
            methods=list(route.methods),
            response_model=route.response_model,
            status_code=route.status_code,
            operation_id="story_production_" + route.name,
        )
