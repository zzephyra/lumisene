from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response

from app.api.deps import (
    ImageGenerationDep,
    MutationDep,
    PrincipalDep,
    ProjectServiceDep,
    UowDep,
    UploadServiceDep,
    get_app_settings,
)
from app.core.config import Settings
from app.modules.characters.analysis import AnalysisService
from app.modules.characters.analysis_contract import (
    AnalysisInput,
    AnalysisView,
    ScriptInput,
    ScriptView,
)
from app.modules.characters.image_schemas import (
    AddCharacterImage,
    CharacterImagesView,
    GenerateCharacterImage,
)
from app.modules.characters.images import CharacterImagesService
from app.modules.characters.schemas import (
    CharacterInput,
    CharacterUpdate,
    CharacterView,
    GraphView,
    LayoutInput,
    LayoutView,
    RelationshipInput,
    RelationshipUpdate,
    RelationshipView,
)
from app.modules.characters.service import CharacterService
from app.modules.stories.service import StoryService

router = APIRouter(prefix="/api/v1/projects/{project_id}/stories/{story_id}", tags=["characters"])


def service(projects: ProjectServiceDep, uploads: UploadServiceDep) -> CharacterService:
    return CharacterService(projects, StoryService(projects, uploads))


Service = Annotated[CharacterService, Depends(service)]


@router.get("/character-graph", response_model=GraphView)
async def graph(
    project_id: UUID, story_id: UUID, uow: UowDep, principal: PrincipalDep, service: Service
):
    return await service.graph(uow, principal.user_id, project_id, story_id)


@router.put("/character-graph/layout", response_model=LayoutView)
async def layout(
    project_id: UUID,
    story_id: UUID,
    payload: LayoutInput,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
):
    return await service.layout(uow, principal.user_id, project_id, story_id, payload)


@router.get("/characters/{character_id}", response_model=CharacterView)
async def character(
    project_id: UUID,
    story_id: UUID,
    character_id: UUID,
    uow: UowDep,
    principal: PrincipalDep,
    service: Service,
):
    return await service.get(uow, principal.user_id, project_id, story_id, character_id)


@router.post("/characters", response_model=CharacterView, status_code=201)
async def create_character(
    project_id: UUID,
    story_id: UUID,
    payload: CharacterInput,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
):
    return await service.save(uow, principal.user_id, project_id, story_id, payload)


@router.patch("/characters/{character_id}", response_model=CharacterView)
async def update_character(
    project_id: UUID,
    story_id: UUID,
    character_id: UUID,
    payload: CharacterUpdate,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
):
    return await service.save(uow, principal.user_id, project_id, story_id, payload, character_id)


@router.delete("/characters/{character_id}", status_code=204)
async def delete_character(
    project_id: UUID,
    story_id: UUID,
    character_id: UUID,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
    expected_version: int = Query(ge=1),
):
    await service.delete(
        uow, principal.user_id, project_id, story_id, character_id, expected_version
    )
    return Response(status_code=204)


@router.get("/relationships/{relationship_id}", response_model=RelationshipView)
async def relationship(
    project_id: UUID,
    story_id: UUID,
    relationship_id: UUID,
    uow: UowDep,
    principal: PrincipalDep,
    service: Service,
):
    return await service.get(
        uow, principal.user_id, project_id, story_id, relationship_id, relationship=True
    )


@router.post("/relationships", response_model=RelationshipView, status_code=201)
async def create_relationship(
    project_id: UUID,
    story_id: UUID,
    payload: RelationshipInput,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
):
    return await service.save(
        uow, principal.user_id, project_id, story_id, payload, relationship=True
    )


@router.patch("/relationships/{relationship_id}", response_model=RelationshipView)
async def update_relationship(
    project_id: UUID,
    story_id: UUID,
    relationship_id: UUID,
    payload: RelationshipUpdate,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
):
    return await service.save(
        uow,
        principal.user_id,
        project_id,
        story_id,
        payload,
        relationship_id,
        relationship=True,
    )


@router.delete("/relationships/{relationship_id}", status_code=204)
async def delete_relationship(
    project_id: UUID,
    story_id: UUID,
    relationship_id: UUID,
    uow: UowDep,
    principal: MutationDep,
    service: Service,
    expected_version: int = Query(ge=1),
):
    await service.delete(
        uow,
        principal.user_id,
        project_id,
        story_id,
        relationship_id,
        expected_version,
        relationship=True,
    )
    return Response(status_code=204)


def analysis_service(
    settings: Annotated[Settings, Depends(get_app_settings)],
    projects: ProjectServiceDep,
    uploads: UploadServiceDep,
):
    return AnalysisService(settings, projects, stories=StoryService(projects, uploads))


Analysis = Annotated[AnalysisService, Depends(analysis_service)]


@router.post("/scripts", response_model=ScriptView, status_code=201)
async def upload_script(
    project_id: UUID,
    story_id: UUID,
    payload: ScriptInput,
    uow: UowDep,
    principal: MutationDep,
    service: Analysis,
):
    return await service.upload(uow, principal.user_id, project_id, story_id, payload)


@router.post("/character-analysis", response_model=AnalysisView, status_code=201)
async def submit_analysis(
    project_id: UUID,
    story_id: UUID,
    payload: AnalysisInput,
    uow: UowDep,
    principal: MutationDep,
    service: Analysis,
    idempotency_key: Annotated[
        str, Header(min_length=1, max_length=128, pattern=r"^[\x20-\x7E]+$")
    ],
):
    return await service.submit(
        uow, principal.user_id, project_id, story_id, payload.document_id, idempotency_key
    )


@router.get("/character-analysis/{job_id}", response_model=AnalysisView)
async def analysis_status(
    project_id: UUID,
    story_id: UUID,
    job_id: UUID,
    uow: UowDep,
    principal: PrincipalDep,
    service: Analysis,
):
    return await service.get(uow, principal.user_id, project_id, story_id, job_id)


@router.post("/character-analysis/{job_id}/{action}", response_model=AnalysisView)
async def analysis_command(
    project_id: UUID,
    story_id: UUID,
    job_id: UUID,
    action: Literal["cancel", "retry", "accept"],
    uow: UowDep,
    principal: MutationDep,
    service: Analysis,
):
    return await service.command(uow, principal.user_id, project_id, story_id, job_id, action)


@router.get("/character-analysis", response_model=list[AnalysisView])
async def list_analysis(
    project_id: UUID, story_id: UUID, uow: UowDep, principal: PrincipalDep, service: Analysis
):
    return await service.list_jobs(uow, principal.user_id, project_id, story_id)


@router.get("/evidence/{evidence_id}")
async def evidence(
    project_id: UUID,
    story_id: UUID,
    evidence_id: UUID,
    uow: UowDep,
    principal: PrincipalDep,
    service: Analysis,
):
    return await service.evidence(uow, principal.user_id, project_id, story_id, evidence_id)


# Visual assets persist independently from the versioned text form.


def image_service(characters: Service, generations: ImageGenerationDep) -> CharacterImagesService:
    return CharacterImagesService(characters, generations)


ImagesService = Annotated[CharacterImagesService, Depends(image_service)]


@router.get("/characters/{character_id}/images", response_model=CharacterImagesView)
async def character_images(
    project_id: UUID,
    story_id: UUID,
    character_id: UUID,
    uow: UowDep,
    principal: PrincipalDep,
    images: ImagesService,
):
    return await images.view(uow, principal.user_id, project_id, story_id, character_id)


@router.post("/characters/{character_id}/images", response_model=CharacterImagesView)
async def add_character_image(
    project_id: UUID,
    story_id: UUID,
    character_id: UUID,
    payload: AddCharacterImage,
    uow: UowDep,
    principal: MutationDep,
    images: ImagesService,
):
    return await images.add(
        uow, principal.user_id, project_id, story_id, character_id, payload.upload_id
    )


@router.put(
    "/characters/{character_id}/images/{image_id}/primary", response_model=CharacterImagesView
)
async def primary_character_image(
    project_id: UUID,
    story_id: UUID,
    character_id: UUID,
    image_id: UUID,
    uow: UowDep,
    principal: MutationDep,
    images: ImagesService,
):
    return await images.mutate(uow, principal.user_id, project_id, story_id, character_id, image_id)


@router.delete("/characters/{character_id}/images/{image_id}", response_model=CharacterImagesView)
async def delete_character_image(
    project_id: UUID,
    story_id: UUID,
    character_id: UUID,
    image_id: UUID,
    uow: UowDep,
    principal: MutationDep,
    images: ImagesService,
):
    return await images.mutate(
        uow, principal.user_id, project_id, story_id, character_id, image_id, delete=True
    )


@router.post(
    "/characters/{character_id}/image-generations",
    response_model=CharacterImagesView,
    status_code=202,
)
async def generate_character_image(
    project_id: UUID,
    story_id: UUID,
    character_id: UUID,
    payload: GenerateCharacterImage,
    uow: UowDep,
    principal: MutationDep,
    images: ImagesService,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    return await images.generate(
        uow, principal.user_id, project_id, story_id, character_id, payload, idempotency_key
    )
