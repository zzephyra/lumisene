import asyncio
from uuid import UUID

from app.infrastructure.ai.skills import Skill, SkillRevision
from app.infrastructure.db.session import create_db_engine, create_session_factory
from sqlalchemy import select

from tests.test_identity_projects import PASSWORD, _create_user, _login, _mutation_headers
from tests.test_model_configs import _grant, api, migrated_database  # noqa: F401

BODY = dict(
    slug="cinematic-storyboard",
    name="电影分镜",
    description="连续镜头提示词",
    content="# Skill\nCompose a storyboard.",
)


def login(client, settings, admin=True):
    owner = asyncio.run(_create_user(settings, "skills@example.com", PASSWORD))
    _login(client, settings, owner.email, PASSWORD)
    if admin:
        asyncio.run(_grant(settings, owner.email))
    return _mutation_headers(client, settings)


def test_skill_lifecycle_persistence_revision_conflicts_and_search(api):  # noqa: F811
    client, settings = api
    headers = login(client, settings)
    route = "/api/v1/admin/skills"
    made = client.post(route, json=BODY, headers=headers)
    assert made.status_code == 201, made.text
    row = made.json()
    assert row["enabled"] is False and row["version"] == 1
    assert client.get(f"{route}/{row['id']}").json()["content"] == BODY["content"]
    assert client.post(route, json=BODY, headers=headers).status_code == 409
    assert client.get(route, params={"q": "分镜", "enabled": False}).json()["total"] == 1
    assert client.get(route, params={"q": "%"}).json()["total"] == 0
    path = f"{route}/{row['id']}"
    patch = {k: row[k] for k in ("name", "description", "content", "enabled")}
    patch.update(expected_version=1, enabled=True)
    updated = client.patch(path, json=patch, headers=headers)
    assert updated.status_code == 200, updated.text
    assert updated.json()["version"] == 2
    assert client.patch(path, json=patch, headers=headers).status_code == 409
    patch.update(expected_version=2, content="new instructions", enabled=False)
    assert client.patch(path, json=patch, headers=headers).json()["version"] == 3
    assert client.delete(path, params={"expected_version": 2}, headers=headers).status_code == 409
    assert client.delete(path, params={"expected_version": 3}, headers=headers).status_code == 204
    assert client.get(path).status_code == 404
    assert client.get(route).json()["total"] == 0

    async def check():
        engine = create_db_engine(settings)
        try:
            async with create_session_factory(engine)() as session:
                stored = await session.get(Skill, UUID(row["id"]))
                assert stored.deleted_at and not stored.enabled
                versions = (
                    await session.scalars(
                        select(SkillRevision)
                        .where(SkillRevision.skill_id == stored.id)
                        .order_by(SkillRevision.version)
                    )
                ).all()
                assert [v.action for v in versions] == ["created", "enabled", "disabled", "deleted"]
                assert versions[0].content == BODY["content"]
                assert versions[-1].content == "new instructions"
        finally:
            await engine.dispose()

    asyncio.run(check())


def test_skill_authorization_csrf_validation_and_pagination(api):  # noqa: F811
    client, settings = api
    headers = login(client, settings, admin=False)
    route = "/api/v1/admin/skills"
    assert client.get(route).status_code == 404
    assert client.post(route, json=BODY, headers=headers).status_code == 404
    asyncio.run(_grant(settings, "skills@example.com"))
    assert client.post(route, json=BODY).status_code == 403
    assert client.post(route, json={**BODY, "content": "   "}, headers=headers).status_code == 422
    assert client.post(route, json={**BODY, "slug": "../bad"}, headers=headers).status_code == 422
    assert client.post(route, json={**BODY, "enabled": True}, headers=headers).status_code == 422
    for i in range(3):
        assert (
            client.post(route, json={**BODY, "slug": f"skill-{i}"}, headers=headers).status_code
            == 201
        )
    result = client.get(route, params={"limit": 2, "offset": 2}).json()
    assert result["total"] == 3 and len(result["items"]) == 1


def test_retired_outpaint_binding_cannot_be_created(api):
    client, settings = api
    headers = login(client, settings)
    result = client.post("/api/v1/admin/skills", json={**BODY, "runtime_key":"image.outpainting"}, headers=headers)
    assert result.status_code == 422
