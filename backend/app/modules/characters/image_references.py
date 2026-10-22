"""Read-only reference port for asset deletion; does not import generation services."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.characters.models import CharacterImage


async def character_image_references(
    session: AsyncSession, project_id: UUID, asset_id: UUID
) -> int:
    return int(
        await session.scalar(
            select(func.count())
            .select_from(CharacterImage)
            .where(CharacterImage.project_id == project_id, CharacterImage.asset_id == asset_id)
        )
        or 0
    )

async def character_upload_references(session: AsyncSession, upload_id: UUID) -> int:
    return int(await session.scalar(select(func.count()).select_from(CharacterImage).where(CharacterImage.upload_id == upload_id)) or 0)
