"""Read and update platform settings. Callers that delete files read PostgreSQL directly."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ValidationError, VersionConflictError
from app.infrastructure.cache.redis_client import SettingsCache
from app.modules.settings.defaults import DELETION_POLICIES, load_defaults, missing_setting_keys
from app.modules.settings.models import (
    SystemSetting,
    SystemSettingAudit,
    SystemSettingInitialization,
    SystemSettingPublication,
)


class SettingsService:
    def __init__(self, settings: Settings, cache: SettingsCache | None = None) -> None:
        self._settings = settings
        self._cache = cache if cache is not None else SettingsCache(settings.redis_url)

    async def initialize(self, session: AsyncSession) -> None:
        document = load_defaults(self._settings)
        rows = (await session.execute(select(SystemSetting))).scalars().all()
        existing = {(row.namespace, row.key) for row in rows}
        missing = missing_setting_keys(existing, document)
        await session.execute(
            insert(SystemSettingInitialization)
            .values(schema_version=document.schema_version)
            .on_conflict_do_nothing(index_elements=["schema_version"])
        )
        now = datetime.now(UTC)
        for namespace, key, value in missing:
            await session.execute(
                insert(SystemSetting)
                .values(
                    namespace=namespace,
                    key=key,
                    value=value,
                    schema_version=document.schema_version,
                    revision=1,
                    updated_at=now,
                )
                .on_conflict_do_nothing(index_elements=["namespace", "key"])
            )
        await session.commit()

    async def deletion_policy(self, session: AsyncSession) -> tuple[str, int]:
        row = await self._row(session)
        policy = row.value.get("policy")
        if policy not in DELETION_POLICIES:
            raise ValidationError("作品删除策略尚未正确初始化")
        return str(policy), row.revision

    async def view(self, session: AsyncSession) -> dict:
        row = await self._row(session)
        return _document(row)

    async def update_deletion_policy(
        self,
        session: AsyncSession,
        *,
        policy: str,
        revision: int,
        actor_id: UUID,
    ) -> dict:
        if policy not in DELETION_POLICIES:
            raise ValidationError("删除策略无效")
        row = (
            await session.execute(
                select(SystemSetting)
                .where(SystemSetting.namespace == "assets", SystemSetting.key == "deletion_policy")
                .with_for_update()
            )
        ).scalar_one_or_none()
        if row is None:
            raise ValidationError("作品删除策略尚未正确初始化")
        if row.revision != revision:
            raise VersionConflictError("设置已被其他管理员更新，请刷新后重试")
        previous = dict(row.value)
        current = {"policy": policy}
        row.value = current
        row.revision = revision + 1
        row.updated_by = actor_id
        row.updated_at = datetime.now(UTC)
        session.add(
            SystemSettingAudit(
                namespace="assets",
                key="deletion_policy",
                previous_value=previous,
                current_value=current,
                revision=row.revision,
                actor_id=actor_id,
            )
        )
        session.add(SystemSettingPublication(revision=row.revision, status="pending"))
        await session.commit()
        await self.publish_pending(session)
        return _document(row)

    async def publish_pending(self, session: AsyncSession) -> None:
        pending = (
            await session.execute(
                select(SystemSettingPublication)
                .where(SystemSettingPublication.status == "pending")
                .order_by(SystemSettingPublication.revision)
            )
        ).scalars().all()
        if not pending:
            return
        rows = (await session.execute(select(SystemSetting))).scalars().all()
        if not rows:
            return
        revision = max(row.revision for row in rows)
        document = {
            "revision": revision,
            "values": {f"{row.namespace}.{row.key}": row.value for row in rows},
        }
        if not await self._cache.publish(document):
            return
        for item in pending:
            if item.revision <= revision:
                item.status = "published"
        await session.commit()

    async def _row(self, session: AsyncSession) -> SystemSetting:
        row = await session.get(SystemSetting, {"namespace": "assets", "key": "deletion_policy"})
        if row is None:
            raise ValidationError("作品删除策略尚未正确初始化")
        return row


def _document(row: SystemSetting) -> dict:
    policy = row.value.get("policy")
    return {
        "schema_version": row.schema_version,
        "revision": row.revision,
        "assets": {"deletion_policy": policy if isinstance(policy, str) else ""},
    }
