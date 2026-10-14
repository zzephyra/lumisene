"""Wan 2.1 image editing. Persist submission IDs before independent polling."""

import base64
import re

from app.core.errors import ProviderError, ValidationError
from app.core.errors import TimeoutError as ProviderTimeout
from app.infrastructure.ai.adapters.dashscope_video import _origin, _output
from app.infrastructure.ai.adapters.outpainting import SIDES, NativeOutpainting
from app.infrastructure.ai.image_codec import decode_image

MODEL = "wanx2.1-imageedit"
FUNCTIONS = {
    "image_outpaint": "expand",
    "image_inpaint": "description_edit_with_mask",
    "image_to_image": "description_edit",
}


def expansion_parameters(value: object, width: int, height: int) -> dict:
    if not isinstance(value, dict) or set(value) - {
        *(f"{s}_offset" for s in SIDES),
        "best_quality",
        "limit_image_size",
    }:
        raise ValidationError("扩图参数无效")
    result = {}
    for side in SIDES:
        offset = value.get(f"{side}_offset")
        dimension = width if side in {"left", "right"} else height
        if type(offset) is not int or not 0 <= offset <= dimension:
            raise ValidationError("每侧扩展范围为原图对应宽或高的 0–100%")
        result[f"{side}_scale"] = 1 + offset / dimension
    if all(v == 1 for v in result.values()):
        raise ValidationError("请至少扩展一个方向")
    return result


class WanImageEditing(NativeOutpainting):
    result_list = True

    async def submit(
        self,
        *,
        base_url: str,
        api_key: str,
        image: bytes,
        parameters: dict,
        operation: str = "image_outpaint",
        prompt: str = "自然延展图像，保持原图风格和内容连续",
        mask: bytes | None = None,
    ) -> str:
        source = decode_image(image)
        if (
            not (512 <= source.width <= 4096 and 512 <= source.height <= 4096)
            or len(image) > 10 * 1024 * 1024
        ):
            raise ValidationError("图像编辑原图宽高须为 512–4096 像素，文件不超过 10 MB")
        if operation not in FUNCTIONS or not prompt.strip() or len(prompt) > 800:
            raise ValidationError("图像编辑描述须为 1–800 字符，且操作须受支持")
        data = {
            "function": FUNCTIONS[operation],
            "prompt": prompt,
            "base_image_url": "data:image/png;base64," + base64.b64encode(image).decode(),
        }
        options = {"n": 1}
        if operation == "image_outpaint":
            options.update(expansion_parameters(parameters, source.width, source.height))
        elif operation == "image_inpaint":
            if (
                mask is None
                or decode_image(mask).size != source.size
                or len(mask) > 10 * 1024 * 1024
            ):
                raise ValidationError("局部重绘需要与原图同尺寸的蒙版")
            data["mask_image_url"] = "data:image/png;base64," + base64.b64encode(mask).decode()
        elif mask is not None:
            raise ValidationError("指令编辑不接受蒙版")
        status, body = await self.transport._request(
            _origin(base_url) + "/api/v1/services/aigc/image2image/image-synthesis",
            api_key,
            {"model": MODEL, "input": data, "parameters": options},
            {"X-DashScope-Async": "enable"},
        )
        output = _output(body)
        if (
            not 200 <= status < 300
            or output.get("task_status") == "FAILED"
            or (isinstance(body, dict) and body.get("code"))
        ):
            raise ProviderError("万相图像编辑请求被拒绝，请检查模型权限、原图与参数")
        task_id = output.get("task_id")
        if not isinstance(task_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,256}", task_id):
            raise ProviderTimeout("图像编辑提交结果不明，请管理员核对；不会自动重复提交")
        return task_id
