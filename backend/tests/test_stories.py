import asyncio
from uuid import uuid4

from app.infrastructure.db.session import create_db_engine, create_session_factory
from app.modules.uploads.models import UploadFile

from tests.test_identity_projects import PASSWORD, _create_user, _login, _mutation_headers
from tests.test_model_configs import api, migrated_database  # noqa: F401


def test_story_crud_order_cover_and_project_scope(api):  # noqa: F811
    client, settings = api
    owner = asyncio.run(_create_user(settings, f"story-{uuid4()}@example.com", PASSWORD))
    _login(client, settings, owner.email, PASSWORD)
    headers = _mutation_headers(client, settings)
    project = client.post("/api/v1/projects", json={"name": "剧本空间"}, headers=headers)
    project = project.json()["id"]
    other = client.post("/api/v1/projects", json={"name": "其他空间"}, headers=headers)
    other = other.json()["id"]
    root = f"/api/v1/projects/{project}"
    first = client.post(root + "/stories", json={"title": " 第一集 "}, headers=headers)
    assert first.status_code == 201, first.text
    first = first.json()
    assert first["title"] == "第一集"
    assert first["cover_url"] is None
    second = client.post(
        root + "/stories",
        json={"title": "第二集", "description": "雨夜重逢"},
        headers=headers,
    ).json()
    listed = client.get(root + "/stories?limit=1").json()
    assert listed["items"][0]["id"] == second["id"]
    assert listed["next_cursor"]
    edited = client.patch(
        root + "/stories/" + first["id"],
        json={"title": "第一集", "description": "改过的介绍", "expected_version": 1},
        headers=headers,
    )
    assert edited.status_code == 200, edited.text
    assert (
        client.patch(
            root + "/stories/" + first["id"],
            json={"title": "第一集", "expected_version": 1},
            headers=headers,
        ).status_code
        == 409
    )
    ordered = client.get(root + "/stories").json()["items"]
    assert [item["title"] for item in ordered] == ["第一集", "第二集"]
    assert client.get(f"/api/v1/projects/{other}/stories/{first['id']}").status_code == 404
    cover = asyncio.run(_image(settings, owner.id))
    other_user = asyncio.run(_create_user(settings, f"cover-{uuid4()}@example.com", PASSWORD))
    stranger = asyncio.run(_image(settings, other_user.id))
    covered = client.patch(
        root + "/stories/" + second["id"],
        json={
            "title": "第二集",
            "cover_upload_id": str(cover),
            "expected_version": second["version"],
        },
        headers=headers,
    )
    assert covered.status_code == 200, covered.text
    assert covered.json()["cover_url"] == "https://cdn.example/cover.png"
    assert (
        client.post(
            root + "/stories",
            json={"title": "无效封面", "cover_upload_id": str(stranger)},
            headers=headers,
        ).status_code
        == 404
    )
    assert (
        client.delete(
            root + "/stories/" + first["id"] + "?expected_version=2", headers=headers
        ).status_code
        == 204
    )
    assert client.get(root + "/stories/" + first["id"]).status_code == 404


async def _image(settings, user_id):
    engine = create_db_engine(settings)
    try:
        async with create_session_factory(engine)() as session:
            upload = UploadFile(
                user_id=user_id,
                bucket="media",
                object_key=f"image/{user_id}/{uuid4()}.png",
                url="https://cdn.example/cover.png",
                original_filename="cover.png",
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
