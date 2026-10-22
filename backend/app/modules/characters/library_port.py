"""Character-owned media projections; primary status never duplicated in a library."""
from sqlalchemy import select, case, literal, cast, String
from app.modules.characters.models import Character, CharacterImage

def character_library_rows(project,story):
    return select(
        case((CharacterImage.upload_id.is_not(None),'upload'),else_='generated').label('source'),
        case((CharacterImage.upload_id.is_not(None),CharacterImage.upload_id),else_=CharacterImage.asset_id).label('media_id'),
        Character.name.label('display_name'),literal('character').label('category'),
        Character.id.label('target_id'),Character.name.label('target_name'),
        CharacterImage.is_primary.label('primary'),CharacterImage.created_at.label('added_at'),
    ).join(Character,Character.id==CharacterImage.character_id).where(Character.project_id==project,Character.story_id==story).subquery()
