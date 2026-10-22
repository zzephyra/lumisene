"""Read-only deletion port; imports no media Services."""
from sqlalchemy import func, select

from app.modules.story_assets.models import StoryAssetLink


async def story_asset_references(session, *, upload_id=None, asset_id=None):
    if upload_id is not None:
        field, value = StoryAssetLink.upload_id, upload_id
    elif asset_id is not None:
        field, value = StoryAssetLink.asset_id, asset_id
    else:
        return 0
    count = await session.scalar(
        select(func.count()).select_from(StoryAssetLink).where(field == value)
    )
    return int(count or 0)
