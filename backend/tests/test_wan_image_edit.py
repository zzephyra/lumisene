import asyncio

import pytest
from app.core.errors import ValidationError
from app.infrastructure.ai.adapters.wan_image_edit import WanImageEditing, expansion_parameters
from app.infrastructure.ai.image_codec import png
from PIL import Image


@pytest.mark.parametrize(
    "operation,function",
    [
        ("image_outpaint", "expand"),
        ("image_inpaint", "description_edit_with_mask"),
        ("image_to_image", "description_edit"),
    ],
)
def test_wan_protocol(operation, function):
    calls = []

    class Transport:
        async def _request(self, *args):
            calls.append(args)
            return 200, {"output": {"task_id": "wan-123"}}

    image = png(Image.new("RGB", (512, 512), "white"))
    params = dict(left_offset=0, right_offset=256, top_offset=0, bottom_offset=0)
    asyncio.run(
        WanImageEditing(Transport()).submit(
            base_url="https://example.test",
            api_key="test",
            image=image,
            parameters=params,
            operation=operation,
            prompt="同样画风",
            mask=image if operation == "image_inpaint" else None,
        )
    )
    url, _, body, headers = calls[0]
    assert url.endswith("/image-synthesis")
    assert body["model"] == "wanx2.1-imageedit"
    assert body["input"]["function"] == function
    assert "base_image_url" in body["input"]
    assert ("mask_image_url" in body["input"]) == (operation == "image_inpaint")
    assert "best_quality" not in body["parameters"]
    if operation == "image_outpaint":
        assert body["input"]["prompt"] == "同样画风"
        assert body["parameters"]["left_scale"] == 1
        assert body["parameters"]["right_scale"] == 1.5
        assert body["parameters"]["top_scale"] == 1
        assert body["parameters"]["bottom_scale"] == 1
        assert body["parameters"]["n"] == 1
    assert headers["X-DashScope-Async"] == "enable"


def test_invalid_expansion():
    with pytest.raises(ValidationError):
        expansion_parameters(
            dict(left_offset=0, right_offset=513, top_offset=0, bottom_offset=0), 512, 512
        )


def test_result_list():
    image = png(Image.new("RGB", (512, 512), "blue"))

    class Transport:
        async def _request(self, *args):
            return 200, {
                "output": {
                    "task_status": "SUCCEEDED",
                    "results": [{"url": "https://example.test/result.png"}],
                }
            }

    class Images:
        async def _download(self, url):
            return image, "image/png"

    assert asyncio.run(
        WanImageEditing(Transport(), Images()).poll(
            base_url="https://example.test", api_key="test", task_id="wan-1"
        )
    ) == ("succeeded", (image, "image/png"))
