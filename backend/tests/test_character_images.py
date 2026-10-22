"""Integration coverage uses real PostgreSQL and an explicit fake image provider/storage."""

import asyncio
from types import SimpleNamespace
from uuid import UUID, uuid4

from app.infrastructure.db.session import create_db_engine, create_session_factory
from app.modules.auth.service import AuthService
from app.modules.characters.images import CharacterImagesService, character_image_prompt
from app.modules.characters.schemas import CharacterInput
from app.modules.characters.service import CharacterService
from app.modules.generation.service import ImageGenerationService
from app.modules.projects.service import ProjectService
from app.modules.stories.service import StoryService
from app.modules.uploads.service import UploadService

from tests.test_identity_projects import PASSWORD, _create_user, _login, _mutation_headers
from tests.test_image_generations import PNG, image_api, migrated_database  # noqa: F401
from tests.test_model_configs import _grant, _publish
from tests.test_stories import _image


def setup(client, settings):
    owner = asyncio.run(_create_user(settings, f"images-{uuid4()}@example.com", PASSWORD))
    _login(client, settings, owner.email, PASSWORD)
    h = _mutation_headers(client, settings)
    project = client.post("/api/v1/projects", json={"name": "电影"}, headers=h).json()["id"]
    root = f"/api/v1/projects/{project}"
    story = client.post(
        root + "/stories", json={"title": "故事", "description": "动漫风格"}, headers=h
    ).json()["id"]
    root += f"/stories/{story}"
    person = client.post(
        root + "/characters", json={"name": "林夕", "title": "医生"}, headers=h
    ).json()
    return owner, h, project, root, person


def test_multiple_images_primary_delete_text_isolation(image_api):  # noqa: F811
    client, settings, _ = image_api
    owner, h, project, root, person = setup(client, settings)
    path = root + f"/characters/{person['id']}"
    uploads = [asyncio.run(_image(settings, owner.id)) for _ in range(3)]
    for upload in uploads:
        result = client.post(path + "/images", json={"upload_id": str(upload)}, headers=h)
        assert result.status_code == 200, result.text
    result = client.post(path + "/images", json={"upload_id": str(uploads[0])}, headers=h)
    images = result.json()["images"]
    assert len(images) == 3 and sum(i["is_primary"] for i in images) == 1
    primary = images[2]["id"]
    switched = client.put(path + f"/images/{primary}/primary", headers=h)
    assert switched.status_code == 200, switched.text
    assert next(i for i in switched.json()["images"] if i["is_primary"])["id"] == primary
    saved = client.patch(
        path, json={"name": "林夕改", "title": "医生", "expected_version": 1}, headers=h
    )
    assert saved.status_code == 200, saved.text
    assert (
        next(i for i in client.get(path + "/images").json()["images"] if i["is_primary"])["id"]
        == primary
    )
    for image in reversed(images):
        result = client.delete(path + f"/images/{image['id']}", headers=h)
        assert result.status_code == 200, result.text
        remaining = result.json()["images"]
        assert sum(i["is_primary"] for i in remaining) == (1 if remaining else 0)
        assert client.delete(path + f"/images/{image['id']}", headers=h).status_code == 200
    assert client.get(path).json()["name"] == "林夕改"
    assert client.get(root + "/character-graph").json()["characters"][0]["avatar_url"] is None


class Images:
    async def generate(self, **kwargs):
        assert "动漫风格" in kwargs["prompt"]
        assert "林夕" in kwargs["prompt"]
        return [(PNG, "image/png")]


def test_generation_worker_binds_without_open_drawer(image_api):  # noqa: F811
    client, settings, storage = image_api
    owner, h, project, root, person = setup(client, settings)
    asyncio.run(_grant(settings, owner.email))
    model = _publish(client, settings, model_name="image-1", capability="text_to_image")
    assert (
        client.put(
            "/api/v1/admin/model-assignments/text_to_image",
            json={"model_config_id": model["id"]},
            headers=h,
        ).status_code
        == 200
    )
    path = root + f"/characters/{person['id']}"
    headers = {**h, "Idempotency-Key": str(uuid4())}
    queued = client.post(path + "/image-generations", json={"mode": "candidate"}, headers=headers)
    assert queued.status_code == 202, queued.text
    task_id = queued.json()["jobs"][0]["task_id"]
    again = client.post(path + "/image-generations", json={"mode": "candidate"}, headers=headers)
    assert len(again.json()["jobs"]) == 1
    denied = client.post(
        path + "/image-generations",
        json={"mode": "candidate"},
        headers={**h, "Idempotency-Key": str(uuid4())},
    )
    assert denied.status_code == 409

    async def work():
        engine = create_db_engine(settings)
        factory = create_session_factory(engine)
        projects = ProjectService(AuthService(settings))
        generation = ImageGenerationService(settings, factory, Images(), storage)
        images = CharacterImagesService(
            CharacterService(projects, StoryService(projects, UploadService(settings))), generation
        )
        try:
            await generation.execute(UUID(task_id))
            await images.collect(factory)
            await images.collect(factory)
        finally:
            await engine.dispose()

    asyncio.run(work())
    state = client.get(path + "/images").json()
    assert state["jobs"][0]["status"] == "succeeded", state
    assert state["jobs"][0]["collected"]
    assert len(state["images"]) == 1
    image = state["images"][0]
    assert image["source"] == "ai_generated" and image["is_primary"]
    assert (
        client.get(root + "/character-graph").json()["characters"][0]["avatar_url"]
        == image["image_url"]
    )
    rejected = client.post(
        path + "/image-generations",
        json={"mode": "reference"},
        headers={**h, "Idempotency-Key": str(uuid4())},
    )
    assert rejected.status_code == 422, rejected.text
    asset_id = image["image_url"].split("/")[-2]
    protected = client.post(f"/api/v1/projects/{project}/assets/{asset_id}/deletion", headers=h)
    assert protected.status_code == 409, protected.text
    # Removing a character while its task is still queued must not resurrect it later.
    second = client.post(root + "/characters", json={"name": "林夕"}, headers=h).json()
    second_path = root + f"/characters/{second['id']}"
    queued = client.post(
        second_path + "/image-generations",
        json={"mode": "candidate"},
        headers={**h, "Idempotency-Key": str(uuid4())},
    )
    assert queued.status_code == 202, queued.text
    task_id = queued.json()["jobs"][0]["task_id"]
    assert client.delete(second_path + "?expected_version=1", headers=h).status_code == 204
    asyncio.run(work())
    assert client.get(second_path + "/images").status_code == 404


def test_prompt_uses_actual_profile_and_style():
    profile = CharacterInput(
        name="林夕", age="20", profile_data={"appearance": {"发型": {"value": "银色短发"}}}
    )
    prompt = character_image_prompt(profile, SimpleNamespace(description="水彩插画"), "全身", False)
    assert all(word in prompt for word in ["银色短发", "水彩插画", "全身", "20"])


def test_concurrent_primary_changes_are_serialized(image_api):  # noqa: F811
    from app.infrastructure.db.session import UnitOfWork

    client, settings, _ = image_api
    owner, h, project, root, person = setup(client, settings)
    path = root + f"/characters/{person['id']}"
    for _ in range(2):
        upload = asyncio.run(_image(settings, owner.id))
        assert (
            client.post(path + "/images", json={"upload_id": str(upload)}, headers=h).status_code
            == 200
        )
    images = client.get(path + "/images").json()["images"]

    async def race():
        engine = create_db_engine(settings)
        factory = create_session_factory(engine)
        projects = ProjectService(AuthService(settings))
        service = CharacterImagesService(
            CharacterService(projects, StoryService(projects, UploadService(settings))),
            ImageGenerationService(settings),
        )

        async def change(image):
            async with factory() as session:
                return await service.mutate(
                    UnitOfWork(session),
                    owner.id,
                    UUID(project),
                    UUID(root.split("/")[-1]),
                    UUID(person["id"]),
                    UUID(image["id"]),
                )

        try:
            await asyncio.gather(*(change(image) for image in images))
        finally:
            await engine.dispose()

    asyncio.run(race())
    current = client.get(path + "/images").json()["images"]
    assert sum(i["is_primary"] for i in current) == 1
    assert client.get(path).json()["version"] == 1
