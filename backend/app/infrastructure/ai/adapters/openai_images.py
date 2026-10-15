"""OpenAI-compatible image generation.

The API key is sent only as a request header and is never copied into errors or logs.
"""

import asyncio
import base64
import json
import math
import urllib.error
import urllib.request
from collections.abc import Callable
from io import BytesIO
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

from app.core.errors import ProviderError, RateLimitError
from app.core.errors import TimeoutError as ProviderTimeout
from app.infrastructure.ai.domain import (
    IMAGE_BYTES_MAX,
    QWEN_NATIVE_EDIT_MODELS,
    QWEN_REFERENCE_EDIT_MODELS,
)
from PIL import Image, ImageChops, ImageFilter, ImageOps

Post = Callable[[str, str, dict[str, Any], float], tuple[int, object]]
Fetch = Callable[[str, float], tuple[bytes, str]]
_TIMEOUT_SECONDS = 120.0


class _RejectRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise _TransportFailure("network")


class _TransportFailure(Exception):
    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind


def context_box(
    width: int, height: int, bounds: tuple[int, int, int, int]
) -> tuple[int, int, int, int]:
    """Selection plus context, clamped to the image and kept within 1:8–8:1 when possible."""
    x0, y0, x1, y1 = bounds
    span = max(1, x1 - x0, y1 - y0)
    pad = max(32, round(span * 0.5))
    left = max(0, x0 - pad)
    top = max(0, y0 - pad)
    right = min(width, x1 + pad)
    bottom = min(height, y1 + pad)
    crop_w = max(1, right - left)
    crop_h = max(1, bottom - top)
    if crop_w / crop_h > 8:
        needed = min(height, math.ceil(crop_w / 8))
        extra = max(0, needed - crop_h)
        top = max(0, top - extra // 2)
        bottom = min(height, top + needed)
        top = max(0, bottom - needed)
    elif crop_h / crop_w > 8:
        needed = min(width, math.ceil(crop_h / 8))
        extra = max(0, needed - crop_w)
        left = max(0, left - extra // 2)
        right = min(width, left + needed)
        left = max(0, right - needed)
    return left, top, right, bottom


def edit_instructions(prompt: str, *, referenced: bool, full_context: bool = False) -> str:
    text = (
        "根据用户要求修改指定区域。保持原图的视觉风格、拍摄视角、透视关系、光源方向、色温、曝光、景深、材质和纹理尺度。"
        "修改内容应与周围环境自然衔接。除指定区域外，不添加、删除或移动其他主体，不改变整体构图。"
        "不要输出选区边框、蒙版标记、文字、水印或拼图。"
    )
    if any(word in prompt for word in ("移除", "去掉", "删除", "消除")):
        text += "根据周围可见场景合理补全被遮挡背景，避免残留轮廓、重复纹理、模糊补丁和明显接缝。"
    if referenced:
        text += (
            "第一张是原图，第二张是选区参考：白色区域需要修改，灰色区域是允许柔和重绘的过渡带，黑色区域保持原样。"
            "第三张是在原图上标出的编辑范围，红色边框仅用于定位，不是需要保留的内容。"
            "必须执行用户要求的修改，不要直接返回未修改的原图。只输出完整编辑后的第一张图片。"
        )
    return text + "用户要求：" + prompt


def _annotated_reference(image: bytes, mask: bytes) -> bytes:
    with Image.open(BytesIO(image)) as original, Image.open(BytesIO(mask)) as selection:
        marked = original.convert("RGB")
        region = selection.convert("L").point(lambda value: 255 if value >= 128 else 0)
        # Draw the actual selection boundary, including the inner outpaint edge.
        # A bounding rectangle of the white area marks only the whole canvas.
        width = max(1, min(marked.size) // 300)
        border = ImageChops.subtract(
            region.filter(ImageFilter.MaxFilter(width * 2 + 1)),
            region.filter(ImageFilter.MinFilter(width * 2 + 1)),
        )
        marked.paste((255, 48, 48), mask=border)
        stream = BytesIO()
        marked.save(stream, "PNG")
        return stream.getvalue()


def _edit_references(image: bytes, mask: bytes, full_context: bool = False) -> tuple[bytes, bytes]:
    """Crop to the selection context, then bound only the provider copy."""
    limit = 8 * 1024 * 1024
    with Image.open(BytesIO(image)) as original, Image.open(BytesIO(mask)) as selection:
        if original.size != selection.size:
            raise ProviderError("图片与选区尺寸不一致")
        selected = selection.convert("L").point(lambda value: 255 if value >= 128 else 0)
        bounds = selected.getbbox()
        if bounds is None:
            raise ProviderError("请先框选需要修改的区域")
        box = (
            (0, 0, original.width, original.height)
            if full_context
            else context_box(original.width, original.height, bounds)
        )
        full = box == (0, 0, original.width, original.height)
        if full and max(original.size) <= 2048 and max(len(image), len(mask)) <= limit:
            return image, mask
        source = original.convert("RGBA").crop(box)
        region = selection.convert("L").crop(box) if full_context else selected.crop(box)
        scale = min(1.0, 2048 / max(source.size))
        while True:
            size = (max(1, round(source.width * scale)), max(1, round(source.height * scale)))
            reference = source.resize(size, Image.Resampling.LANCZOS)
            # BOX retains small selections; any selected source coverage remains selected.
            clipped = region.resize(size, Image.Resampling.BOX).point(
                lambda value: 255 if value else 0
            )
            if full_context:
                clipped = region.resize(size, Image.Resampling.BOX)
            buffers = []
            for bitmap in (reference, clipped):
                stream = BytesIO()
                bitmap.save(stream, "PNG")
                buffers.append(stream.getvalue())
            if max(map(len, buffers)) <= limit or min(size) <= 1:
                if max(map(len, buffers)) > limit:
                    raise ProviderError("无法准备模型参考图片")
                return buffers[0], buffers[1]
            scale *= 0.8


class OpenAICompatibleImages:
    def __init__(self, post: Post | None = None, fetch: Fetch | None = None) -> None:
        self._post = post or _post_json
        self._fetch = fetch or _fetch_bytes

    async def generate(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        prompt: str,
        size: str | None = None,
        count: int = 1,
        reference_images: list[str] | None = None,
    ) -> list[tuple[bytes, str]]:
        if model in QWEN_NATIVE_EDIT_MODELS:
            return await self._edit_qwen_native(
                base_url=base_url,
                api_key=api_key,
                model=model,
                instructions=prompt,
                references=reference_images or [],
                size=(size or "1024*1024").replace("x", "*"),
                count=count,
            )
        url = base_url.rstrip("/") + "/images/generations"
        payload: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "n": count,
            "response_format": "b64_json",
        }
        if reference_images:
            payload["image"] = reference_images
            payload["prompt_extend"] = False
        if size:
            payload["size"] = size
        try:
            status, body = await asyncio.to_thread(
                self._post,
                url,
                api_key,
                payload,
                _TIMEOUT_SECONDS,
            )
        except _TransportFailure as exc:
            if exc.kind == "timeout":
                raise ProviderTimeout("The model provider timed out") from None
            raise ProviderError("The model provider request failed") from None
        if status == 429:
            raise RateLimitError("The model provider is rate limiting requests")
        if status in {401, 403}:
            raise ProviderError("The model provider rejected the server credential")
        if status < 200 or status >= 300:
            detail = _provider_detail(body)
            raise ProviderError(detail or "The model provider request failed")
        images: list[tuple[bytes, str]] = []
        for encoded, remote_url in _image_fields(body)[:count]:
            if encoded:
                images.append(_decode_image(encoded))
            elif remote_url:
                images.append(await self._download(remote_url))
        if not images:
            raise ProviderError("The model provider returned an empty response")
        return images

    async def reference(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        prompt: str,
        image: bytes,
        size: str | None = None,
        count: int = 1,
    ) -> list[tuple[bytes, str]]:
        # Resize only the provider copy, using the existing bounded-image preparation.
        with Image.open(BytesIO(image)) as source:
            buffer = BytesIO()
            Image.new("L", source.size, 255).save(buffer, "PNG")
        image, _ = await asyncio.to_thread(_edit_references, image, buffer.getvalue(), True)
        if model in QWEN_REFERENCE_EDIT_MODELS:
            references = ["data:image/png;base64," + base64.b64encode(image).decode()]
            if model in QWEN_NATIVE_EDIT_MODELS:
                with Image.open(BytesIO(image)) as source:
                    width, height = source.size
                if size:
                    width, height = map(int, size.split("x"))
                results = []
                for _ in range(count):
                    results.extend(
                        await self._edit_qwen_native(
                            base_url=base_url,
                            api_key=api_key,
                            model=model,
                            instructions=prompt,
                            references=references,
                            size=_qwen_native_size(width, height),
                        )
                    )
                return results
            return await self.generate(
                base_url=base_url,
                api_key=api_key,
                model=model,
                prompt=prompt,
                size=size,
                count=count,
                reference_images=references,
            )
        return await self.edit(
            base_url=base_url,
            api_key=api_key,
            model=model,
            prompt=prompt,
            image=image,
            mask=None,
            size=size,
            count=count,
        )

    async def edit(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        prompt: str,
        image: bytes,
        mask: bytes | None,
        full_context: bool = False,
        size: str | None = None,
        count: int = 1,
        debug_artifacts: dict | None = None,
    ) -> list[tuple[bytes, str]]:
        if mask is not None:
            image, mask = await asyncio.to_thread(_edit_references, image, mask, full_context)
        if debug_artifacts is not None:
            debug_artifacts["provider-input.png"] = image
            if mask is not None:
                debug_artifacts["provider-mask.png"] = mask
            debug_artifacts["provider-prompt.txt"] = edit_instructions(
                prompt, referenced=model in QWEN_REFERENCE_EDIT_MODELS, full_context=full_context
            ).encode()
        if model in QWEN_REFERENCE_EDIT_MODELS:
            # Qwen accepts image references, not the OpenAI mask/multipart protocol.
            with Image.open(BytesIO(image)) as original:
                width, height = original.size
            if not 1 / 8 <= width / height <= 8:
                raise ProviderError("当前图片模型仅支持 1:8 到 8:1 的画幅")
            instructions = edit_instructions(prompt, referenced=True, full_context=full_context)
            reference_data = [image, mask]
            if not full_context:
                reference_data.append(await asyncio.to_thread(_annotated_reference, image, mask))
            references = [
                "data:image/png;base64," + base64.b64encode(data).decode()
                for data in reference_data
            ]
            if model in QWEN_NATIVE_EDIT_MODELS:
                return await self._edit_qwen_native(
                    base_url=base_url,
                    api_key=api_key,
                    model=model,
                    instructions=instructions,
                    references=references,
                    size=_qwen_native_size(width, height),
                )
            area = width * height
            scale = math.sqrt(min(max(area, 512 * 512), 2048 * 2048) / area)
            round_dimension = math.floor if area > 2048 * 2048 else math.ceil
            size = f"{round_dimension(width * scale)}x{round_dimension(height * scale)}"
            return await self.generate(
                base_url=base_url,
                api_key=api_key,
                model=model,
                prompt=instructions,
                size=size,
                count=1,
                reference_images=references,
            )
        # Application masks are white=edit. OpenAI masks are alpha=0 at edits.
        if mask is not None:
            with Image.open(BytesIO(mask)) as source:
                selection = source.convert("L")
                rgba = Image.new("RGBA", selection.size, "white")
                rgba.putalpha(ImageOps.invert(selection))
                stream = BytesIO()
                rgba.save(stream, "PNG")
        boundary = "fluxora-" + uuid4().hex
        fields = {
            "model": model,
            "prompt": edit_instructions(prompt, referenced=False, full_context=full_context)
            if mask is not None
            else prompt,
            "n": str(count),
            "output_format": "png",
            "size": size or "auto",
        }
        parts = []
        for name, value in fields.items():
            parts.append(
                (
                    f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"'
                    f"\r\n\r\n{value}\r\n"
                ).encode()
            )
        for name, content in [("image", image)] + (
            [("mask", stream.getvalue())] if mask is not None else []
        ):
            parts.append(
                (
                    f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; '
                    f'filename="{name}.png"\r\nContent-Type: image/png\r\n\r\n'
                ).encode()
                + content
                + b"\r\n"
            )
        parts.append(f"--{boundary}--\r\n".encode())
        try:
            status, body = await asyncio.to_thread(
                _post_multipart,
                base_url.rstrip("/") + "/images/edits",
                api_key,
                b"".join(parts),
                boundary,
            )
        except _TransportFailure as exc:
            if exc.kind == "timeout":
                raise ProviderTimeout("图片编辑超时，请查看任务状态") from None
            raise ProviderError("图片编辑服务暂不可用") from None
        if status == 429:
            raise RateLimitError("图片编辑服务限流，请稍后重试")
        if not 200 <= status < 300:
            raise ProviderError("图片编辑服务拒绝请求，请检查模型配置")
        images = []
        for encoded, remote in _image_fields(body)[:count]:
            if encoded:
                images.append(_decode_image(encoded))
            elif remote:
                images.append(await self._download(remote))
        if not images:
            raise ProviderError("图片编辑服务未返回图片")
        return images

    async def _edit_qwen_native(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        instructions: str,
        references: list[str],
        size: str,
        count: int = 1,
    ) -> list[tuple[bytes, str]]:
        payload = {
            "model": model,
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            *({"image": item} for item in references),
                            {"text": instructions},
                        ],
                    }
                ]
            },
            "parameters": {
                "n": count,
                "size": size,
                "prompt_extend": False,
                "watermark": False,
            },
        }
        try:
            status, body = await asyncio.to_thread(
                self._post,
                _qwen_native_generation_url(base_url),
                api_key,
                payload,
                _TIMEOUT_SECONDS,
            )
        except _TransportFailure as exc:
            if exc.kind == "timeout":
                raise ProviderTimeout("图片编辑超时，请查看任务状态") from None
            raise ProviderError("图片编辑服务暂不可用") from None
        if status == 429:
            raise RateLimitError("图片编辑服务限流，请稍后重试")
        if status in {401, 403}:
            raise ProviderError("The model provider rejected the server credential")
        if not 200 <= status < 300 or _native_error(body):
            detail = _provider_detail(body)
            message = (
                f"图片编辑服务拒绝请求：{detail}"
                if detail
                else "图片编辑服务拒绝请求，请检查模型配置"
            )
            raise ProviderError(message)
        urls = _native_image_urls(body)
        if not urls:
            raise ProviderError("图片编辑服务未返回图片")
        return [await self._download(url) for url in urls[:count]]

    async def _download(self, url: str) -> tuple[bytes, str]:
        _validate_image_url(url)
        try:
            content, content_type = await asyncio.to_thread(self._fetch, url, _TIMEOUT_SECONDS)
        except _TransportFailure as exc:
            if exc.kind == "timeout":
                raise ProviderTimeout("The model provider timed out") from None
            raise ProviderError("The model provider request failed") from None
        return _checked_image(content, content_type)


def _qwen_native_generation_url(base_url: str) -> str:
    root = base_url.rstrip("/")
    suffix = "/compatible-mode/v1"
    if root.endswith(suffix):
        root = root[: -len(suffix)]
    return root + "/api/v1/services/aigc/multimodal-generation/generation"


def _qwen_native_size(width: int, height: int) -> str:
    low, high = 512 * 512, 2048 * 2048
    area = width * height
    scale = math.sqrt(min(max(area, low), high) / area)

    def align(value: float) -> int:
        return max(16, int(round(value / 16)) * 16)

    sized_width, sized_height = align(width * scale), align(height * scale)
    while sized_width * sized_height > high and (sized_width > 16 or sized_height > 16):
        if sized_width >= sized_height and sized_width > 16:
            sized_width -= 16
        elif sized_height > 16:
            sized_height -= 16
        else:
            break
    while sized_width * sized_height < low:
        if sized_width <= sized_height:
            sized_width += 16
        else:
            sized_height += 16
    return f"{sized_width}*{sized_height}"


def _provider_detail(body: object) -> str | None:
    if not isinstance(body, dict):
        return None
    error = body.get("error")
    message = error.get("message") if isinstance(error, dict) else body.get("message")
    if not isinstance(message, str):
        return None
    cleaned = " ".join(message.split())
    lowered = cleaned.lower()
    if not cleaned or len(cleaned) > 160 or "sk-" in lowered or "bearer " in lowered:
        return None
    return cleaned


def _native_error(body: object) -> bool:
    if not isinstance(body, dict):
        return False
    code = body.get("code")
    return (
        isinstance(code, str)
        and bool(code.strip())
        and code.strip().lower()
        not in {
            "success",
            "ok",
        }
    )


def _native_image_urls(body: object) -> list[str]:
    if not isinstance(body, dict):
        return []
    output = body.get("output")
    if not isinstance(output, dict):
        return []
    choices = output.get("choices")
    if not isinstance(choices, list):
        return []
    urls: list[str] = []
    for choice in choices:
        if not isinstance(choice, dict):
            continue
        message = choice.get("message")
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            image = item.get("image") if isinstance(item, dict) else None
            if isinstance(image, str) and image.strip():
                urls.append(image.strip())
    return urls


def _post_json(
    url: str,
    api_key: str,
    payload: dict[str, Any],
    timeout: float,
) -> tuple[int, object]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    opener = urllib.request.build_opener(_RejectRedirect())
    try:
        with opener.open(request, timeout=timeout) as response:
            raw = response.read()
            status = response.status
    except TimeoutError as exc:
        raise _TransportFailure("timeout") from exc
    except urllib.error.HTTPError as exc:
        raw = exc.read(8192)
        try:
            return exc.code, json.loads(raw.decode("utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            return exc.code, None
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, TimeoutError):
            raise _TransportFailure("timeout") from exc
        raise _TransportFailure("network") from exc
    if not raw:
        return status, None
    try:
        return status, json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return status, None


def _fetch_bytes(url: str, timeout: float) -> tuple[bytes, str]:
    request = urllib.request.Request(url, method="GET")
    opener = urllib.request.build_opener(_RejectRedirect())
    try:
        with opener.open(request, timeout=timeout) as response:
            content_type = response.headers.get("Content-Type", "")
            return response.read(IMAGE_BYTES_MAX + 1), content_type
    except TimeoutError as exc:
        raise _TransportFailure("timeout") from exc
    except urllib.error.HTTPError as exc:
        raise _TransportFailure("network") from exc
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, TimeoutError):
            raise _TransportFailure("timeout") from exc
        raise _TransportFailure("network") from exc


def _image_fields(body: object) -> list[tuple[str | None, str | None]]:
    if not isinstance(body, dict):
        return []
    data = body.get("data")
    if not isinstance(data, list):
        return []
    images: list[tuple[str | None, str | None]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        encoded = item.get("b64_json")
        remote = item.get("url")
        images.append(
            (
                encoded if isinstance(encoded, str) and encoded.strip() else None,
                remote if isinstance(remote, str) and remote.strip() else None,
            )
        )
    return images


def _decode_image(encoded: str) -> tuple[bytes, str]:
    if len(encoded) > IMAGE_BYTES_MAX * 2:
        raise ProviderError("The model provider response is too large")
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as exc:
        raise ProviderError("The model provider returned an empty response") from exc
    return _checked_image(content, "")


def _checked_image(content: bytes, content_type: str) -> tuple[bytes, str]:
    if not content or len(content) > IMAGE_BYTES_MAX:
        raise ProviderError("The model provider response is too large")
    mime = _mime(content, content_type)
    if mime is None:
        raise ProviderError("The model provider returned an empty response")
    return content, mime


def _mime(content: bytes, content_type: str) -> str | None:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    lowered = content_type.split(";", 1)[0].strip().lower()
    if lowered in {"image/png", "image/jpeg", "image/webp"}:
        return lowered
    return None


def _validate_image_url(url: str) -> None:
    parts = urlsplit(url)
    if (
        parts.scheme != "https"
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.fragment
    ):
        raise ProviderError("The model provider request failed")


def _post_multipart(url: str, api_key: str, data: bytes, boundary: str):
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.build_opener(_RejectRedirect()).open(
            request, timeout=_TIMEOUT_SECONDS
        ) as response:
            return response.status, json.loads(response.read(IMAGE_BYTES_MAX * 2))
    except TimeoutError as exc:
        raise _TransportFailure("timeout") from exc
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except (urllib.error.URLError, ValueError) as exc:
        raise _TransportFailure("network") from exc
