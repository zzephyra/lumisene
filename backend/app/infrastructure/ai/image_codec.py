"""Validated image decoding shared by inputs and skill execution."""

from io import BytesIO

from PIL import Image, UnidentifiedImageError

from app.core.errors import ValidationError

MAX_BYTES = 80 * 1024 * 1024
MAX_PIXELS = 16_777_216


def decode_image(content: bytes) -> Image.Image:
    if not content or len(content) > MAX_BYTES:
        raise ValidationError("图片不得超过 80 MB")
    try:
        with Image.open(BytesIO(content)) as image:
            if (
                image.format not in {"PNG", "JPEG", "WEBP"}
                or image.width * image.height > MAX_PIXELS
            ):
                raise ValidationError("图片格式或像素尺寸不受支持")
            if image.width > 8000 or image.height > 8000 or getattr(image, "n_frames", 1) != 1:
                raise ValidationError("仅支持边长不超过 8000 的静态图片")
            image.load()
            return image.convert("RGBA")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ValidationError("图片文件无法解码") from exc


def png(image: Image.Image) -> bytes:
    stream = BytesIO()
    image.save(stream, format="PNG")
    data = stream.getvalue()
    if len(data) > MAX_BYTES:
        raise ValidationError("处理后的图片不得超过 80 MB，请缩小图片")
    return data
