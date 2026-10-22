from sqlalchemy import select,func
from app.modules.stories.models import Story
async def story_cover_references(session, upload_id):
    return int(await session.scalar(select(func.count()).select_from(Story).where(Story.cover_upload_id==upload_id)) or 0)
