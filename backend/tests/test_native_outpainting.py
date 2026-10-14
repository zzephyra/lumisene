import asyncio
from io import BytesIO

import pytest
from app.core.errors import ProviderError, ValidationError
from app.infrastructure.ai.adapters.outpainting import NativeOutpainting, validate_parameters
from app.infrastructure.ai.image_codec import png
from PIL import Image

PARAMS = dict(left_offset=0, right_offset=300, top_offset=0, bottom_offset=0, best_quality=False)


def test_native_request_has_original_and_offsets_without_prompt_or_mask():
    calls = []
    image = png(Image.new("RGB", (512, 512), "white"))

    class Transport:
        async def _request(self, *args):
            calls.append(args)
            return 200, {"output": {"task_id": "remote-1", "task_status": "PENDING"}}

    adapter = NativeOutpainting(Transport())
    assert (
        asyncio.run(
            adapter.submit(
                base_url="https://example.test/compatible-mode/v1",
                api_key="test",
                image=image,
                parameters=PARAMS,
            )
        )
        == "remote-1"
    )
    url, _, body, headers = calls[0]
    assert url.endswith("/api/v1/services/aigc/image2image/out-painting")
    assert body["model"] == "image-out-painting"
    assert set(body["input"]) == {"image_url"}
    assert body["parameters"] == {**PARAMS, "limit_image_size": True}
    assert headers == {"X-DashScope-Async": "enable"}
    assert len(calls) == 1


@pytest.mark.parametrize(
    "change",
    [
        dict(right_offset=-1),
        dict(right_offset=True),
        dict(right_offset=1536),
        dict(prompt="girl"),
        dict(right_offset=0),
    ],
)
def test_invalid_parameters_rejected(change):
    with pytest.raises(ValidationError):
        validate_parameters({**PARAMS, **change}, 512, 512)


def test_output_is_returned_without_original_overlay():
    raw = png(Image.new("RGB", (812, 512), "blue"))

    class Transport:
        async def _request(self, *args):
            assert args[2] is None
            return 200, {
                "output": {
                    "task_status": "SUCCEEDED",
                    "output_image_url": "https://example.test/result.png",
                }
            }

    class Images:
        async def _download(self, url):
            return raw, "image/png"

    state, result = asyncio.run(
        NativeOutpainting(Transport(), Images()).poll(
            base_url="https://example.test", api_key="test", task_id="remote-1"
        )
    )
    assert state == "succeeded" and result[0] == raw
    assert Image.open(BytesIO(result[0])).getpixel((0, 0)) == (0, 0, 255)


def test_unknown_remote_status_is_not_success():
    class Transport:
        async def _request(self, *args):
            return 200, {"output": {"task_status": "UNKNOWN"}}

    with pytest.raises(ProviderError):
        asyncio.run(
            NativeOutpainting(Transport()).poll(
                base_url="https://example.test", api_key="test", task_id="remote-1"
            )
        )
