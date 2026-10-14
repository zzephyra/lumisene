"""Platform settings. Only a platform administrator can change them."""

from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import PlatformAdminDep, PlatformAdminReadDep, UowDep, get_app_settings
from app.api.security import no_store
from app.core.config import Settings
from app.modules.settings.service import SettingsService

router = APIRouter(prefix="/api/v1/admin/system-settings", tags=["system-settings"])


class AssetSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    deletion_policy: Literal["retain_cloud_file", "delete_cloud_file"]


class SystemSettingsResponse(BaseModel):
    schema_version: int
    revision: int
    assets: AssetSettings


class SystemSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int = Field(ge=1)
    assets: AssetSettings


def _service(settings: Settings = Depends(get_app_settings)) -> SettingsService:
    return SettingsService(settings)


@router.get("", response_model=SystemSettingsResponse)
async def read_system_settings(
    response: Response,
    uow: UowDep,
    _: PlatformAdminReadDep,
    service: SettingsService = Depends(_service),
) -> dict:
    no_store(response)
    return await service.view(uow.session)


@router.patch("", response_model=SystemSettingsResponse)
async def update_system_settings(
    payload: SystemSettingsUpdate,
    response: Response,
    uow: UowDep,
    principal: PlatformAdminDep,
    service: SettingsService = Depends(_service),
) -> dict:
    no_store(response)
    return await service.update_deletion_policy(
        uow.session,
        policy=payload.assets.deletion_policy,
        revision=payload.revision,
        actor_id=principal.user_id,
    )
