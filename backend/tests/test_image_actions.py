"""Real PG/API/worker tests; provider and private storage are explicit test doubles."""

import asyncio
import base64
from datetime import UTC, datetime, timedelta
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from app.core.errors import ValidationError
from app.infrastructure.db.session import UnitOfWork, create_db_engine, create_session_factory
from app.modules.generation.inputs import GenerationInputService, normalize
from app.modules.generation.models import GenerationInput
from app.modules.generation.service import ImageGenerationService
from app.modules.generation.video import VideoGenerationService
from PIL import Image
from sqlalchemy import select

from tests.test_identity_projects import PASSWORD, _create_user, _login, _mutation_headers
from tests.test_image_generations import image_api, migrated_database  # noqa: F401
from tests.test_model_configs import _grant, _publish
from tests.test_video_generations import MP4


def picture(color="red", size=(256, 256)):
    buffer = BytesIO()
    Image.new("RGB", size, color).save(buffer, "PNG")
    return buffer.getvalue()


def b64(data):
    return base64.b64encode(data).decode()


def setup(client, settings):
    owner = asyncio.run(_create_user(settings, "editor@example.com", PASSWORD))
    _login(client, settings, owner.email, PASSWORD)
    asyncio.run(_grant(settings, owner.email))
    project = client.post(
        "/api/v1/projects",
        json={"name": "Image actions"},
        headers=_mutation_headers(client, settings),
    ).json()["id"]
    for capability, model in [
        ("text_to_image", "gpt-image-1"),
        ("text_to_video", "wan2.2-i2v-flash"),
    ]:
        config = _publish(client, settings, model_name=model, capability=capability)
        response = client.put(
            f"/api/v1/admin/model-assignments/{capability}",
            json={"model_config_id": config["id"]},
            headers=_mutation_headers(client, settings),
        )
        assert response.status_code == 200
    return project


def upload(client, settings, project, mask=None):
    body = {
        "id": str(uuid4()),
        "image_base64": b64(picture()),
        "mask_base64": b64(mask) if mask else None,
    }
    response = client.post(
        f"/api/v1/projects/{project}/generation-inputs",
        json=body,
        headers=_mutation_headers(client, settings),
    )
    assert response.status_code == 201, response.text
    replay = client.post(
        f"/api/v1/projects/{project}/generation-inputs",
        json=body,
        headers=_mutation_headers(client, settings),
    )
    assert replay.json() == response.json()
    return response.json()["id"]


def submit(client, settings, project, input_id, kind, key="one"):
    return client.post(
        f"/api/v1/projects/{project}/generation-tasks",
        json={
            "input_id": input_id,
            "prompt": "a blue object",
            "kind": kind,
            "parameters": {"duration": 5, "resolution": "720P"} if kind == "video" else {},
        },
        headers={**_mutation_headers(client, settings), "Idempotency-Key": key},
    )


class EditedImages:
    async def edit(self, **kwargs):
        assert kwargs["model"] == "gpt-image-1"
        assert Image.open(BytesIO(kwargs["mask"])).getpixel((0, 0)) == 255
        return [(picture("blue"), "image/png")]


class ImageVideo:
    async def submit(self, **kwargs):
        assert kwargs["image"].startswith(b"\x89PNG")
        assert kwargs["resolution"] == "720P"
        return "image-video-task"

    async def poll(self, **kwargs):
        return "succeeded", (MP4, "video/mp4")


def test_inpaint_and_video_complete_with_project_scoped_results(image_api):  # noqa: F811
    client, settings, storage = image_api
    project = setup(client, settings)
    options = client.get(f"/api/v1/projects/{project}/image-editor-options").json()
    assert all(item["available"] for item in options if item["capability"] != "image_outpaint")
    mask = Image.new("L", (256, 256), 0)
    mask.paste(255, (0, 0, 128, 256))
    stream = BytesIO()
    mask.save(stream, "PNG")
    image_input = upload(client, settings, project, stream.getvalue())
    queued = submit(client, settings, project, image_input, "image")
    assert queued.status_code == 202, queued.text
    task_id = queued.json()["id"]
    active = client.get(f"/api/v1/projects/{project}/active-model?capability=text_to_image").json()
    assert queued.json()["model_config_id"] == active["id"]
    # Reassigning the global model must not change an already queued task.
    replacement = _publish(
        client, settings, model_name="qwen-image-3.0", capability="text_to_image"
    )
    assert (
        client.put(
            "/api/v1/admin/model-assignments/text_to_image",
            json={"model_config_id": replacement["id"]},
            headers=_mutation_headers(client, settings),
        ).status_code
        == 200
    )

    async def run():
        engine = create_db_engine(settings)
        try:
            await ImageGenerationService(
                settings, create_session_factory(engine), EditedImages(), storage
            ).execute(UUID(task_id))
        finally:
            await engine.dispose()

    asyncio.run(run())
    assert (
        client.put(
            "/api/v1/admin/model-assignments/text_to_image",
            json={"model_config_id": active["id"]},
            headers=_mutation_headers(client, settings),
        ).status_code
        == 200
    )
    assert submit(client, settings, project, image_input, "image").json()["id"] == task_id
    result = client.get(f"/api/v1/projects/{project}/generation-tasks/{task_id}").json()
    assert result["status"] == "succeeded", result
    content = client.get(
        f"/api/v1/projects/{project}/assets/{result['output_asset_ids'][0]}/content"
    ).content
    edited = Image.open(BytesIO(content))
    assert edited.getpixel((0, 0))[:3] == (0, 0, 255)
    assert edited.getpixel((200, 0))[:3] == (255, 0, 0)
    video_input = upload(client, settings, project)
    video = submit(client, settings, project, video_input, "video", "video")
    assert video.status_code == 202, video.text

    async def run_video():
        engine = create_db_engine(settings)
        try:
            service = VideoGenerationService(
                settings, create_session_factory(engine), ImageVideo(), storage
            )
            assert UUID(video.json()["id"]) in await service.claim_queued()
            await service.dispatch(UUID(video.json()["id"]))
            await service.poll(UUID(video.json()["id"]))
        finally:
            await engine.dispose()

    asyncio.run(run_video())
    assert (
        client.get(f"/api/v1/projects/{project}/generation-tasks/{video.json()['id']}").json()[
            "status"
        ]
        == "succeeded"
    )


def test_input_permissions_validation_and_wrong_operation(image_api):  # noqa: F811
    client, settings, storage = image_api
    project = setup(client, settings)
    input_id = upload(client, settings, project)
    other = client.post(
        "/api/v1/projects", json={"name": "Other"}, headers=_mutation_headers(client, settings)
    ).json()["id"]
    assert submit(client, settings, other, input_id, "video").status_code == 404
    assert submit(client, settings, other, input_id, "image").status_code == 404
    invalid = client.post(
        f"/api/v1/projects/{project}/generation-inputs",
        json={"id": str(uuid4()), "image_base64": "not-an-image"},
        headers=_mutation_headers(client, settings),
    )
    assert invalid.status_code == 422
    assert (
        client.post(
            f"/api/v1/projects/{project}/generation-inputs",
            json={"id": str(uuid4()), "image_base64": b64(picture())},
        ).status_code
        == 403
    )
    asyncio.run(_create_user(settings, "outsider@example.com", PASSWORD))
    _login(client, settings, "outsider@example.com", PASSWORD)
    assert client.get(f"/api/v1/projects/{project}/image-editor-options").status_code == 404
    assert submit(client, settings, project, input_id, "video").status_code == 404


@pytest.mark.parametrize("mask", [picture("black"), picture("white", (12, 12))])
def test_reject_empty_or_mismatched_mask(mask):
    with pytest.raises(ValidationError):
        normalize(b64(picture()), b64(mask))


def test_prune_preserves_referenced_inputs(image_api):  # noqa: F811
    client, settings, storage = image_api
    project = setup(client, settings)
    referenced = upload(client, settings, project)
    unused = upload(client, settings, project)
    assert submit(client, settings, project, referenced, "video").status_code == 202

    async def delete_object(*, object_key):
        storage.objects.pop(object_key, None)

    storage.delete_object = delete_object

    async def prune():
        engine = create_db_engine(settings)
        try:
            async with create_session_factory(engine)() as session:
                for row in (await session.execute(select(GenerationInput))).scalars():
                    row.created_at = datetime.now(UTC) - timedelta(days=2)
                await session.commit()
                assert (
                    await GenerationInputService(settings, storage).prune(UnitOfWork(session)) == 1
                )
                assert await session.get(GenerationInput, UUID(referenced)) is not None
                assert await session.get(GenerationInput, UUID(unused)) is None
        finally:
            await engine.dispose()

    asyncio.run(prune())


def test_openai_adapter_sends_transparent_edit_mask(monkeypatch):
    from email.parser import BytesParser
    from email.policy import default

    from app.infrastructure.ai.adapters import openai_images

    def post(url, key, data, boundary):
        assert url == "https://example.test/v1/images/edits"
        message = BytesParser(policy=default).parsebytes(
            f"Content-Type: multipart/form-data; boundary={boundary}\r\n\r\n".encode() + data
        )
        parts = {
            part.get_param("name", header="content-disposition"): part.get_payload(decode=True)
            for part in message.iter_parts()
        }
        assert b"change" in parts["prompt"]
        assert "根据用户要求修改指定区域".encode() in parts["prompt"]
        mask = Image.open(BytesIO(parts["mask"]))
        assert mask.getpixel((0, 0))[3] == 0
        return 200, {"data": [{"b64_json": b64(picture())}]}

    monkeypatch.setattr(openai_images, "_post_multipart", post)
    result = asyncio.run(
        openai_images.OpenAICompatibleImages().edit(
            base_url="https://example.test/v1",
            api_key="test",
            model="gpt-image-1",
            prompt="change",
            image=picture(),
            mask=picture("white"),
        )
    )
    assert result[0][1] == "image/png"


def test_dashscope_first_frame_payload_and_unknown_submission():
    from app.core.errors import TimeoutError as ProviderTimeout
    from app.infrastructure.ai.adapters.dashscope_video import DashScopeVideo

    def post(url, key, payload, headers, timeout):
        assert payload["input"]["img_url"] == "data:image/png;base64," + b64(picture())
        assert payload["parameters"] == {"duration": 5, "resolution": "720P"}
        return 503, {}

    with pytest.raises(ProviderTimeout):
        asyncio.run(
            DashScopeVideo(post=post).submit(
                base_url="https://dashscope.aliyuncs.com",
                api_key="test",
                model="wan2.2-i2v-flash",
                prompt="motion",
                duration=5,
                size=None,
                image=picture(),
                resolution="720P",
            )
        )


def test_wan3_first_frame_uses_media_reference():
    from app.infrastructure.ai.adapters.dashscope_video import DashScopeVideo

    def post(url, key, payload, headers, timeout):
        assert url.endswith("/video-generation/video-synthesis")
        assert headers["X-DashScope-Async"] == "enable"
        assert payload["model"] == "wan3.0-video"
        assert "img_url" not in payload["input"]
        assert payload["input"]["media"] == [
            {"type": "first_frame", "url": "data:image/png;base64," + b64(picture())}
        ]
        assert payload["parameters"] == {
            "duration": 5,
            "resolution": "720P",
            "ratio": "adaptive",
        }
        return 200, {"output": {"task_id": "task-wan3", "task_status": "PENDING"}}

    task_id = asyncio.run(
        DashScopeVideo(post=post).submit(
            base_url="https://example.test/api/v1",
            api_key="test",
            model="wan3.0-video",
            prompt="motion",
            duration=5,
            size=None,
            image=picture(),
            resolution="720P",
        )
    )
    assert task_id == "task-wan3"


def test_qwen_image_2_edit_uses_native_multimodal_references():
    from app.infrastructure.ai.adapters.openai_images import OpenAICompatibleImages

    def post(url, key, payload, timeout):
        assert url == ("https://example.test/api/v1/services/aigc/multimodal-generation/generation")
        assert payload["model"] == "qwen-image-2.0"
        content = payload["input"]["messages"][0]["content"]
        images = [item["image"] for item in content if "image" in item]
        assert len(images) == 3
        assert images[0] == "data:image/png;base64," + b64(picture())
        assert images[1] == "data:image/png;base64," + b64(picture("white"))
        assert payload["parameters"]["size"] == "512*512"
        assert payload["parameters"]["n"] == 1
        assert "第二张是选区参考" in content[-1]["text"]
        return 200, {
            "output": {
                "choices": [{"message": {"content": [{"image": "https://example.test/out.png"}]}}]
            }
        }

    def fetch(url, timeout):
        assert url == "https://example.test/out.png"
        return picture("blue"), "image/png"

    result = asyncio.run(
        OpenAICompatibleImages(post=post, fetch=fetch).edit(
            base_url="https://example.test/compatible-mode/v1",
            api_key="test",
            model="qwen-image-2.0",
            prompt="blue",
            image=picture(),
            mask=picture("white"),
        )
    )
    assert result[0][0] == picture("blue")
def test_qwen_image_3_edit_uses_compatible_image_references():
    from app.infrastructure.ai.adapters.openai_images import OpenAICompatibleImages

    def post(url, key, payload, timeout):
        assert url.endswith("/images/generations")
        assert payload["model"] == "qwen-image-3.0"
        assert "mask" not in payload
        assert len(payload["image"]) == 3
        assert payload["image"][0] == "data:image/png;base64," + b64(picture())
        assert payload["image"][1] == "data:image/png;base64," + b64(picture("white"))
        assert payload["size"] == "512x512"
        assert "第二张是选区参考" in payload["prompt"]
        return 200, {"data": [{"b64_json": b64(picture("blue"))}]}

    result = asyncio.run(
        OpenAICompatibleImages(post=post).edit(
            base_url="https://example.test/v1",
            api_key="test",
            model="qwen-image-3.0",
            prompt="blue",
            image=picture(),
            mask=picture("white"),
        )
    )
    assert result[0][0] == picture("blue")
def test_qwen_native_size_aligns_edges_and_keeps_area_in_range():
    from app.infrastructure.ai.adapters.openai_images import _qwen_native_size

    assert _qwen_native_size(256, 256) == "512*512"
    sized = _qwen_native_size(2048, 1144)
    width, height = (int(part) for part in sized.split("*"))
    assert width % 16 == 0 and height % 16 == 0
    assert 512 * 512 <= width * height <= 2048 * 2048
    assert sized == "2048*1152"


def test_no_separate_media_assignment_and_qwen_is_available(image_api):  # noqa: F811
    client, settings, storage = image_api
    project = setup(client, settings)
    model = _publish(client, settings, model_name="qwen-image-3.0", capability="text_to_image")
    assert (
        client.put(
            "/api/v1/admin/model-assignments/text_to_image",
            json={"model_config_id": model["id"]},
            headers=_mutation_headers(client, settings),
        ).status_code
        == 200
    )
    options = client.get(f"/api/v1/projects/{project}/image-editor-options").json()
    assert options[0]["available"] is True
    assert options[0]["model_name"] == "qwen-image-3.0"
    assignments = client.get("/api/v1/admin/model-assignments").json()["items"]
    assert not {"image_inpaint", "image_to_video"} & {item["capability"] for item in assignments}
    assert (
        client.put(
            "/api/v1/admin/model-assignments/image_inpaint",
            json={"model_config_id": model["id"]},
            headers=_mutation_headers(client, settings),
        ).status_code
        == 422
    )
    input_id = upload(client, settings, project, picture("white"))
    task = submit(client, settings, project, input_id, "image").json()
    assert task["model_config_id"] == model["id"]


def test_large_inpaint_preserves_original_and_bounds_provider_copy():
    import random

    from app.infrastructure.ai.adapters.openai_images import _edit_references
    from app.modules.generation.inputs import normalize
    from app.modules.generation.service import _composite_edits

    original = Image.frombytes("RGB", (1800, 1800), random.Random(42).randbytes(1800 * 1800 * 3))
    stream = BytesIO()
    original.save(stream, "PNG")
    data = stream.getvalue()
    assert len(data) > 8 * 1024 * 1024
    mask = Image.new("L", original.size, 0)
    mask.paste(255, (0, 0, 900, 1800))
    stream = BytesIO()
    mask.save(stream, "PNG")
    saved, saved_mask, width, height = normalize(
        base64.b64encode(data).decode(), base64.b64encode(stream.getvalue()).decode()
    )
    assert (width, height) == original.size
    reference, selection = _edit_references(saved, saved_mask)
    assert max(len(reference), len(selection)) <= 8 * 1024 * 1024
    assert Image.open(BytesIO(reference)).size == Image.open(BytesIO(selection)).size
    result = _composite_edits(saved, saved_mask, [(reference, "image/png")])[0][0]
    output = Image.open(BytesIO(result))
    assert output.size == original.size
    assert (
        output.crop((900, 0, 1800, 1800)).convert("RGB").tobytes()
        == original.crop((900, 0, 1800, 1800)).tobytes()
    )


def _png(image: Image.Image) -> bytes:
    stream = BytesIO()
    image.save(stream, "PNG")
    return stream.getvalue()


def test_context_crop_tracks_the_selection_and_stays_inside_the_image():
    from app.infrastructure.ai.adapters.openai_images import _edit_references, context_box

    assert context_box(200, 200, (0, 0, 40, 40))[:2] == (0, 0)
    image = Image.new("RGBA", (400, 300), (0, 0, 255, 128))
    mask = Image.new("L", image.size, 0)
    mask.paste(255, (180, 130, 220, 170))
    reference, selection = _edit_references(_png(image), _png(mask))
    opened = Image.open(BytesIO(reference))
    region = Image.open(BytesIO(selection)).convert("L")
    assert opened.size == region.size
    assert opened.size[0] < image.width and opened.size[1] < image.height
    assert region.getbbox() is not None
    assert region.getextrema()[1] == 255
    wide = Image.new("RGB", (800, 40), "green")
    narrow = Image.new("L", wide.size, 0)
    narrow.paste(255, (390, 10, 410, 30))
    prepared, _ = _edit_references(_png(wide), _png(narrow))
    width, height = Image.open(BytesIO(prepared)).size
    assert 1 / 8 <= width / height <= 8


def test_composite_changes_only_the_selection_and_feathers_inward():
    from app.modules.generation.service import _composite_edits

    source = Image.new("RGBA", (200, 160), (10, 20, 30, 255))
    source.putpixel((0, 0), (1, 2, 3, 0))
    source.putpixel((79, 80), (9, 8, 7, 200))
    mask = Image.new("L", source.size, 0)
    mask.paste(255, (80, 60, 120, 100))
    edited = Image.new("RGBA", (20, 20), (255, 0, 0, 255))
    composed = _composite_edits(_png(source), _png(mask), [(_png(edited), "image/png")])
    output = Image.open(BytesIO(composed[0][0]))
    assert output.size == source.size
    assert output.getpixel((0, 0)) == (1, 2, 3, 0)
    assert output.getpixel((79, 80)) == (9, 8, 7, 200)
    assert output.getpixel((100, 80)) == (255, 0, 0, 255)
    edge = output.getpixel((80, 80))
    assert edge != source.getpixel((80, 80))
    assert edge != (255, 0, 0, 255)
    for y in range(source.height):
        for x in range(source.width):
            if not (80 <= x < 120 and 60 <= y < 100):
                assert output.getpixel((x, y)) == source.getpixel((x, y))
    tiny = Image.new("L", source.size, 0)
    tiny.paste(255, (100, 80, 104, 84))
    tiny_output = Image.open(
        BytesIO(_composite_edits(_png(source), _png(tiny), [(_png(edited), "image/png")])[0][0])
    )
    assert tiny_output.getpixel((0, 0)) == (1, 2, 3, 0)
    assert tiny_output.getpixel((99, 79)) == source.getpixel((99, 79))
    assert tiny_output.getpixel((101, 81)) != source.getpixel((101, 81))
    with pytest.raises(ValidationError, match="无法解码"):
        _composite_edits(_png(source), _png(mask), [(b"not-an-image", "image/png")])
    with pytest.raises(ValidationError, match="请先框选"):
        empty = _png(Image.new("L", source.size, 0))
        _composite_edits(_png(source), empty, [(_png(edited), "image/png")])


def test_qwen_rejects_extreme_aspect_without_calling_the_provider():
    from app.core.errors import ProviderError
    from app.infrastructure.ai.adapters.openai_images import (
        OpenAICompatibleImages,
        edit_instructions,
    )

    instructions = edit_instructions("移除这里的人物", referenced=True)
    assert "第二张是选区参考" in instructions
    assert "根据周围可见场景合理补全被遮挡背景" in instructions
    called = False

    def post(url, key, payload, timeout):
        nonlocal called
        called = True
        return 200, {"data": [{"b64_json": b64(picture())}]}

    with pytest.raises(ProviderError, match="1:8"):
        asyncio.run(
            OpenAICompatibleImages(post=post).edit(
                base_url="https://example.test/v1",
                api_key="test",
                model="qwen-image-3.0",
                prompt="移除这里的人物",
                image=picture("red", (800, 40)),
                mask=picture("white", (800, 40)),
            )
        )
    assert called is False


def test_unchanged_inpaint_is_not_reported_as_success():
    from app.modules.generation.service import _composite_edits

    source = Image.new("RGB", (256, 256), "red")
    mask = Image.new("L", source.size, 255)
    with pytest.raises(ValidationError, match="没有变化"):
        _composite_edits(_png(source), _png(mask), [(_png(source), "image/png")])


def test_reference_image_uses_unified_image_model_without_mask(image_api):  # noqa: F811
    client, settings, storage = image_api
    project = setup(client, settings)
    input_id = upload(client, settings, project)
    queued = submit(client, settings, project, input_id, "image")
    assert queued.status_code == 202, queued.text
    assert submit(client, settings, project, input_id, "image").json()["id"] == queued.json()["id"]

    class ReferenceImages:
        async def reference(self, **kwargs):
            assert kwargs["model"] == "gpt-image-1"
            assert kwargs["image"] == picture()
            assert "mask" not in kwargs
            return [(picture("blue"), "image/png")]

    async def run():
        engine = create_db_engine(settings)
        try:
            await ImageGenerationService(
                settings, create_session_factory(engine), ReferenceImages(), storage
            ).execute(UUID(queued.json()["id"]))
        finally:
            await engine.dispose()

    asyncio.run(run())
    result = client.get(f"/api/v1/projects/{project}/generation-tasks/{queued.json()['id']}").json()
    assert result["status"] == "succeeded", result
    assert len(result["output_asset_ids"]) == 1


@pytest.mark.parametrize("model", ["qwen-image-2.0", "qwen-image-3.0"])
def test_reference_adapter_sends_only_original_and_user_prompt(model):
    from app.infrastructure.ai.adapters.openai_images import OpenAICompatibleImages

    def post(url, key, payload, timeout):
        if model == "qwen-image-2.0":
            content = payload["input"]["messages"][0]["content"]
            assert len([part for part in content if "image" in part]) == 1
            assert {"text": "watercolor"} in content
            return 200, {
                "output": {
                    "choices": [
                        {"message": {"content": [{"image": "https://example.test/out.png"}]}}
                    ]
                }
            }
        else:
            assert len(payload["image"]) == 1
            assert payload["prompt"] == "watercolor"
        return 200, {"data": [{"b64_json": b64(picture("blue"))}]}

    result = asyncio.run(
        OpenAICompatibleImages(
            post=post, fetch=lambda *_: (picture("blue"), "image/png")
        ).reference(
            base_url="https://example.com/compatible-mode/v1",
            api_key="test",
            model=model,
            prompt="watercolor",
            image=picture(),
            size="1024x1024",
        )
    )
    assert result


def test_openai_reference_has_no_selection_mask(monkeypatch):
    from app.infrastructure.ai.adapters import openai_images

    def post(url, key, data, boundary):
        assert url.endswith("/images/edits")
        assert b'name="image"' in data
        assert b'name="mask"' not in data
        assert b"watercolor" in data
        assert b"1024x1024" in data
        return 200, {"data": [{"b64_json": b64(picture("blue"))}]}

    monkeypatch.setattr(openai_images, "_post_multipart", post)
    result = asyncio.run(
        openai_images.OpenAICompatibleImages().reference(
            base_url="https://example.test/v1",
            api_key="test",
            model="gpt-image-1",
            prompt="watercolor",
            image=picture(),
            size="1024x1024",
        )
    )
    assert result[0][0] == picture("blue")
