"""Bounded signature checks and derived thumbnails. No arbitrary URL input."""
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.errors import ValidationError

FORMATS={
 'image':['image/jpeg','image/png','image/webp','image/gif'],
 'video':['video/mp4','video/webm','video/quicktime'],
 'document':['application/pdf','text/plain','text/markdown'],
}

def validate_signature(mime: str, content: bytes) -> None:
    checks={
      'image/jpeg':content.startswith(b'\xff\xd8\xff'),
      'image/png':content.startswith(b'\x89PNG\r\n\x1a\n'),
      'image/gif':content.startswith((b'GIF87a',b'GIF89a')),
      'image/webp':content.startswith(b'RIFF') and content[8:12]==b'WEBP',
      'application/pdf':content.startswith(b'%PDF-'),
      'video/webm':content.startswith(b'\x1aE\xdf\xa3'),
      'video/mp4':content[4:8] in (b'ftyp',b'moov',b'mdat',b'wide'),
      'video/quicktime':content[4:8] in (b'ftyp',b'moov',b'mdat',b'wide'),
    }
    if mime in ('text/plain','text/markdown'):
        try:
            content.decode('utf-8-sig')
        except UnicodeDecodeError as exc:
            if exc.end != len(content):
                raise ValidationError('文档需要 UTF-8 编码') from exc
        valid=bool(content) and b'\x00' not in content
    else:
        valid=checks.get(mime,False)
    if not valid:
        raise ValidationError('文件真实类型与声明格式不一致或格式不支持')

def thumbnail(content: bytes) -> bytes:
    try:
        with Image.open(BytesIO(content)) as image:
            if image.width*image.height > 40_000_000:
                raise ValidationError('图片分辨率超过缩略图处理限制')
            image=ImageOps.exif_transpose(image)
            image.thumbnail((480,360))
            output=BytesIO()
            image.convert('RGB').save(output,'JPEG',quality=80)
            return output.getvalue()
    except (UnidentifiedImageError,OSError,Image.DecompressionBombError) as exc:
        raise ValidationError('无法生成图片缩略图') from exc
