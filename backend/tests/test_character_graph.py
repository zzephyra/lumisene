import asyncio
import base64
from uuid import UUID, uuid4

import pytest
from app.core.errors import ValidationError
from app.infrastructure.db.session import create_db_engine, create_session_factory
from app.infrastructure.parsing.parser import parse_document, split_text
from app.modules.auth.service import AuthService
from app.modules.characters.analysis import AnalysisService
from app.modules.characters.analysis_contract import Extraction
from app.modules.characters.router import analysis_service
from app.modules.projects.service import ProjectService
from app.modules.stories.service import StoryService
from app.modules.uploads.service import UploadService

from tests.test_identity_projects import PASSWORD, _create_user, _login, _mutation_headers
from tests.test_model_configs import (  # noqa: F401
    _grant,
    _publish,
    api,
    migrated_database,
)
from tests.test_text_completions import text_api  # noqa: F401


def test_parser_offsets_and_rejections():
    text = "林夕走进房间。\n顾言向她问好。\n" * 1200
    assert parse_document("story.txt", text.encode()) == text
    pieces = split_text(text)
    assert len(pieces) > 1
    for start, end, body in pieces:
        assert text[start:end] == body
    assert pieces[-1][1] == len(text)
    for name, data in [("empty.txt", b" "), ("bad.txt", b"\xff"), ("bad.exe", b"x")]:
        with pytest.raises(ValidationError):
            parse_document(name, data)


def test_graph_crud_versions_and_scope(api):  # noqa: F811
    client, settings = api
    owner = asyncio.run(_create_user(settings, f"graph-{uuid4()}@example.com", PASSWORD))
    _login(client, settings, owner.email, PASSWORD)
    headers = _mutation_headers(client, settings)
    project = client.post("/api/v1/projects", json={"name": "剧本"}, headers=headers).json()["id"]
    other = client.post("/api/v1/projects", json={"name": "其他"}, headers=headers).json()["id"]
    root = _story_root(client, headers, project, "第一集")
    sibling = _story_root(client, headers, project, "第二集")
    foreign_root = _story_root(client, headers, other, "外集")
    a = client.post(root + "/characters", json={"name": "林夕", "title": "编剧"}, headers=headers)
    assert a.status_code == 201, a.text
    a = a.json()
    b = client.post(root + "/characters", json={"name": "顾言"}, headers=headers).json()
    body = {
        "source_character_id": a["id"],
        "target_character_id": b["id"],
        "relationship_type": "朋友",
    }
    for _ in range(2):
        assert client.post(root + "/relationships", json=body, headers=headers).status_code == 201
    foreign = client.post(
        foreign_root + "/characters", json={"name": "异空间"}, headers=headers
    ).json()
    sibling_character = client.post(
        sibling + "/characters", json={"name": "另一集"}, headers=headers
    ).json()
    assert (
        client.post(
            root + "/relationships",
            json={**body, "target_character_id": foreign["id"]},
            headers=headers,
        ).status_code
        == 404
    )
    assert (
        client.post(
            root + "/relationships",
            json={**body, "target_character_id": sibling_character["id"]},
            headers=headers,
        ).status_code
        == 404
    )
    assert client.get(foreign_root + "/characters/" + a["id"]).status_code == 404
    assert client.get(sibling + "/character-graph").json()["characters"][0]["name"] == "另一集"
    patch = {"name": "林夕", "title": "导演", "expected_version": 1}
    assert (
        client.patch(root + "/characters/" + a["id"], json=patch, headers=headers).status_code
        == 200
    )
    assert (
        client.patch(root + "/characters/" + a["id"], json=patch, headers=headers).status_code
        == 409
    )
    layout = {
        "expected_version": 0,
        "node_positions": {a["id"]: {"x": 5, "y": 7}},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    }
    assert (
        client.put(root + "/character-graph/layout", json=layout, headers=headers).status_code
        == 200
    )
    assert (
        client.put(root + "/character-graph/layout", json=layout, headers=headers).status_code
        == 409
    )
    result = client.get(root + "/character-graph").json()
    assert len(result["relationships"]) == 2
    assert result["layout"]["node_positions"][a["id"]]["x"] == 5
    assert (
        client.delete(
            root + "/characters/" + a["id"] + "?expected_version=2", headers=headers
        ).status_code
        == 204
    )
    assert client.get(root + "/character-graph").json()["relationships"] == []


def _story_root(client, headers, project, title):
    created = client.post(
        f"/api/v1/projects/{project}/stories", json={"title": title}, headers=headers
    )
    assert created.status_code == 201, created.text
    return f"/api/v1/projects/{project}/stories/{created.json()['id']}"


def test_script_analysis_review_does_not_overwrite_user_edits(text_api):  # noqa: F811
    client, settings = text_api
    owner = asyncio.run(_create_user(settings, "script@example.com", PASSWORD))
    _login(client, settings, owner.email, PASSWORD)
    headers = _mutation_headers(client, settings)
    project = client.post("/api/v1/projects", json={"name": "Script"}, headers=headers).json()["id"]
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

    class Storage:
        data = {}

        async def put_object(self, *, object_key, content, content_type):
            self.data[object_key] = content

        async def get_object(self, *, object_key):
            return self.data[object_key]

    storage = Storage()

    class Model:
        calls = 0

        async def extract(self, **kwargs):
            self.calls += 1
            if kwargs.get("stage"):
                return Extraction.model_validate(kwargs["segments"][0])
            sid = kwargs["segments"][0]["segment_id"]
            evidence = [
                dict(
                    segment_id=sid,
                    quote="林夕和顾言是朋友。",
                    source_type="explicit",
                    confidence=0.95,
                )
            ]
            return Extraction.model_validate(
                dict(
                    characters=[
                        dict(
                            key="lin",
                            name="林夕",
                            title="编剧",
                            personality="谨慎",
                            evidence=evidence,
                        ),
                        dict(key="gu", name="顾言", evidence=evidence),
                    ],
                    relationships=[
                        dict(source="lin", target="gu", relationship_type="朋友", evidence=evidence)
                    ],
                )
            )

    provider = Model()
    projects = ProjectService(AuthService(settings))
    stories = StoryService(projects, UploadService(settings))
    client.app.dependency_overrides[analysis_service] = lambda: AnalysisService(
        settings, projects, storage=storage, stories=stories
    )
    root = _story_root(client, headers, project, "分析集")
    try:
        doc = client.post(
            root + "/scripts",
            json={
                "filename": "story.txt",
                "content_base64": base64.b64encode("林夕和顾言是朋友。".encode()).decode(),
            },
            headers=headers,
        )
        assert doc.status_code == 201, doc.text
        body = {"document_id": doc.json()["id"]}
        h = {**headers, "Idempotency-Key": "script-analysis-1"}
        task = client.post(root + "/character-analysis", json=body, headers=h)
        assert task.status_code == 201, task.text
        task = task.json()
        assert (
            client.post(root + "/character-analysis", json=body, headers=h).json()["id"]
            == task["id"]
        )

        async def run():
            engine = create_db_engine(settings)
            try:
                await AnalysisService(
                    settings, projects, create_session_factory(engine), provider, storage
                ).execute(UUID(task["id"]))
            finally:
                await engine.dispose()

        asyncio.run(run())
        done = client.get(root + "/character-analysis/" + task["id"]).json()
        assert done["status"] == "succeeded", done
        assert client.get(root + "/character-graph").json()["characters"] == []
        accept = client.post(
            root + "/character-analysis/" + task["id"] + "/accept", headers=headers
        )
        assert accept.status_code == 200, accept.text
        graph = client.get(root + "/character-graph").json()
        assert len(graph["characters"]) == 2 and len(graph["relationships"]) == 1
        c = next(c for c in graph["characters"] if c["name"] == "林夕")
        assert (
            client.patch(
                root + "/characters/" + c["id"],
                json={"name": "林夕", "title": "导演", "expected_version": 1},
                headers=headers,
            ).status_code
            == 200
        )
        client.post(root + "/character-analysis/" + task["id"] + "/accept", headers=headers)
        assert client.get(root + "/characters/" + c["id"]).json()["title"] == "导演"
        assert len(client.get(root + "/character-graph").json()["characters"]) == 2
        assert provider.calls == 2
    finally:
        client.app.dependency_overrides.pop(analysis_service, None)


def test_character_photo_persists_and_checks_owner(api):  # noqa: F811
    from tests.test_stories import _image

    client, settings = api
    owner = asyncio.run(_create_user(settings, f"photo-{uuid4()}@example.com", PASSWORD))
    stranger = asyncio.run(_create_user(settings, f"photo-other-{uuid4()}@example.com", PASSWORD))
    own_image = asyncio.run(_image(settings, owner.id))
    other_image = asyncio.run(_image(settings, stranger.id))
    _login(client, settings, owner.email, PASSWORD)
    headers = _mutation_headers(client, settings)
    project = client.post("/api/v1/projects", json={"name": "照片"}, headers=headers).json()["id"]
    root = _story_root(client, headers, project, "剧本")
    result = client.post(
        root + "/characters",
        json={"name": "林夕", "avatar_upload_id": str(own_image)},
        headers=headers,
    )
    assert result.status_code == 201, result.text
    character = result.json()
    assert character["avatar_url"] == "https://cdn.example/cover.png"
    path = root + "/characters/" + character["id"]
    assert client.get(path).json()["avatar_upload_id"] == str(own_image)
    assert (
        client.get(root + "/character-graph").json()["characters"][0]["avatar_url"]
        == character["avatar_url"]
    )
    denied = client.post(path + "/images", json={"upload_id": str(other_image)}, headers=headers)
    assert denied.status_code == 404
    images = client.get(path + "/images").json()["images"]
    assert len(images) == 1 and images[0]["is_primary"]
    removed = client.delete(path + "/images/" + images[0]["id"], headers=headers)
    assert removed.status_code == 200, removed.text
    assert removed.json()["images"] == []
    assert client.get(root + "/character-graph").json()["characters"][0]["avatar_url"] is None
