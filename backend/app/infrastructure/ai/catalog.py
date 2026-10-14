"""Model catalog and its audit trail.

This service records which models the server may use. It does not call providers.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.logging import get_logger
from app.infrastructure.ai.domain import (
    MAX_MODEL_CONFIGS,
    MEDIA_ASSIGNMENTS,
    QWEN_REFERENCE_EDIT_MODELS,
    SECRET_REF_PATTERN,
    AuditAction,
    ModelCapability,
    assignment_capability,
    clean_model_name,
    clean_provider,
    configurable_capability,
    json_object,
)
from app.infrastructure.ai.models import ModelAssignment, ModelConfig, ModelConfigAudit
from app.infrastructure.ai.repository import ModelConfigRepository
from app.infrastructure.ai.schemas import AdminModelConfig, ModelAssignmentItem, PublicModelConfig
from app.infrastructure.db.session import UnitOfWork

logger = get_logger(__name__)


class ModelCatalog:
    def __init__(
        self,
        settings: Settings,
        repository: ModelConfigRepository | None = None,
    ) -> None:
        self.settings = settings
        self.repository = repository or ModelConfigRepository()

    async def list_enabled(
        self,
        uow: UnitOfWork,
        capability: str | None,
    ) -> list[PublicModelConfig]:
        selected = assignment_capability(capability) if capability is not None else None
        rows = await self.repository.list_configs(
            uow.session,
            enabled_only=True,
            capability=selected,
        )
        return [_public(row) for row in rows]

    async def active_model(self, uow: UnitOfWork, capability: str) -> PublicModelConfig:
        selected = assignment_capability(capability)
        config = await self.repository.assigned_config(uow.session, selected)
        if config is None:
            raise NotFoundError("No model is assigned for this capability")
        return _public(config)

    async def list_for_admin(self, uow: UnitOfWork) -> list[AdminModelConfig]:
        rows = await self.repository.list_configs(
            uow.session,
            enabled_only=False,
            capability=None,
        )
        return [_admin(row) for row in rows]

    async def create(
        self,
        uow: UnitOfWork,
        *,
        actor_id: UUID,
        provider: str,
        model_name: str,
        capability: str,
        parameters_schema: dict[str, Any],
        limits: dict[str, Any],
        secret_ref: str,
    ) -> AdminModelConfig:
        cleaned_provider = clean_provider(provider)
        cleaned_name = clean_model_name(model_name)
        if (
            cleaned_name in {"image-out-painting", "wanx2.1-imageedit"}
            and capability != "image_inpaint"
        ):
            raise ValidationError("image-out-painting 只能登记为专用图像编辑模型")
        cleaned_capability = (
            "image_inpaint"
            if cleaned_name in {"image-out-painting", "wanx2.1-imageedit"}
            and capability == "image_inpaint"
            else configurable_capability(capability)
        )
        schema = json_object(parameters_schema, label="Parameters schema")
        cleaned_limits = json_object(limits, label="Limits")
        cleaned_secret = _allowed_secret_ref(secret_ref, self.settings)
        schema = _catalog_parameters(
            self.settings,
            provider=cleaned_provider,
            model_name=cleaned_name,
            capability=cleaned_capability,
            secret_ref=cleaned_secret,
            parameters=schema,
        )
        if await self.repository.count_configs(uow.session) >= MAX_MODEL_CONFIGS:
            raise ValidationError("Model catalog is full")
        version = await self.repository.next_version(
            uow.session,
            provider=cleaned_provider,
            model_name=cleaned_name,
            capability=cleaned_capability,
        )
        config = ModelConfig(
            id=uuid4(),
            provider=cleaned_provider,
            model_name=cleaned_name,
            capability=cleaned_capability,
            config_version=version,
            parameters_schema=schema,
            limits=cleaned_limits,
            secret_ref=cleaned_secret,
            enabled=True,
        )
        await self.repository.add_config(uow.session, config)
        await self.repository.add_audit(
            uow.session,
            _audit(actor_id, config, AuditAction.CREATED),
        )
        try:
            await uow.session.flush()
            await uow.commit()
        except IntegrityError as exc:
            await uow.rollback()
            raise ConflictError("Model config version already exists") from exc
        logger.info(
            "model_config_created",
            actor_id=str(actor_id),
            model_config_id=str(config.id),
            config_version=config.config_version,
        )
        return _admin(config)

    async def disable(
        self,
        uow: UnitOfWork,
        *,
        actor_id: UUID,
        config_id: UUID,
        enabled: bool,
    ) -> AdminModelConfig:
        config = await self.repository.get_config(uow.session, config_id)
        if config is None:
            raise NotFoundError("Model config was not found")
        if config.enabled == enabled:
            return _admin(config)
        config.enabled = enabled
        config.updated_at = datetime.now(UTC)
        await self.repository.add_audit(
            uow.session,
            _audit(
                actor_id,
                config,
                AuditAction.ENABLED if enabled else AuditAction.DISABLED,
            ),
        )
        if not enabled:
            await self._release_assignment(uow, actor_id, config)
        await uow.session.flush()
        await uow.commit()
        logger.info(
            "model_config_enabled" if enabled else "model_config_disabled",
            actor_id=str(actor_id),
            model_config_id=str(config.id),
            config_version=config.config_version,
        )
        return _admin(config)

    async def list_assignments(self, uow: UnitOfWork) -> list[ModelAssignmentItem]:
        rows = await self.repository.list_assignments(uow.session)
        bound = {assignment.capability: (assignment, config) for assignment, config in rows}
        return [
            _assignment_item(capability.value, bound.get(capability.value))
            for capability in ModelCapability
            if capability.value not in MEDIA_ASSIGNMENTS
        ]

    async def assign(
        self,
        uow: UnitOfWork,
        *,
        actor_id: UUID,
        capability: str,
        model_config_id: UUID,
    ) -> ModelAssignmentItem:
        selected = configurable_capability(capability)
        config = await self.repository.get_config(uow.session, model_config_id)
        if config is None or not config.enabled:
            raise NotFoundError("Model config was not found")
        if config.capability != selected:
            raise ValidationError("Model capability does not match")
        current = await self.repository.get_assignment(uow.session, selected)
        if current is not None and current.model_config_id == config.id:
            return _assignment_item(selected, (current, config))
        if current is not None:
            previous = await self.repository.get_config(uow.session, current.model_config_id)
            if previous is not None:
                await self.repository.add_audit(
                    uow.session,
                    _audit(actor_id, previous, AuditAction.UNASSIGNED),
                )
        if current is None:
            row = ModelAssignment(
                capability=selected,
                model_config_id=config.id,
                config_version=config.config_version,
                updated_by=actor_id,
                updated_at=datetime.now(UTC),
            )
            uow.session.add(row)
        else:
            current.model_config_id = config.id
            current.config_version = config.config_version
            current.updated_by = actor_id
            current.updated_at = datetime.now(UTC)
            row = current
        await self.repository.add_audit(
            uow.session,
            _audit(actor_id, config, AuditAction.ASSIGNED),
        )
        await uow.session.flush()
        await uow.commit()
        logger.info(
            "model_assigned",
            actor_id=str(actor_id),
            capability=selected,
            model_config_id=str(config.id),
        )
        return _assignment_item(selected, (row, config))

    async def clear(
        self,
        uow: UnitOfWork,
        *,
        actor_id: UUID,
        capability: str,
    ) -> None:
        selected = configurable_capability(capability)
        current = await self.repository.get_assignment(uow.session, selected)
        if current is None:
            return
        config = await self.repository.get_config(uow.session, current.model_config_id)
        await self.repository.delete_assignment(uow.session, selected)
        if config is not None:
            await self.repository.add_audit(
                uow.session,
                _audit(actor_id, config, AuditAction.UNASSIGNED),
            )
        await uow.session.flush()
        await uow.commit()

    async def _release_assignment(
        self,
        uow: UnitOfWork,
        actor_id: UUID,
        config: ModelConfig,
    ) -> None:
        current = await self.repository.assignment_for_config(uow.session, config.id)
        if current is None:
            return
        await self.repository.delete_assignment(uow.session, current.capability)
        await self.repository.add_audit(
            uow.session,
            _audit(actor_id, config, AuditAction.UNASSIGNED),
        )

    def provider_catalog(self) -> list[dict[str, Any]]:
        return self.settings.provider_catalog()


async def require_assigned(session: AsyncSession, capability: str) -> ModelConfig:
    config = await ModelConfigRepository().assigned_config(
        session, assignment_capability(capability)
    )
    if config is None:
        raise ValidationError("No model is assigned for this capability")
    return config


def _assignment_item(
    capability: str,
    bound: tuple[ModelAssignment, ModelConfig] | None,
) -> ModelAssignmentItem:
    if bound is None:
        return ModelAssignmentItem(capability=capability)
    _row, config = bound
    return ModelAssignmentItem(
        capability=capability,
        model_config_id=config.id,
        provider=config.provider,
        model_name=config.model_name,
        config_version=config.config_version,
    )


def _catalog_parameters(
    settings: Settings,
    *,
    provider: str,
    model_name: str,
    capability: str,
    secret_ref: str,
    parameters: dict[str, Any],
) -> dict[str, Any]:
    declared = settings.endpoint_models(secret_ref)
    if declared is None:
        return parameters
    if provider != secret_ref:
        raise ValidationError("Provider must match the configured endpoint")
    chosen = declared.get(model_name)
    if chosen is None:
        raise ValidationError("Model is not listed for this provider")
    if capability not in chosen.capabilities:
        raise ValidationError("Capability is not supported by this model")
    if parameters != chosen.parameters:
        raise ValidationError("Parameters do not match the provider catalog")
    return chosen.parameters


def _allowed_secret_ref(value: str, settings: Settings) -> str:
    name = value.strip()
    allowed = settings.configured_secret_refs()
    if not SECRET_REF_PATTERN.fullmatch(name) or name not in allowed:
        raise ValidationError("Secret reference is not configured")
    return name


def _audit(actor_id: UUID, config: ModelConfig, action: AuditAction) -> ModelConfigAudit:
    return ModelConfigAudit(
        id=uuid4(),
        actor_id=actor_id,
        model_config_id=config.id,
        config_version=config.config_version,
        action=action.value,
    )


def _public(row: ModelConfig) -> PublicModelConfig:
    return PublicModelConfig(
        id=row.id,
        provider=row.provider,
        model_name=row.model_name,
        capability=row.capability,
        config_version=row.config_version,
        parameters_schema=dict(row.parameters_schema),
        limits=dict(row.limits),
    )


def _admin(row: ModelConfig) -> AdminModelConfig:
    return AdminModelConfig(
        id=row.id,
        provider=row.provider,
        model_name=row.model_name,
        capability=row.capability,
        config_version=row.config_version,
        parameters_schema=dict(row.parameters_schema),
        limits=dict(row.limits),
        secret_ref=row.secret_ref,
        enabled=row.enabled,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


INPAINT_MODELS = (
    frozenset(
        {
            "gpt-image-1",
            "gpt-image-1-mini",
            "gpt-image-1.5",
        }
    )
    | QWEN_REFERENCE_EDIT_MODELS
)
VIDEO_RESOLUTIONS = {
    "wan2.2-i2v-flash": ["480P", "720P"],
    "wan2.2-i2v-plus": ["480P", "1080P"],
    "wan2.1-i2v-turbo": ["480P", "720P"],
    "wan2.1-i2v-plus": ["720P"],
    "wan2.5-i2v-preview": ["480P", "720P", "1080P"],
    "wan2.6-i2v": ["720P", "1080P"],
    "wan2.6-i2v-flash": ["720P", "1080P"],
}


def video_reference_resolutions(config: ModelConfig, settings: Settings) -> list[str]:
    """Resolve first-frame support for the assigned model, never another model."""
    declared = (settings.endpoint_models(config.secret_ref) or {}).get(config.model_name)
    known = VIDEO_RESOLUTIONS.get(config.model_name)
    if known is None and not (
        declared and "text_to_video" in declared.capabilities and "image" in declared.inputs
    ):
        return []
    # The registered version is the runtime contract; YAML only declares input support.
    choices = config.parameters_schema.get("resolutions", known or [])
    if not isinstance(choices, list):
        return []
    allowed = known or ["480P", "720P", "1080P"]
    return [item for item in choices if isinstance(item, str) and item in allowed]


async def require_editor_model(uow: UnitOfWork, settings: Settings, capability: str) -> ModelConfig:
    if capability in {"image_inpaint", "image_to_image"}:
        return await require_outpaint_model(uow, settings)
    config = await require_assigned(uow.session, capability)
    if settings.model_endpoint(config.secret_ref) is None:
        raise ValidationError("该模型的服务端凭据尚未配置")
    supported = (
        config.model_name in INPAINT_MODELS
        if capability in {"image_inpaint", "image_to_image"}
        else bool(video_reference_resolutions(config, settings))
    )
    if not supported:
        raise ValidationError("统一生成模型暂不支持此操作，请管理员检查图片或视频生成模型")
    return config


async def require_outpaint_model(uow: UnitOfWork, settings: Settings) -> ModelConfig:
    """Explicit native tool exception; never silently use the assigned image model."""
    configs = await ModelConfigRepository().list_configs(
        uow.session, enabled_only=True, capability="image_inpaint"
    )
    matches = [row for row in configs if row.model_name == "wanx2.1-imageedit"]
    providers = {(row.provider, row.secret_ref) for row in matches}
    if len(providers) != 1:
        raise ValidationError("请管理员登记并启用唯一供应商的 wanx2.1-imageedit 图像编辑模型")
    config = max(matches, key=lambda row: row.config_version)
    if settings.model_endpoint(config.secret_ref) is None:
        raise ValidationError("扩图模型的服务端凭据尚未配置")
    return config
