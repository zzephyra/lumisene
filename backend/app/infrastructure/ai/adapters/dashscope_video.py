"""DashScope asynchronous text-to-video.

The API key is sent only as a request header and is never copied into errors or logs.
Submit timeouts stay unknown: the caller must not send the request again.
"""

import asyncio
import base64
import json
import re
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit

from app.core.errors import ProviderError, ProviderTaskFailedError, RateLimitError
from app.core.errors import TimeoutError as ProviderTimeout
from app.infrastructure.ai.domain import VIDEO_BYTES_MAX, WAN3_MEDIA_VIDEO_MODELS

Post = Callable[[str, str, dict[str, Any] | None, dict[str, str], float], tuple[int, object]]
Fetch = Callable[[str, float], tuple[bytes, str]]
_TIMEOUT_SECONDS = 60.0


class _RejectRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise _TransportFailure("network")


class _TransportFailure(Exception):
    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind


class DashScopeVideo:
    def __init__(self, post: Post | None = None, fetch: Fetch | None = None) -> None:
        self._post = post or _post_json
        self._fetch = fetch or _fetch_bytes

    async def submit(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        prompt: str,
        size: str | None,
        duration: int,
        image: bytes | None = None,
        resolution: str | None = None,
    ) -> str:
        url = _origin(base_url) + "/api/v1/services/aigc/video-generation/video-synthesis"
        parameters: dict[str, Any] = {"duration": duration}
        if size:
            parameters["size"] = size
        # China Model Studio uses the wanx2.1 identifier for this same legacy model.
        # Keep catalog identities stable; never switch providers or model families on failure.
        wire_model = model
        if (urlsplit(base_url).hostname or "").endswith(".maas.aliyuncs.com"):
            wire_model = {
                "wan2.1-i2v-turbo": "wanx2.1-i2v-turbo",
                "wan2.1-i2v-plus": "wanx2.1-i2v-plus",
            }.get(model, model)
        payload = {"model": wire_model, "input": {"prompt": prompt}, "parameters": parameters}
        if image is not None:
            reference = _image_data_uri(image)
            if model in WAN3_MEDIA_VIDEO_MODELS:
                payload["input"]["media"] = [{"type": "first_frame", "url": reference}]
                parameters["ratio"] = "adaptive"
            else:
                payload["input"]["img_url"] = reference
            parameters.pop("size", None)
            parameters["resolution"] = resolution
        status, body = await self._request(
            url,
            api_key,
            payload,
            {"X-DashScope-Async": "enable"},
        )
        output = _output(body)
        task_id = output.get("task_id")
        task_status = output.get("task_status")
        if status < 200 or status >= 300 or task_status == "FAILED":
            code = body.get("code", output.get("code", "")) if isinstance(body, dict) else ""
            safe_code = (
                code
                if isinstance(code, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,79}", code)
                else "unknown"
            )
            raise ProviderError(f"视频供应商拒绝请求（HTTP {status}，{safe_code}）")
        if not isinstance(task_id, str) or not task_id.strip():
            raise ProviderTimeout("The model provider submission outcome is unknown")
        return task_id.strip()

    async def poll(
        self,
        *,
        base_url: str,
        api_key: str,
        provider_task_id: str,
    ) -> tuple[str, tuple[bytes, str] | None]:
        url = _origin(base_url) + "/api/v1/tasks/" + provider_task_id
        status, body = await self._request(url, api_key, None, {})
        if status < 200 or status >= 300:
            raise ProviderError("The model provider request failed")
        output = _output(body)
        task_status = output.get("task_status")
        if task_status in {"PENDING", "RUNNING"}:
            return "pending", None
        if task_status == "SUCCEEDED":
            remote = output.get("video_url")
            if not isinstance(remote, str) or not remote.strip():
                raise ProviderError("The model provider returned an empty response")
            return "succeeded", await self._download(remote.strip())
        if task_status in {"FAILED", "CANCELED"}:
            raw_code = output.get("code") or (body.get("code") if isinstance(body, dict) else None)
            code = (
                raw_code
                if isinstance(raw_code, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", raw_code)
                else "Unknown"
            )
            reason = (
                "供应商视频生成算法异常，可重试失败镜头"
                if code == "AlgoError"
                else "供应商未能完成视频生成，请检查输入或稍后重试"
            )
            # Never expose raw provider messages: they may include stack traces or URLs.
            raise ProviderTaskFailedError(f"{reason}（{code}）")
        return "pending", None

    async def _request(
        self,
        url: str,
        api_key: str,
        payload: dict[str, Any] | None,
        headers: dict[str, str],
    ) -> tuple[int, object]:
        try:
            status, body = await asyncio.to_thread(
                self._post,
                url,
                api_key,
                payload,
                headers,
                _TIMEOUT_SECONDS,
            )
        except _TransportFailure as exc:
            if exc.kind == "timeout" or payload is not None:
                raise ProviderTimeout("The model provider submission outcome is unknown") from None
            raise ProviderError("The model provider request failed") from None
        if payload is not None and status >= 500:
            raise ProviderTimeout("The model provider submission outcome is unknown")
        if status == 429:
            raise RateLimitError("The model provider is rate limiting requests")
        if status in {401, 403}:
            raise ProviderError("The model provider rejected the server credential")
        return status, body

    async def _download(self, url: str) -> tuple[bytes, str]:
        _validate_video_url(url)
        try:
            content, content_type = await asyncio.to_thread(self._fetch, url, _TIMEOUT_SECONDS)
        except _TransportFailure as exc:
            if exc.kind == "timeout":
                raise ProviderTimeout("The model provider timed out") from None
            raise ProviderError("The model provider request failed") from None
        if not content or len(content) > VIDEO_BYTES_MAX or not _is_mp4(content, content_type):
            raise ProviderError("The model provider returned an empty response")
        return content, "video/mp4"


def _image_data_uri(image: bytes) -> str:
    if image.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif len(image) >= 12 and image[:4] == b"RIFF" and image[8:12] == b"WEBP":
        mime = "image/webp"
    else:
        mime = "image/png"
    return f"data:{mime};base64," + base64.b64encode(image).decode()


def _origin(base_url: str) -> str:
    parts = urlsplit(base_url.strip())
    if parts.scheme != "https" or not parts.hostname:
        raise ProviderError("The model provider request failed")
    return f"https://{parts.hostname}"


def _output(body: object) -> dict[str, Any]:
    if not isinstance(body, dict):
        return {}
    output = body.get("output")
    return output if isinstance(output, dict) else {}


def _is_mp4(content: bytes, content_type: str) -> bool:
    if len(content) >= 12 and content[4:8] == b"ftyp":
        return True
    return content_type.split(";", 1)[0].strip().lower() == "video/mp4"


def _validate_video_url(url: str) -> None:
    parts = urlsplit(url)
    if (
        parts.scheme != "https"
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.fragment
    ):
        raise ProviderError("The model provider request failed")


def _post_json(
    url: str,
    api_key: str,
    payload: dict[str, Any] | None,
    headers: dict[str, str],
    timeout: float,
) -> tuple[int, object]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method="GET" if data is None else "POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            **headers,
        },
    )
    opener = urllib.request.build_opener(_RejectRedirect)
    try:
        with opener.open(request, timeout=timeout) as response:
            raw = response.read()
            return response.status, json.loads(raw.decode("utf-8")) if raw else {}
    except TimeoutError as exc:
        raise _TransportFailure("timeout") from exc
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except json.JSONDecodeError:
            body = {}
        return exc.code, body
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, TimeoutError):
            raise _TransportFailure("timeout") from exc
        raise _TransportFailure("network") from exc
    except json.JSONDecodeError as exc:
        raise _TransportFailure("network") from exc


def _fetch_bytes(url: str, timeout: float) -> tuple[bytes, str]:
    _validate_video_url(url)
    request = urllib.request.Request(url, method="GET")
    opener = urllib.request.build_opener(_RejectRedirect)
    try:
        with opener.open(request, timeout=timeout) as response:
            content_type = response.headers.get("Content-Type", "")
            return response.read(VIDEO_BYTES_MAX + 1), content_type
    except TimeoutError as exc:
        raise _TransportFailure("timeout") from exc
    except urllib.error.HTTPError as exc:
        raise _TransportFailure("network") from exc
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, TimeoutError):
            raise _TransportFailure("timeout") from exc
        raise _TransportFailure("network") from exc
