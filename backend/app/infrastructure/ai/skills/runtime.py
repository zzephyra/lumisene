"""Submission-time configuration snapshot, inside the caller's existing transaction."""

import hashlib

from sqlalchemy import select

from app.infrastructure.db.session import UnitOfWork

from .base import ModelInfo, SkillSnapshot
from .catalogue import Skill
from .errors import SkillDisabledError
from .registry import SkillRegistry


async def snapshot_skill(
    uow: UnitOfWork, registry: SkillRegistry, key: str, model: ModelInfo
) -> SkillSnapshot:
    snapshot = registry.snapshot(key, model)
    row = await uow.session.scalar(
        select(Skill).where(Skill.runtime_key == key, Skill.deleted_at.is_(None))
    )
    if row is not None:
        if not row.enabled:
            raise SkillDisabledError("关联的技能已停用，请管理员激活后重试")
        snapshot = snapshot.model_copy(
            update={
                "supplement": row.content,
                "catalogue_id": str(row.id),
                "prompt_version": hashlib.sha256(
                    (snapshot.prompt_version + "\n" + row.content).encode()
                ).hexdigest(),
                "catalogue_version": row.version,
            }
        )
    return snapshot
