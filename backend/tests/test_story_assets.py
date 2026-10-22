import asyncio
from uuid import uuid4

from app.infrastructure.db.session import create_db_engine, create_session_factory
from app.infrastructure.storage.objects import QiniuObjectStorage
from app.modules.uploads.models import UploadFile

from tests.test_identity_projects import PASSWORD, _create_user, _login, _mutation_headers
from tests.test_model_configs import api, migrated_database  # noqa: F401


def test_story_library_aggregates_character_images_and_protects_files(api, monkeypatch):  # noqa: F811
    async def prefix(self, *, object_key, max_bytes):  # noqa: ARG001
        return b"\x89PNG\r\n\x1a\n" + b"png"

    monkeypatch.setattr(QiniuObjectStorage, "get_prefix", prefix)
    client, settings = api
    owner = asyncio.run(_create_user(settings, f"library-{uuid4()}@example.com", PASSWORD))
    _login(client, settings, owner.email, PASSWORD)
    headers = _mutation_headers(client, settings)
    project = client.post("/api/v1/projects", json={"name": "资源空间"}, headers=headers)
    project = project.json()["id"]
    other = client.post("/api/v1/projects", json={"name": "其他空间"}, headers=headers).json()["id"]
    story = client.post(
        f"/api/v1/projects/{project}/stories", json={"title": "第一集"}, headers=headers
    ).json()["id"]
    sibling = client.post(
        f"/api/v1/projects/{project}/stories", json={"title": "第二集"}, headers=headers
    ).json()["id"]
    root = f"/api/v1/projects/{project}/stories/{story}/resources"
    portrait = asyncio.run(_upload(settings, owner.id, "linxia.png"))
    created = client.post(
        f"/api/v1/projects/{project}/stories/{story}/characters",
        json={"name": "林夏", "avatar_upload_id": str(portrait)},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    listed = client.get(root)
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["name"] == "林夏"
    assert item["source"] == "upload"
    assert item["upload_id"] == str(portrait)
    assert item["direct_link_id"] is None
    assert item["references"][0]["primary"] is True
    assert item["can_delete"] is False
    assert client.get(root + "?category=character").json()["total"] == 1
    assert client.get(root + "?category=shot").json() == {
        "items": [],
        "total": 0,
        "next_offset": None,
    }
    assert client.get(root + "?search=林夏").json()["total"] == 1
    assert client.get(root + "?category=shot&search=林夏").json()["total"] == 0
    sibling_library = client.get(f"/api/v1/projects/{project}/stories/{sibling}/resources")
    assert sibling_library.json()["total"] == 0
    assert client.get(f"/api/v1/projects/{other}/stories/{story}/resources").status_code == 404
    blocked = client.delete(f"{root}/upload/{portrait}", headers=headers)
    assert blocked.status_code == 409, blocked.text
    note = asyncio.run(_upload(settings, owner.id, "note.png"))
    attached = client.post(
        root,
        json={"upload_id": str(note), "name": "雨夜咖啡馆", "category": "scene"},
        headers=headers,
    )
    assert attached.status_code == 200, attached.text
    assert attached.json()["can_delete"] is True
    again = client.post(
        root,
        json={"upload_id": str(note), "name": "重复", "category": "scene"},
        headers=headers,
    )
    assert again.status_code == 200, again.text
    assert again.json()["name"] == "雨夜咖啡馆"
    page = client.get(root + "?limit=1&sort=name")
    assert page.json()["total"] == 2
    assert page.json()["next_offset"] == 1
    renamed = client.patch(
        f"{root}/upload/{note}", json={"name": "雨夜"}, headers=headers
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "雨夜"
    removed = client.delete(f"{root}/upload/{note}", headers=headers)
    assert removed.status_code == 200, removed.text
    assert removed.json()["removed"] is True
    assert client.get(root + "?search=雨夜").json()["total"] == 0
    linked = client.post(
        root,
        json={"upload_id": str(portrait), "name": "林夏参考", "category": "general"},
        headers=headers,
    )
    assert linked.status_code == 200, linked.text
    assert linked.json()["can_delete"] is False
    denied = client.delete(f"{root}/upload/{portrait}?original=true", headers=headers)
    assert denied.status_code == 409, denied.text
    images = client.get(
        f"/api/v1/projects/{project}/stories/{story}/characters/{created.json()['id']}/images"
    )
    assert images.status_code == 200, images.text
    assert images.json()["images"][0]["is_primary"] is True
    assert client.get(root + "?category=character").json()["total"] == 1


async def _upload(settings, user_id, filename):
    engine = create_db_engine(settings)
    try:
        async with create_session_factory(engine)() as session:
            upload = UploadFile(
                user_id=user_id,
                bucket="media",
                object_key=f"uploads/image/{user_id}/2026/10/{uuid4()}.png",
                url="https://cdn.example/library.png",
                original_filename=filename,
                content_type="image/png",
                size=128,
                category="image",
                status="uploaded",
                provider="qiniu",
            )
            session.add(upload)
            await session.commit()
            return upload.id
    finally:
        await engine.dispose()
