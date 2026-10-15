from uuid import UUID

from fastapi import APIRouter, Query, Response

from app.api.deps import MutationDep, PrincipalDep, ProjectServiceDep, UowDep
from app.api.security import no_store
from app.modules.chat.schemas import (
    ConversationResponse,
    CreateConversation,
    SendTurn,
    TurnResponse,
)
from app.modules.chat.service import ChatService

router = APIRouter(prefix="/api/v1/projects/{project_id}/conversations", tags=["chat"])


@router.get("", response_model=list[ConversationResponse])
async def list_conversations(
    project_id: UUID,
    uow: UowDep,
    principal: PrincipalDep,
    projects: ProjectServiceDep,
    response: Response,
    offset: int = Query(0, ge=0),
):
    no_store(response)
    return await ChatService(projects.auth_service.settings, projects).conversations(
        uow, project_id, principal.user_id, offset
    )


@router.post("", response_model=ConversationResponse, status_code=201)
async def create_conversation(
    project_id: UUID,
    payload: CreateConversation,
    uow: UowDep,
    principal: MutationDep,
    projects: ProjectServiceDep,
    response: Response,
):
    no_store(response)
    return await ChatService(projects.auth_service.settings, projects).create(
        uow, project_id, principal.user_id, payload.id, payload.title
    )


@router.get("/{conversation_id}/turns", response_model=list[TurnResponse])
async def list_turns(
    project_id: UUID,
    conversation_id: UUID,
    uow: UowDep,
    principal: PrincipalDep,
    projects: ProjectServiceDep,
    response: Response,
    offset: int = Query(0, ge=0),
):
    no_store(response)
    return await ChatService(projects.auth_service.settings, projects).turns(
        uow, project_id, conversation_id, principal.user_id, offset
    )


@router.post("/{conversation_id}/turns", response_model=TurnResponse, status_code=202)
async def submit_turn(
    project_id: UUID,
    conversation_id: UUID,
    payload: SendTurn,
    uow: UowDep,
    principal: MutationDep,
    projects: ProjectServiceDep,
    response: Response,
):
    no_store(response)
    return await ChatService(projects.auth_service.settings, projects).submit(
        uow, project_id, conversation_id, principal.user_id, payload.request_id, payload.prompt
    )


@router.post("/{conversation_id}/turns/{turn_id}/image", response_model=TurnResponse)
async def generate_image(
    project_id: UUID,
    conversation_id: UUID,
    turn_id: UUID,
    uow: UowDep,
    principal: MutationDep,
    projects: ProjectServiceDep,
    response: Response,
):
    no_store(response)
    return await ChatService(projects.auth_service.settings, projects).generate_image(
        uow, project_id, conversation_id, turn_id, principal.user_id
    )
