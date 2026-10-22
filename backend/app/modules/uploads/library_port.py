"""Only completed-upload metadata, joined by authorized business references."""
from sqlalchemy import select, literal, case, cast, String, Integer
from app.modules.uploads.models import UploadFile

def upload_media_rows():
    return select(UploadFile.id.label('id'),literal('upload').label('source'),UploadFile.original_filename.label('filename'),
        case((UploadFile.category=='file','document'),else_=UploadFile.category).label('kind'),UploadFile.content_type.label('mime'),
        UploadFile.size.label('size'),UploadFile.user_id.label('owner_id'),UploadFile.created_at.label('created_at'),
        cast(literal(None),Integer).label('width'),cast(literal(None),Integer).label('height'),cast(literal(None),Integer).label('duration_ms')
    ).where(UploadFile.status=='uploaded').subquery()
