from sqlalchemy import select
from app.modules.storyline.models import Scene

def scene_library_targets(project,story):
    return select(Scene.id,Scene.title).where(Scene.project_id==project,Scene.story_id==story).subquery()
