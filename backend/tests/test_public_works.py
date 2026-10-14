"""Real PostgreSQL publication lifecycle, fake object storage, no model calls."""

import asyncio
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from app.infrastructure.db.session import create_db_engine, create_session_factory
from app.modules.auth.models import User
from app.modules.generation.models import Asset
from app.modules.projects.models import Project
from sqlalchemy import update

from tests.test_identity_projects import PASSWORD, _create_user, _login, _mutation_headers
from tests.test_image_generations import image_api, migrated_database  # noqa: F401


def prepare(client, settings, storage):
    owner = asyncio.run(_create_user(settings, "public-author@example.com", PASSWORD))
    _login(client, settings, owner.email, PASSWORD)
    project = client.post(
        "/api/v1/projects",
        json={"name": "Private project"},
        headers=_mutation_headers(client, settings),
    ).json()["id"]
    asset_id = uuid4()

    async def seed():
        engine = create_db_engine(settings)
        try:
            async with create_session_factory(engine)() as session:
                session.add(
                    Asset(
                        id=asset_id,
                        project_id=UUID(project),
                        created_by=owner.id,
                        kind="IMAGE",
                        status="ready",
                        object_key=str(asset_id),
                        mime="image/png",
                        sha256="0" * 64,
                        size_bytes=6,
                        width=200,
                        height=300,
                    )
                )
                await session.commit()
        finally:
            await engine.dispose()

    asyncio.run(seed())
    storage.objects[str(asset_id)] = (b"pixels", "image/png")
    return owner, project, str(asset_id)


def test_publication_is_opt_in_and_revocable(image_api):  # noqa: F811
    client, settings, storage = image_api
    owner, project, asset = prepare(client, settings, storage)
    public = f"/api/v1/public/users/{owner.id}/works"
    content = f"{public}/{asset}/content"
    endpoint = f"/api/v1/projects/{project}/assets/{asset}/publication"
    assert client.get(public).json() == []
    assert client.get(content).status_code == 404
    assert client.patch(endpoint, json={"public": True}).status_code == 403
    published = client.patch(
        endpoint, json={"public": True}, headers=_mutation_headers(client, settings)
    )
    assert published.status_code == 200, published.text
    client.cookies.clear()
    row = client.get(public).json()[0]
    assert set(row) == {"id", "kind", "width", "height", "published_at"}
    assert client.get(content).content == b"pixels"
    assert client.get(content, headers={"Range": "bytes=1-3"}).content == b"ixe"
    assert client.get(f"/api/v1/projects/{project}/assets/{asset}/content").status_code == 401
    _login(client, settings, owner.email, PASSWORD)
    assert (
        client.patch(
            endpoint, json={"public": False}, headers=_mutation_headers(client, settings)
        ).status_code
        == 200
    )
    assert client.get(public).json() == []
    assert client.get(content).status_code == 404


@pytest.mark.parametrize("hidden", ["deleted", "project", "user"])
def test_hidden_sources_never_appear_publicly(image_api, hidden):  # noqa: F811
    client, settings, storage = image_api
    owner, project, asset = prepare(client, settings, storage)
    endpoint = f"/api/v1/projects/{project}/assets/{asset}/publication"
    assert (
        client.patch(
            endpoint, json={"public": True}, headers=_mutation_headers(client, settings)
        ).status_code
        == 200
    )

    async def hide():
        engine = create_db_engine(settings)
        try:
            async with create_session_factory(engine)() as session:
                if hidden == "deleted":
                    await session.execute(
                        update(Asset)
                        .where(Asset.id == UUID(asset))
                        .values(status="deleted", deleted_at=datetime.now(UTC))
                    )
                elif hidden == "project":
                    await session.execute(
                        update(Project)
                        .where(Project.id == UUID(project))
                        .values(deleted_at=datetime.now(UTC))
                    )
                else:
                    await session.execute(
                        update(User).where(User.id == owner.id).values(status="disabled")
                    )
                await session.commit()
        finally:
            await engine.dispose()

    asyncio.run(hide())
    client.cookies.clear()
    url = f"/api/v1/public/users/{owner.id}/works"
    response = client.get(url)
    assert response.status_code == 404 if hidden == "user" else response.json() == []
    assert client.get(f"{url}/{asset}/content").status_code == 404


def test_another_user_cannot_publish_asset(image_api):  # noqa: F811
    client, settings, storage = image_api
    owner, project, asset = prepare(client, settings, storage)
    stranger = asyncio.run(_create_user(settings, "other@example.com", PASSWORD))
    _login(client, settings, stranger.email, PASSWORD)
    endpoint = f"/api/v1/projects/{project}/assets/{asset}/publication"
    assert (
        client.patch(
            endpoint, json={"public": True}, headers=_mutation_headers(client, settings)
        ).status_code
        == 404
    )
    assert client.get(f"/api/v1/public/users/{owner.id}/works").json() == []
