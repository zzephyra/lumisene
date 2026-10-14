"""Native image-out-painting: one submission, independently resumable queries.

No prompt, mask, reference-image editing or local compositing is involved.
"""

import base64
import re

from app.core.errors import ProviderError, ValidationError
from app.core.errors import TimeoutError as ProviderTimeout
from app.infrastructure.ai.adapters.dashscope_video import DashScopeVideo, _origin, _output
from app.infrastructure.ai.adapters.openai_images import OpenAICompatibleImages
from app.infrastructure.ai.image_codec import decode_image

MODEL = "image-out-painting"
SIDES = ("left", "right", "top", "bottom")


def validate_parameters(value: object, width: int, height: int) -> dict:
    if not isinstance(value, dict) or set(value) != {
        "left_offset",
        "right_offset",
        "top_offset",
        "bottom_offset",
        "best_quality",
    }:
        raise ValidationError("扩图参数已更新，请刷新页面后重新设置扩图范围")
    offsets = [value[f"{side}_offset"] for side in SIDES]
    if any(type(n) is not int or n < 0 for n in offsets) or not any(offsets):
        raise ValidationError("请设置非负整数扩图像素，至少一个方向大于零")
    if type(value["best_quality"]) is not bool:
        raise ValidationError("最佳质量参数必须为布尔值")
    if not (512 <= width <= 4096 and 512 <= height <= 4096):
        raise ValidationError("扩图原图的宽和高都须在 512–4096 像素之间")
    left, right, top, bottom = offsets
    if left + right >= 3 * width or top + bottom >= 3 * height:
        raise ValidationError("横向或纵向新增像素须小于原图对应尺寸的 3 倍")
    w, h = width + left + right, height + top + bottom
    if not 0.25 <= w / h <= 4 or w > 8000 or h > 8000 or w * h > 16_777_216:
        raise ValidationError("扩图画布须在 1:4–4:1 之间，单边不超过 8000 且总像素不超过 1600 万")
    return dict(value, limit_image_size=True)


class NativeOutpainting:
    result_list = False

    def __init__(self, transport=None, images=None):
        # Reuse the authenticated DashScope HTTP transport and checked image download.
        self.transport = transport or DashScopeVideo()
        self.images = images or OpenAICompatibleImages()

    async def submit(self, *, base_url: str, api_key: str, image: bytes, parameters: dict) -> str:
        source = decode_image(image)
        checked = validate_parameters(
            {k: v for k, v in parameters.items() if k != "limit_image_size"},
            source.width,
            source.height,
        )
        if len(image) > 10 * 1024 * 1024:
            raise ValidationError("扩图原图不能超过 10 MB")
        payload = {
            "model": MODEL,
            "input": {"image_url": "data:image/png;base64," + base64.b64encode(image).decode()},
            "parameters": checked,
        }
        status, body = await self.transport._request(
            _origin(base_url) + "/api/v1/services/aigc/image2image/out-painting",
            api_key,
            payload,
            {"X-DashScope-Async": "enable"},
        )
        output = _output(body)
        if (
            not 200 <= status < 300
            or output.get("task_status") == "FAILED"
            or (isinstance(body, dict) and body.get("code"))
        ):
            raise ProviderError("扩图服务拒绝请求，请检查 image-out-painting 的权限、原图和参数")
        task_id = output.get("task_id")
        if not isinstance(task_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,256}", task_id):
            raise ProviderTimeout("扩图提交结果不明，请管理员核对；系统不会自动重复提交")
        return task_id

    async def poll(self, *, base_url: str, api_key: str, task_id: str):
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,256}", task_id):
            raise ProviderError("扩图远端任务标识无效")
        status, body = await self.transport._request(
            _origin(base_url) + "/api/v1/tasks/" + task_id,
            api_key,
            None,
            {},
        )
        if not 200 <= status < 300:
            raise ProviderError("扩图状态暂时无法查询")
        output = _output(body)
        state = output.get("task_status")
        if state in {"PENDING", "RUNNING"}:
            return "pending", None
        if state in {"FAILED", "CANCELED"}:
            return "failed", None
        if state == "SUCCEEDED":
            url = output.get("output_image_url")
            if self.result_list:
                results = output.get("results")
                url = (
                    results[0].get("url")
                    if isinstance(results, list) and results and isinstance(results[0], dict)
                    else None
                )
            if not isinstance(url, str) or not url:
                raise ProviderError("扩图服务未返回结果地址")
            result = await self.images._download(url)
            decode_image(
                result[0]
            )  # Validate actual bytes before storing; do not paste the source.
            return "succeeded", result
        raise ProviderError("扩图远端任务不存在或状态未知，请管理员核对")
