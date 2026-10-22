import asyncio
import json
from uuid import UUID, uuid4

from app.infrastructure.ai.text_completion import TextCompletionService
from app.infrastructure.db.session import create_db_engine, create_session_factory
from app.modules.auth.service import AuthService
from app.modules.characters.service import CharacterService
from app.modules.projects.service import ProjectService
from app.modules.stories.service import StoryService
from app.modules.storyline.ai import PlotAIService
from app.modules.storyline.models import PlotJob
from app.modules.storyline.service import StorylineService
from app.modules.uploads.service import UploadService

from tests.test_identity_projects import PASSWORD, _create_user, _login, _mutation_headers
from tests.test_model_configs import _grant, _publish, api, migrated_database  # noqa: F401
from tests.test_text_completions import text_api  # noqa: F401


def setup(client, settings):
    owner = asyncio.run(_create_user(settings, "plot@example.com", PASSWORD))
    _login(client, settings, owner.email, PASSWORD)
    headers = _mutation_headers(client, settings)
    project = client.post("/api/v1/projects", json={"name": "Plot"}, headers=headers).json()["id"]
    base = f"/api/v1/projects/{project}"
    story = client.post(base + "/stories", json={"title": "雨夜"}, headers=headers).json()["id"]
    return owner, headers, base + f"/stories/{story}", project


def test_crud_references_versions_sort_and_cascade(api):  # noqa: F811
    client, settings = api
    owner, h, base, project = setup(client, settings)
    root = base + "/plot"
    assert client.get(root + "/chapters").json() == {"version": 1, "items": []}
    c = client.post(root + "/chapters", json={"title": "初遇"}, headers=h).json()
    other = client.post(root + "/chapters", json={"title": "秘密"}, headers=h).json()
    order = client.get(root + "/chapters").json()
    assert (
        client.put(
            root + "/chapters/order",
            json={"ids": [other["id"], c["id"]], "expected_version": order["version"]},
            headers=h,
        ).status_code
        == 204
    )
    assert (
        client.put(
            root + "/chapters/order",
            json={"ids": [c["id"], other["id"]], "expected_version": order["version"]},
            headers=h,
        ).status_code
        == 409
    )
    person = client.post(base + "/characters", json={"name": "林夏"}, headers=h).json()
    block = {
        "id": str(uuid4()),
        "type": "dialogue",
        "character_id": person["id"],
        "content": "好久不见",
    }
    payload = {"title": "咖啡馆", "character_ids": [person["id"]], "blocks": [block]}
    scene = client.post(root + f"/chapters/{c['id']}/scenes", json=payload, headers=h)
    assert scene.status_code == 201, scene.text
    scene = scene.json()
    url = root + "/scenes/" + scene["id"]
    assert (
        client.patch(
            url, json={**payload, "expected_version": 1, "title": "新标题"}, headers=h
        ).status_code
        == 200
    )
    assert client.patch(url, json={**payload, "expected_version": 1}, headers=h).status_code == 409
    assert (
        client.patch(
            url, json={**payload, "expected_version": 2, "character_ids": [str(uuid4())]}, headers=h
        ).status_code
        == 422
    )
    assert (
        client.delete(
            base + f"/characters/{person['id']}?expected_version=1", headers=h
        ).status_code
        == 204
    )
    assert client.patch(url, json={**payload, "expected_version": 2}, headers=h).status_code == 200
    assert client.get(url).json()["blocks"][0]["content"] == "好久不见"
    other_story = client.post(
        f"/api/v1/projects/{project}/stories", json={"title": "别的剧本"}, headers=h
    ).json()["id"]
    assert (
        client.get(
            f"/api/v1/projects/{project}/stories/{other_story}/plot/scenes/{scene['id']}"
        ).status_code
        == 404
    )
    assert (
        client.delete(root + f"/chapters/{c['id']}?expected_version=1", headers=h).status_code
        == 204
    )
    assert client.get(url).status_code == 404
    outsider = asyncio.run(_create_user(settings, "outsider-plot@example.com", PASSWORD))
    _login(client, settings, outsider.email, PASSWORD)
    assert client.get(root + "/chapters").status_code in [403, 404]


class FakePlotClient:
    """Explicit test provider; never used by runtime."""

    def __init__(self, content):
        self.content = content

    async def complete(self, **kwargs):
        return self.content


async def execute(settings, job_id, result):
    engine = create_db_engine(settings)
    factory = create_session_factory(engine)
    projects = ProjectService(AuthService(settings))
    stories = StoryService(projects, UploadService(settings))
    service = TextCompletionService(settings, factory, FakePlotClient(json.dumps(result)))
    ai = PlotAIService(StorylineService(stories, CharacterService(projects, stories)), service)
    async with factory() as session:
        job = await session.get(PlotJob, UUID(job_id))
        completion = job.completion_id
    await service.execute(completion)
    await ai.collect(factory)
    await engine.dispose()


def test_ai_preview_idempotence_and_explicit_append(text_api):  # noqa: F811
    client, settings = text_api
    owner, h, base, _ = setup(client, settings)
    asyncio.run(_grant(settings, owner.email))
    model = _publish(client, settings, model_name="gpt-4o", capability="text_generation")
    assert (
        client.put(
            "/api/v1/admin/model-assignments/text_generation",
            json={"model_config_id": model["id"]},
            headers=h,
        ).status_code
        == 200
    )
    root = base + "/plot"
    payload = {"idea": "雨夜重逢", "chapter_count": 1, "depth": "structure"}
    headers = {**h, "Idempotency-Key": "plot-1"}
    response = client.post(root + "/jobs", json=payload, headers=headers)
    assert response.status_code == 202, response.text
    job = response.json()
    assert client.post(root + "/jobs", json=payload, headers=headers).json()["id"] == job["id"]
    result = {
        "chapters": [
            {"title": "初遇", "summary": "雨夜", "scenes": [{"title": "咖啡馆", "summary": "重逢"}]}
        ],
        "blocks": [],
    }
    asyncio.run(execute(settings, job["id"], result))
    assert client.get(root + "/jobs").json()[0]["status"] == "succeeded"
    assert client.get(root + "/chapters").json()["items"] == []
    apply = root + f"/jobs/{job['id']}/apply"
    response = client.post(apply, json={"result": result}, headers=h)
    assert response.status_code == 200, response.text
    assert client.post(apply, json={"result": result}, headers=h).status_code == 200
    assert len(client.get(root + "/chapters").json()["items"]) == 1


def test_invalid_output_is_repaired_once(text_api):  # noqa: F811
    client, settings = text_api
    owner, h, base, _ = setup(client, settings)
    asyncio.run(_grant(settings, owner.email))
    model = _publish(client, settings, model_name="gpt-4o", capability="text_generation")
    client.put(
        "/api/v1/admin/model-assignments/text_generation",
        json={"model_config_id": model["id"]},
        headers=h,
    )
    root = base + "/plot"
    job = client.post(
        root + "/jobs",
        json={"idea": "故事", "chapter_count": 1},
        headers={**h, "Idempotency-Key": "bad"},
    ).json()
    asyncio.run(execute(settings, job["id"], {"bad": True}))
    assert client.get(root + "/jobs").json()[0]["status"] == "queued"
    asyncio.run(execute(settings, job["id"], {"bad": True}))
    assert client.get(root + "/jobs").json()[0]["status"] == "failed"
    assert client.get(root + "/chapters").json()["items"] == []


def test_ai_local_apply_rejects_newer_human_edit(text_api):  # noqa: F811
    client, settings = text_api
    owner, h, base, _ = setup(client, settings)
    asyncio.run(_grant(settings, owner.email))
    model = _publish(client, settings, model_name="gpt-4o", capability="text_generation")
    client.put(
        "/api/v1/admin/model-assignments/text_generation",
        json={"model_config_id": model["id"]},
        headers=h,
    )
    root = base + "/plot"
    chapter = client.post(root + "/chapters", json={"title": "初遇"}, headers=h).json()
    block = {"id": str(uuid4()), "type": "action", "content": "走进咖啡馆"}
    payload = {"title": "雨夜", "blocks": [block]}
    scene = client.post(root + f"/chapters/{chapter['id']}/scenes", json=payload, headers=h).json()
    request = {
        "idea": "丰富动作",
        "operation": "action",
        "scene_id": scene["id"],
        "block_id": block["id"],
        "expected_version": 1,
    }
    job = client.post(
        root + "/jobs", json=request, headers={**h, "Idempotency-Key": "local"}
    ).json()
    result = {
        "chapters": [],
        "blocks": [{"id": str(uuid4()), "type": "action", "content": "她推开门，抖落肩上的雨水。"}],
    }
    asyncio.run(execute(settings, job["id"], result))
    assert (
        client.patch(
            root + "/scenes/" + scene["id"],
            json={**payload, "title": "人工修改", "expected_version": 1},
            headers=h,
        ).status_code
        == 200
    )
    assert (
        client.post(
            root + f"/jobs/{job['id']}/apply", json={"result": result}, headers=h
        ).status_code
        == 409
    )
    assert client.get(root + "/scenes/" + scene["id"]).json()["title"] == "人工修改"
    assert not client.get(root + "/jobs").json()[0]["applied"]
