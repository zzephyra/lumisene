import asyncio
import json
import os
from uuid import UUID

import pytest
from alembic import command
from alembic.config import Config
from app.api.deps import get_text_completion_service
from app.core.config import get_settings
from app.infrastructure.ai.adapters.openai_compatible import OpenAICompatibleChat
from app.infrastructure.ai.text_completion import ChatClient, TextCompletionService
from app.infrastructure.db.session import create_db_engine, create_session_factory
from app.main import create_app
from fastapi.testclient import TestClient
from pydantic import ValidationError as SettingsValidation

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
from tests.test_model_configs import LEAKED_KEY, _grant, _publish, _truncate

TEST_DATABASE_URL = "postgresql+asyncpg://fluxora:fluxora@127.0.0.1:5432/fluxora_test"

FAKE_KEY = "test-key-not-real"
ENDPOINT = json.dumps(
    {
        "openai_api_key": {
            "base_url": "https://example.test/v1",
            "api_key": FAKE_KEY,
        }
    }
)


class ExplodingChat:
    async def complete(self, *, base_url: str, api_key: str, model: str, prompt: str) -> str:
        raise AssertionError("submit must not call the provider")


class RecordingChat:
    def __init__(self, content: str) -> None:
        self.content = content
        self.api_keys: list[str] = []

    async def complete(self, *, base_url: str, api_key: str, model: str, prompt: str) -> str:
        self.api_keys.append(api_key)
        assert prompt == "hello from the project"
        assert model == "gpt-4o"
        assert base_url == "https://example.test/v1"
        return self.content


@pytest.fixture(scope="module")
def migrated_database() -> str:
    try:
        asyncio.run(_ensure_database())
    except OSError as exc:
        pytest.fail(f"PostgreSQL is required for text completion tests: {exc}")
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
def text_api(migrated_database: str):
    asyncio.run(_reset(migrated_database))
    settings = make_settings(
        database_url=migrated_database,
        csrf_secret="test-csrf-secret-value-with-32b",
        cors_allowed_origins=[ORIGIN],
        model_secret_refs="openai_api_key,local_model_secret",
        model_endpoints=ENDPOINT,
    )
    app = create_app(settings)
    app.dependency_overrides[get_text_completion_service] = lambda: TextCompletionService(
        settings,
        client=ExplodingChat(),
    )
    with TestClient(app) as client:
        yield client, settings


def test_settings_hide_the_endpoint_secret() -> None:
    settings = make_settings(
        model_secret_refs="openai_api_key",
        model_endpoints=ENDPOINT,
    )
    assert FAKE_KEY not in repr(settings)
    assert settings.model_endpoint("openai_api_key") == ("https://example.test/v1", FAKE_KEY)
    assert settings.model_endpoint("local_model_secret") is None
    broken = '{"openai_api_key": {"api_key": "' + LEAKED_KEY
    with pytest.raises(SettingsValidation) as captured:
        make_settings(model_secret_refs="openai_api_key", model_endpoints=broken)
    assert LEAKED_KEY not in str(captured.value)


def test_yaml_file_names_the_selectable_secrets(tmp_path) -> None:
    secret = "yaml-key-not-real"
    path = tmp_path / "model-endpoints.yaml"
    path.write_text(
        "qianwen:\n  base_url: https://example.test/v1\n  api_key: " + secret + "\n",
        encoding="utf-8",
    )
    settings = make_settings(model_endpoints_file=str(path))
    assert settings.configured_secret_refs() == frozenset({"qianwen"})
    assert settings.model_endpoint("qianwen") == ("https://example.test/v1", secret)
    assert settings.provider_catalog() == []
    assert secret not in repr(settings)
    broken = tmp_path / "broken.yaml"
    broken.write_text("qianwen: [" + secret, encoding="utf-8")
    with pytest.raises(SettingsValidation) as captured:
        make_settings(model_endpoints_file=str(broken))
    assert secret not in str(captured.value)


def test_provider_catalog_rereads_added_models(tmp_path) -> None:
    path = tmp_path / "model-endpoints.yaml"
    path.write_text(
        "qianwen:\n  base_url: https://example.test/v1\n  api_key: secret-a\n",
        encoding="utf-8",
    )
    settings = make_settings(model_endpoints_file=str(path))
    assert settings.provider_catalog() == []
    path.write_text(
        "\n".join(
            [
                "qianwen:",
                "  base_url: https://example.test/v1",
                "  api_key: secret-a",
                "  alias:",
                "    zh: 千问",
                "    en: Qianwen",
                "  models:",
                "    qwen-plus:",
                "      capabilities: [text_generation]",
                "      parameters: {}",
            ]
        ),
        encoding="utf-8",
    )
    catalog = settings.provider_catalog()
    assert catalog[0]["alias_zh"] == "千问"
    assert catalog[0]["models"][0]["name"] == "qwen-plus"
    assert catalog[0]["models"][0]["inputs"] == []
    assert "secret-a" not in str(catalog)


def test_provider_catalog_publishes_declared_input_modalities(tmp_path) -> None:
    path = tmp_path / "model-endpoints.yaml"
    path.write_text(
        "\n".join(
            [
                "wan_video:",
                "  base_url: https://example.test/v1",
                "  api_key: secret-not-shown",
                "  models:",
                "    wan3.0-video:",
                "      capabilities: [text_to_video]",
                "      inputs: [text, image, video, audio]",
                "      parameters: {}",
            ]
        ),
        encoding="utf-8",
    )
    catalog = make_settings(model_endpoints_file=str(path)).provider_catalog()
    assert catalog[0]["models"][0]["inputs"] == ["text", "image", "video", "audio"]
    assert "secret-not-shown" not in str(catalog)
    path.write_text(
        "\n".join(
            [
                "wan_video:",
                "  base_url: https://example.test/v1",
                "  api_key: secret-not-shown",
                "  models:",
                "    wan3.0-video:",
                "      capabilities: [text_to_video]",
                "      inputs: [file]",
                "      parameters: {}",
            ]
        ),
        encoding="utf-8",
    )
    with pytest.raises(SettingsValidation):
        make_settings(model_endpoints_file=str(path))


def test_queue_does_not_call_provider_and_worker_stores_the_reply(text_api) -> None:
    client, settings = text_api
    owner = asyncio.run(_create_user(settings, "owner@example.com", PASSWORD))
    outsider = asyncio.run(_create_user(settings, "outsider@example.com", PASSWORD))
    _login(client, settings, owner.email, PASSWORD)
    project_id = client.post(
        "/api/v1/projects",
        json={"name": "Film"},
        headers=_mutation_headers(client, settings),
    ).json()["id"]
    asyncio.run(_grant(settings, owner.email))
    model = _publish(client, settings, model_name="gpt-4o", capability="text_generation")
    video = _publish(client, settings, model_name="video-1", capability="text_to_video")
    missing_secret = client.post(
        "/api/v1/admin/model-configs",
        json={
            "provider": "local",
            "model_name": "unwired",
            "capability": "text_generation",
            "parameters_schema": {},
            "limits": {},
            "secret_ref": "local_model_secret",
        },
        headers=_mutation_headers(client, settings),
    )
    assert missing_secret.status_code == 201

    leaked = client.post(
        f"/api/v1/projects/{project_id}/text-completions",
        json={"model_config_id": model["id"], "prompt": "hello", "api_key": LEAKED_KEY},
        headers=_mutation_headers(client, settings),
    )
    assert leaked.status_code == 422
    assert LEAKED_KEY not in leaked.text
    assert FAKE_KEY not in leaked.text
    unassigned = client.post(
        f"/api/v1/projects/{project_id}/text-completions",
        json={"prompt": "hello"},
        headers=_mutation_headers(client, settings),
    )
    assert unassigned.status_code == 422
    mismatch = client.put(
        "/api/v1/admin/model-assignments/text_generation",
        json={"model_config_id": video["id"]},
        headers=_mutation_headers(client, settings),
    )
    assert mismatch.status_code == 422
    assigned = client.put(
        "/api/v1/admin/model-assignments/text_generation",
        json={"model_config_id": model["id"]},
        headers=_mutation_headers(client, settings),
    )
    assert assigned.status_code == 200

    queued = client.post(
        f"/api/v1/projects/{project_id}/text-completions",
        json={"prompt": " hello from the project "},
        headers=_mutation_headers(client, settings),
    )
    assert queued.status_code == 202
    body = queued.json()
    assert body["status"] == "queued"
    assert body["content"] is None
    assert body["error"] is None
    assert FAKE_KEY not in queued.text
    assert "prompt" not in body

    recorder = RecordingChat("model says hello")
    asyncio.run(_execute(settings, UUID(body["id"]), recorder, repeat=True))
    assert recorder.api_keys == [FAKE_KEY]

    finished = client.get(f"/api/v1/projects/{project_id}/text-completions/{body['id']}")
    assert finished.status_code == 200
    assert finished.json() == {
        "id": body["id"],
        "status": "succeeded",
        "content": "model says hello",
        "error": None,
    }
    assert FAKE_KEY not in finished.text

    unwired_assignment = client.put(
        "/api/v1/admin/model-assignments/text_generation",
        json={"model_config_id": missing_secret.json()["id"]},
        headers=_mutation_headers(client, settings),
    )
    assert unwired_assignment.status_code == 200
    unwired = client.post(
        f"/api/v1/projects/{project_id}/text-completions",
        json={"prompt": "hello"},
        headers=_mutation_headers(client, settings),
    )
    assert unwired.status_code == 422
    assert FAKE_KEY not in unwired.text
    restored = client.put(
        "/api/v1/admin/model-assignments/text_generation",
        json={"model_config_id": model["id"]},
        headers=_mutation_headers(client, settings),
    )
    assert restored.status_code == 200

    failing = client.post(
        f"/api/v1/projects/{project_id}/text-completions",
        json={"prompt": "hello from the project"},
        headers=_mutation_headers(client, settings),
    )
    assert failing.status_code == 202

    def reject(url: str, api_key: str, payload: dict, timeout: float) -> tuple[int, object]:
        assert api_key == FAKE_KEY
        return 401, {"error": LEAKED_KEY, "api_key": api_key}

    asyncio.run(
        _execute(
            settings,
            UUID(failing.json()["id"]),
            OpenAICompatibleChat(post=reject),
        )
    )
    failed = client.get(f"/api/v1/projects/{project_id}/text-completions/{failing.json()['id']}")
    assert failed.status_code == 200
    assert failed.json()["status"] == "failed"
    assert failed.json()["error"]["code"] == "provider_error"
    assert LEAKED_KEY not in failed.text
    assert FAKE_KEY not in failed.text

    _login(client, settings, outsider.email, PASSWORD)
    hidden = client.post(
        f"/api/v1/projects/{project_id}/text-completions",
        json={"prompt": "hello"},
        headers=_mutation_headers(client, settings),
    )
    assert hidden.status_code == 404
    missing = client.get(f"/api/v1/projects/{project_id}/text-completions/{body['id']}")
    assert missing.status_code == 404
    assert FAKE_KEY not in missing.text


async def _reset(database_url: str) -> None:
    await _truncate(database_url)


async def _execute(
    settings,
    completion_id: UUID,
    client: ChatClient,
    *,
    repeat: bool = False,
) -> None:
    engine = create_db_engine(settings)
    try:
        service = TextCompletionService(
            settings,
            session_factory=create_session_factory(engine),
            client=client,
        )
        await service.execute(completion_id)
        if repeat:
            await service.execute(completion_id)
    finally:
        await engine.dispose()
