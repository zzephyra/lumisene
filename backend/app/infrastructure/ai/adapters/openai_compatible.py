"""OpenAI-compatible chat completions.

The API key is sent only as a request header and is never copied into errors or logs.
"""

import asyncio
import json
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

from app.core.errors import ProviderError, RateLimitError
from app.core.errors import TimeoutError as ProviderTimeout
from app.infrastructure.ai.domain import TEXT_COMPLETION_CONTENT_MAX

Post = Callable[[str, str, dict[str, Any], float], tuple[int, object]]
_TIMEOUT_SECONDS = 60.0


class _RejectRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise _TransportFailure("network")


class _TransportFailure(Exception):
    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind


class OpenAICompatibleChat:
    def __init__(
        self, post: Post | None = None, *, timeout_seconds: float = _TIMEOUT_SECONDS
    ) -> None:
        self._post = post or _post_json
        self._timeout_seconds = timeout_seconds

    async def complete(self, *, base_url: str, api_key: str, model: str, prompt: str) -> str:
        url = base_url.rstrip("/") + "/chat/completions"
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
        }
        try:
            status, body = await asyncio.to_thread(
                self._post,
                url,
                api_key,
                payload,
                self._timeout_seconds,
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
            raise ProviderError("The model provider request failed")
        content = _message_content(body)
        if content is None:
            raise ProviderError("The model provider returned an empty response")
        if len(content) > TEXT_COMPLETION_CONTENT_MAX:
            raise ProviderError("The model provider response is too large")
        return content


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


def _message_content(body: object) -> str | None:
    if not isinstance(body, dict):
        return None
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    first = choices[0]
    if not isinstance(first, dict):
        return None
    message = first.get("message")
    if not isinstance(message, dict):
        return None
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content
    if isinstance(content, list):
        parts = [
            item.get("text")
            for item in content
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        ]
        joined = "".join(parts).strip()
        return joined or None
    return None
