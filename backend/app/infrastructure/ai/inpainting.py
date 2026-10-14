"""Local inpainting selection compositing; unrelated to native outpainting."""

from PIL import Image, ImageChops, ImageFilter

from app.core.errors import ValidationError
from app.infrastructure.ai.adapters.openai_images import context_box
from app.infrastructure.ai.image_codec import decode_image, png


def composite_edits(
    original: bytes, mask: bytes, images: list[tuple[bytes, str]]
) -> list[tuple[bytes, str]]:
    source = decode_image(original)
    binary = decode_image(mask).convert("L").point(lambda value: 255 if value >= 128 else 0)
    bounds = binary.getbbox()
    if bounds is None:
        raise ValidationError("请先框选需要修改的区域")
    box = context_box(source.width, source.height, bounds)
    feather = _inward_mask(binary, bounds)
    crop = (box[2] - box[0], box[3] - box[1])
    results = []
    for content, _mime in images:
        edited = decode_image(content).convert("RGBA")
        edited = edited.resize(crop, Image.Resampling.LANCZOS)
        canvas = source.copy()
        canvas.paste(edited, (box[0], box[1]))
        composed = Image.composite(canvas, source, feather)
        if composed.tobytes() == source.tobytes():
            raise ValidationError("模型返回的选区内容没有变化，请补充更具体的修改描述后重新生成")
        results.append((png(composed), "image/png"))
    return results


def _inward_mask(
    binary: Image.Image, bounds: tuple[int, int, int, int], blend_size: int | None = None
) -> Image.Image:
    span = min(bounds[2] - bounds[0], bounds[3] - bounds[1])
    radius = blend_size if blend_size is not None else min(6, max(1, span // 8))
    blurred = binary.filter(ImageFilter.GaussianBlur(radius))
    return ImageChops.multiply(blurred, binary)
