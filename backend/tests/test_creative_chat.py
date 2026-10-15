"""Real DB conversation tests; no paid provider calls."""

import asyncio
from uuid import UUID, uuid4

from app.infrastructure.ai.chat_contract import ChatAnswer
from app.infrastructure.db.session import create_db_engine, create_session_factory
from app.modules.auth.service import AuthService
from app.modules.chat.service import ChatService
from app.modules.projects.service import ProjectService

from tests.test_identity_projects import PASSWORD, _create_user, _login, _mutation_headers
from tests.test_model_configs import _grant, _publish
from tests.test_text_completions import migrated_database, text_api  # noqa: F401


def test_conversation_idempotency_context_and_project_isolation(text_api, monkeypatch):  # noqa: F811
    client, settings = text_api
    owner = asyncio.run(_create_user(settings, "chat@example.com", PASSWORD))
    _login(client, settings, owner.email, PASSWORD)
    headers = _mutation_headers(client, settings)
    project = client.post("/api/v1/projects", json={"name": "Chat"}, headers=headers).json()["id"]
    asyncio.run(_grant(settings, owner.email))
    model = _publish(client, settings, model_name="deepseek-chat", capability="text_generation")
    assert (
        client.put(
            "/api/v1/admin/model-assignments/text_generation",
            json={"model_config_id": model["id"]},
            headers=headers,
        ).status_code
        == 200
    )
    base = f"/api/v1/projects/{project}/conversations"
    cid = str(uuid4())
    assert client.post(base, json={"id": cid, "title": "小猫"}, headers=headers).status_code == 201
    route = f"{base}/{cid}/turns"
    body = {"request_id": str(uuid4()), "prompt": "我想画一只白色小猫"}
    first = client.post(route, json=body, headers=headers)
    assert first.status_code == 202, first.text
    assert client.post(route, json=body, headers=headers).json()["id"] == first.json()["id"]
    assert (
        client.post(route, json={**body, "prompt": "不同输入"}, headers=headers).status_code == 409
    )
    assert (
        client.post(route, json={**body, "request_id": str(uuid4())}, headers=headers).status_code
        == 409
    )
    seen = []

    class FakeChat:
        async def converse(self, **kwargs):
            seen.append(kwargs["messages"])
            return ChatAnswer(
                reply="请确认图片方案",
                intent="image_generation",
                generation_prompt="白色小猫，水彩画风",
            )

    async def execute(turn_id):
        engine = create_db_engine(settings)
        try:
            service = ChatService(
                settings,
                ProjectService(AuthService(settings)),
                create_session_factory(engine),
                FakeChat(),
            )
            await service.execute(UUID(turn_id))
            await service.execute(UUID(turn_id))
        finally:
            await engine.dispose()

    # Inline generation uses the existing task service and persists one association.
    for key, value in {
        "s3_endpoint_url": "http://localhost:9000",
        "s3_bucket": "test",
        "s3_access_key_id": "test",
        "s3_secret_access_key": "test",
    }.items():
        monkeypatch.setattr(settings, key, value)
    image_model = _publish(client, settings, model_name="image-test", capability="text_to_image")
    assert (
        client.put(
            "/api/v1/admin/model-assignments/text_to_image",
            json={"model_config_id": image_model["id"]},
            headers=headers,
        ).status_code
        == 200
    )
    asyncio.run(execute(first.json()["id"]))
    assert len(seen) == 1
    result = client.get(route).json()[0]
    assert result["status"] == "succeeded"
    assert result["proposal"]["intent"] == "image_generation"
    assert result["generation_task_id"] is not None
    image_route = f"{route}/{first.json()['id']}/image"
    generated = client.post(image_route, headers=headers)
    assert generated.status_code == 200, generated.text
    task_id = generated.json()["generation_task_id"]
    assert task_id
    assert client.post(image_route, headers=headers).json()["generation_task_id"] == task_id
    assert client.get(route).json()[0]["generation_task_id"] == task_id
    tasks = client.get(f"/api/v1/projects/{project}/generation-tasks").json()["items"]
    assert len(tasks) == 1
    assert tasks[0]["status"] == "queued"
    next_turn = client.post(
        route, json={"request_id": str(uuid4()), "prompt": "改成水彩画风"}, headers=headers
    ).json()
    asyncio.run(execute(next_turn["id"]))
    assert seen[1][0] == {"role": "user", "content": body["prompt"]}
    assert seen[1][-1]["content"] == "改成水彩画风"
    other = client.post("/api/v1/projects", json={"name": "Other"}, headers=headers).json()["id"]
    assert client.get(f"/api/v1/projects/{other}/conversations/{cid}/turns").status_code == 404
    outsider = asyncio.run(_create_user(settings, "chat-outsider@example.com", PASSWORD))
    _login(client, settings, outsider.email, PASSWORD)
    assert client.get(route).status_code == 404
    assert client.post(image_route, headers=_mutation_headers(client, settings)).status_code == 404
