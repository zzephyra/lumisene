"""Bind the existing image adapter to the model selected by the application.

No alternate provider routing or credentials are exposed to skill context/logging.
"""

from typing import Protocol

from .base import ImageResults


class ImageEditClient(Protocol):
    async def edit(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        prompt: str,
        image: bytes,
        mask: bytes,
        full_context: bool = False,
    ) -> ImageResults: ...


class BoundImageAdapter:
    def __init__(
        self,
        client: ImageEditClient,
        *,
        base_url: str,
        api_key: str,
        model: str,
        debug_artifacts: dict | None = None,
    ) -> None:
        self._debug_artifacts = debug_artifacts
        self._client, self._base_url, self._api_key, self._model = client, base_url, api_key, model

    async def edit(
        self, *, prompt: str, image: bytes, mask: bytes, full_context: bool = False
    ) -> ImageResults:
        from app.infrastructure.ai.adapters.openai_images import OpenAICompatibleImages

        extra = (
            {"debug_artifacts": self._debug_artifacts}
            if isinstance(self._client, OpenAICompatibleImages)
            else {}
        )
        return await self._client.edit(
            base_url=self._base_url,
            api_key=self._api_key,
            model=self._model,
            prompt=prompt,
            image=image,
            mask=mask,
            full_context=full_context,
            **extra,
        )
