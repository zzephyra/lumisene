import asyncio
import json
import os
from uuid import UUID

import pytest
from alembic import command
from alembic.config import Config
from app.api.deps import get_image_generation_service, get_video_generation_service
from app.core.config import get_settings
from app.core.errors import TimeoutError as ProviderTimeout
from app.infrastructure.ai.adapters.dashscope_video import DashScopeVideo
from app.infrastructure.db.session import create_db_engine, create_session_factory
from app.main import create_app
from app.modules.generation.service import ImageGenerationService
from app.modules.generation.video import VideoGenerationService
from fastapi.testclient import TestClient

from tests.conftest import make_settings
from tests.test_identity_projects import (
    BACKEND_ROOT,
    ORIGIN,
    PASSWORD,
    _create_user,
    _ensure_database,
    _login,
    _mutation_headers,
)
from tests.test_image_generations import ExplodingImages, MemoryStorage
from tests.test_model_configs import LEAKED_KEY, _grant, _publish, _truncate

TEST_DATABASE_URL = "postgresql+asyncpg://fluxora:fluxora@127.0.0.1:5432/fluxora_test"
FAKE_KEY = "test-key-not-real"
ENDPOINT = json.dumps(
    {
        "openai_api_key": {
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "api_key": FAKE_KEY,
        }
    }
)
MP4 = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 16


class ExplodingVideo:
    async def submit(self, **kwargs: object) -> str:
        raise AssertionError("submit must not call the provider")

    async def poll(self, **kwargs: object) -> tuple[str, tuple[bytes, str] | None]:
        raise AssertionError("poll must not call the provider")


class ScriptedVideo:
    def __init__(self, *, fail_submit: bool = False) -> None:
        self.fail_submit = fail_submit
        self.submits = 0
        self.polls = 0
        self.api_keys: list[str] = []
        self.urls: list[str] = []

    async def submit(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        prompt: str,
        size: str | None,
        duration: int,
    ) -> str:
        self.submits += 1
        self.api_keys.append(api_key)
        self.urls.append(base_url)
        if self.fail_submit:
            raise ProviderTimeout("The model provider timed out")
        assert model == "video-1"
        assert prompt == "a quiet harbor"
        assert size == "1920*1080"
        assert duration == 5
        return "provider-task-1"

    async def poll(
        self,
        *,
        base_url: str,
        api_key: str,
        provider_task_id: str,
    ) -> tuple[str, tuple[bytes, str] | None]:
        self.polls += 1
        self.api_keys.append(api_key)
        assert provider_task_id == "provider-task-1"
        return "succeeded", (MP4, "video/mp4")


@pytest.fixture(scope="module")
def migrated_database() -> str:
    try:
        asyncio.run(_ensure_database())
    except OSError as exc:
        pytest.fail(f"PostgreSQL is required for video generation tests: {exc}")
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    get_settings.cache_clear()
    try:
        config = Config(str(BACKEND_ROOT / "alembic.ini"))
        config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
        command.upgrade(config, "head")
    finally:
        if previous is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous
        get_settings.cache_clear()
    return TEST_DATABASE_URL


@pytest.fixture
def video_api(migrated_database: str):
    asyncio.run(_truncate(migrated_database))
    settings = make_settings(
        database_url=migrated_database,
        csrf_secret="test-csrf-secret-value-with-32b",
        cors_allowed_origins=[ORIGIN],
        model_secret_refs="openai_api_key",
        model_endpoints=ENDPOINT,
        s3_endpoint_url="http://127.0.0.1:9000",
        s3_bucket="fluxora",
        s3_access_key_id="fluxora",
        s3_secret_access_key="test-storage-secret",
    )
    storage = MemoryStorage()
    app = create_app(settings)
    app.dependency_overrides[get_video_generation_service] = lambda: VideoGenerationService(
        settings,
        client=ExplodingVideo(),
        storage=storage,
    )
    app.dependency_overrides[get_image_generation_service] = lambda: ImageGenerationService(
        settings,
        client=ExplodingImages(),
        storage=storage,
    )
    with TestClient(app) as client:
        yield client, settings, storage


def test_video_queue_does_not_call_provider_and_worker_stores_mp4(video_api) -> None:
    client, settings, storage = video_api
    owner = asyncio.run(_create_user(settings, "owner@example.com", PASSWORD))
    _login(client, settings, owner.email, PASSWORD)
    project_id = client.post(
        "/api/v1/projects",
        json={"name": "Film"},
        headers=_mutation_headers(client, settings),
    ).json()["id"]
    asyncio.run(_grant(settings, owner.email))
    model = _publish(client, settings, model_name="video-1", capability="text_to_video")
    image = _publish(client, settings, model_name="image-1", capability="text_to_image")

    leaked = client.post(
        f"/api/v1/projects/{project_id}/generation-tasks",
        json={
            "prompt": "a quiet harbor",
            "parameters": {},
            "kind": "video",
            "api_key": LEAKED_KEY,
        },
        headers={**_mutation_headers(client, settings), "Idempotency-Key": "video-key-leak"},
    )
    assert leaked.status_code == 422
    assert LEAKED_KEY not in leaked.text
    assert FAKE_KEY not in leaked.text

    unassigned = _submit(client, settings, project_id, "a quiet harbor", "video-key-0")
    assert unassigned.status_code == 422
    mismatch = client.put(
        "/api/v1/admin/model-assignments/text_to_video",
        json={"model_config_id": image["id"]},
        headers=_mutation_headers(client, settings),
    )
    assert mismatch.status_code == 422
    assigned = client.put(
        "/api/v1/admin/model-assignments/text_to_video",
        json={"model_config_id": model["id"]},
        headers=_mutation_headers(client, settings),
    )
    assert assigned.status_code == 200

    references = client.post(
        f"/api/v1/projects/{project_id}/generation-tasks",
        json={
            "prompt": "a quiet harbor",
            "parameters": {"duration": 5},
            "kind": "video",
            "reference_asset_ids": ["11111111-1111-4111-8111-111111111111"],
        },
        headers={**_mutation_headers(client, settings), "Idempotency-Key": "video-key-ref"},
    )
    assert references.status_code == 422

    queued = _submit(client, settings, project_id, " a quiet harbor ", "video-key-1")
    assert queued.status_code == 202
    body = queued.json()
    assert body["status"] == "queued"
    assert body["kind"] == "video"
    assert body["output_asset_ids"] == []
    assert FAKE_KEY not in queued.text
    image_queue = asyncio.run(_image_queued(settings))
    assert image_queue == []

    script = ScriptedVideo()
    asyncio.run(_run_worker(settings, UUID(body["id"]), script, storage))
    assert script.submits == 1
    assert script.polls == 1
    assert script.api_keys == [FAKE_KEY, FAKE_KEY]
    assert script.urls == ["https://dashscope.aliyuncs.com/compatible-mode/v1"]
    finished = client.get(f"/api/v1/projects/{project_id}/generation-tasks/{body['id']}")
    assert finished.json()["status"] == "succeeded"
    assert finished.json()["progress"] is None
    asset_id = finished.json()["output_asset_ids"][0]
    content = client.get(f"/api/v1/projects/{project_id}/assets/{asset_id}/content")
    assert content.status_code == 200
    assert content.content == MP4
    assert content.headers["content-type"].startswith("video/mp4")
    assert FAKE_KEY.encode() not in content.content

    unknown = _submit(client, settings, project_id, "a quiet harbor", "video-key-2")
    timeout = ScriptedVideo(fail_submit=True)
    asyncio.run(_run_worker(settings, UUID(unknown.json()["id"]), timeout, storage, poll=False))
    assert timeout.submits == 1
    stalled = client.get(f"/api/v1/projects/{project_id}/generation-tasks/{unknown.json()['id']}")
    assert stalled.json()["status"] == "submitting"
    assert stalled.json()["reconciliation_required"] is True
    asyncio.run(_run_worker(settings, UUID(unknown.json()["id"]), timeout, storage, poll=False))
    assert timeout.submits == 1

    running = _submit(client, settings, project_id, "a quiet harbor", "video-key-3")
    blocked = client.post(
        f"/api/v1/projects/{project_id}/generation-tasks/{unknown.json()['id']}/cancel",
        headers=_mutation_headers(client, settings),
    )
    assert blocked.status_code == 409
    waiting = client.post(
        f"/api/v1/projects/{project_id}/generation-tasks/{running.json()['id']}/cancel",
        headers=_mutation_headers(client, settings),
    )
    assert waiting.status_code == 200
    assert waiting.json()["status"] == "canceled"


def test_dashscope_video_uses_async_origin_and_keeps_the_key_out_of_the_body() -> None:
    seen: dict = {}

    def post(url, api_key, payload, headers, timeout):
        seen["url"] = url
        seen["payload"] = payload
        seen["headers"] = headers
        assert api_key == FAKE_KEY
        return 200, {"output": {"task_id": "provider-task-1", "task_status": "PENDING"}}

    task_id = asyncio.run(
        DashScopeVideo(post=post).submit(
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            api_key=FAKE_KEY,
            model="video-1",
            prompt="a quiet harbor",
            size="1920*1080",
            duration=5,
        )
    )
    assert task_id == "provider-task-1"
    assert seen["url"].endswith("/api/v1/services/aigc/video-generation/video-synthesis")
    assert "compatible-mode" not in seen["url"]
    assert seen["headers"]["X-DashScope-Async"] == "enable"
    assert FAKE_KEY not in json.dumps(seen["payload"])


def _submit(client, settings, project_id: str, prompt: str, key: str, kind: str = "video"):
    return client.post(
        f"/api/v1/projects/{project_id}/generation-tasks",
        json={"prompt": prompt, "parameters": {"duration": 5, "size": "1920*1080"}, "kind": kind},
        headers={**_mutation_headers(client, settings), "Idempotency-Key": key},
    )


async def _image_queued(settings) -> list[UUID]:
    engine = create_db_engine(settings)
    try:
        service = ImageGenerationService(settings, session_factory=create_session_factory(engine))
        return await service.queued_ids()
    finally:
        await engine.dispose()


async def _run_worker(
    settings,
    task_id: UUID,
    client,
    storage: MemoryStorage,
    poll: bool = True,
) -> None:
    engine = create_db_engine(settings)
    try:
        service = VideoGenerationService(
            settings,
            session_factory=create_session_factory(engine),
            client=client,
            storage=storage,
        )
        claimed = await service.claim_queued()
        if task_id in claimed or not poll:
            await service.dispatch(task_id)
        if poll:
            assert await service.claim_due() == []
            await service.poll(task_id)
    finally:
        await engine.dispose()


def test_china_legacy_wire_model_name_and_duration():
    captured = []

    def post(url, key, payload, headers, timeout):
        captured.append(payload)
        return 200, {"output": {"task_id": "safe-task", "task_status": "PENDING"}}

    adapter = DashScopeVideo(post=post)
    asyncio.run(
        adapter.submit(
            base_url="https://workspace.cn-beijing.maas.aliyuncs.com",
            api_key="test",
            model="wan2.1-i2v-turbo",
            prompt="scene",
            size=None,
            duration=4,
            image=b"png",
            resolution="720P",
        )
    )
    assert captured[0]["model"] == "wanx2.1-i2v-turbo"
    assert captured[0]["parameters"]["duration"] == 4
    assert "img_url" in captured[0]["input"]
