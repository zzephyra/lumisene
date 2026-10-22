# Real PostgreSQL, existing workers and FFmpeg; only provider/storage are explicit test doubles.
import asyncio
from uuid import UUID, uuid4

import pytest
from app.core.errors import ConflictError
from app.infrastructure.ai.text_completion import TextCompletionService
from app.infrastructure.db.session import UnitOfWork, create_db_engine, create_session_factory
from app.modules.auth.service import AuthService
from app.modules.characters.service import CharacterService
from app.modules.editor.service import EditorService
from app.modules.generation.deletion import AssetDeletionService
from app.modules.generation.service import ImageGenerationService
from app.modules.generation.video import VideoGenerationService
from app.modules.production.models import ProductionRun
from app.modules.production.planning import ProductionPlanning
from app.modules.production.prompts import validate_plan
from app.modules.production.service import ProductionService
from app.modules.projects.service import ProjectService
from app.modules.settings.service import SettingsService
from app.modules.stories.service import StoryService
from app.modules.storyline.service import StorylineService
from app.modules.uploads.service import UploadService
from pydantic import ValidationError

from tests.test_model_configs import _grant, _publish, api, migrated_database  # noqa: F401
from tests.test_storyline import setup
from tests.test_text_completions import text_api  # noqa: F401
from tests.test_video_editor import sample
from tests.test_video_generations import video_api  # noqa: F401


def test_snapshot_crud_conflict_and_isolation(api):  # noqa: F811
    client, settings = api
    owner, headers, story_url, project = setup(client, settings)
    root = f"/api/v1/projects/{project}/productions"
    result = client.post(
        root, json={"story_id": story_url.split("/")[-1], "title": "制作 A"}, headers=headers
    )
    assert result.status_code == 201, result.text
    data = result.json()
    url = root + "/" + data["id"]
    assert data["snapshot"]["story"]["title"] == "雨夜"
    board = {"scenes": [{"title": "夜晚", "shots": [{"id": str(uuid4()), "description": "推门"}]}]}
    saved = client.put(
        url + "/board", json={"expected_version": 1, "board": board}, headers=headers
    )
    assert saved.status_code == 200, saved.text
    assert (
        client.put(
            url + "/board", json={"expected_version": 1, "board": board}, headers=headers
        ).status_code
        == 409
    )
    board["scenes"][0]["shots"][0]["character_ids"] = [str(uuid4())]
    assert (
        client.put(
            url + "/board", json={"expected_version": 2, "board": board}, headers=headers
        ).status_code
        == 422
    )
    other = client.post("/api/v1/projects", json={"name": "Other"}, headers=headers).json()["id"]
    assert client.get(f"/api/v1/projects/{other}/productions/{data['id']}").status_code == 404
    assert (
        client.post(
            f"/api/v1/projects/{other}/productions",
            json={"story_id": data["story_id"], "title": "跨项目"},
            headers=headers,
        ).status_code
        == 404
    )
    assert (
        client.post(
            url + f"/shots/{board['scenes'][0]['shots'][0]['id']}/generate",
            json={"expected_version": 2, "kind": "video"},
            headers={**headers, "Idempotency-Key": "a"},
        ).status_code
        == 422
    )


def test_ai_cannot_confirm_or_assign_assets():
    with pytest.raises(ValueError):
        validate_plan('{"scenes":[{"title":"A","shots":[{"confirmed":true}]}]}')
    with pytest.raises(ValidationError):
        validate_plan('{"scenes":[{"title":"A","shots":[{"character_ids":["invented"]}]}]}')
    assert (
        validate_plan('{"scenes":[{"title":"A","shots":[{"description":"走入"}]}]}')
        .scenes[0]
        .shots[0]
        .confirmed
        is False
    )


def services(settings, storage=None, factory=None):
    projects = ProjectService(AuthService(settings))
    stories = StoryService(projects, UploadService(settings))
    images = ImageGenerationService(settings, storage=storage)
    return ProductionService(
        StorylineService(stories, CharacterService(projects, stories)),
        images,
        VideoGenerationService(settings, storage=storage),
        TextCompletionService(settings, session_factory=factory),
        EditorService(settings, images),
    )


def assigned(client, settings, owner, capability, model_name="model-test"):
    asyncio.run(_grant(settings, owner.email))
    model = _publish(client, settings, model_name=model_name, capability=capability)
    from tests.test_identity_projects import _mutation_headers

    response = client.put(
        "/api/v1/admin/model-assignments/" + capability,
        json={"model_config_id": model["id"]},
        headers=_mutation_headers(client, settings),
    )
    assert response.status_code == 200, response.text


def test_plan_is_async_and_cannot_overwrite_newer_board(text_api):  # noqa: F811
    client, settings = text_api
    owner, h, story_url, project = setup(client, settings)
    assigned(client, settings, owner, "text_generation")
    root = f"/api/v1/projects/{project}/productions"
    data = client.post(
        root, json={"story_id": story_url.split("/")[-1], "title": "Plan"}, headers=h
    ).json()
    url = root + "/" + data["id"]
    response = client.post(
        url + "/plans", json={"expected_version": 1}, headers={**h, "Idempotency-Key": "plan-one"}
    )
    assert response.status_code == 202, response.text
    run = response.json()["runs"][0]
    assert run["status"] == "queued"
    assert not response.json()["board"]["scenes"]

    class FakePlanner:
        async def complete(self, **kwargs):
            return '{"scenes":[{"title":"咖啡馆","shots":[{"description":"人物进入"}]}]}'

    async def execute():
        engine = create_db_engine(settings)
        factory = create_session_factory(engine)
        service = services(settings, factory=factory)
        service.completions.client = FakePlanner()
        async with factory() as session:
            row = await session.get(ProductionRun, UUID(run["id"]))
            completion = row.completion_id
        await service.completions.execute(completion)
        await ProductionPlanning(service).collect(factory)
        await engine.dispose()

    asyncio.run(execute())
    result = client.get(url).json()
    assert result["runs"][0]["status"] == "succeeded", result
    assert not result["board"]["scenes"]
    suggestion = result["runs"][0]["result"]
    edited = client.put(
        url + "/board",
        json={"expected_version": 1, "board": {"scenes": [{"title": "人工场景"}]}},
        headers=h,
    )
    assert edited.status_code == 200
    apply = client.post(
        url + f"/plans/{run['id']}/apply",
        json={"expected_version": 2, "board": suggestion},
        headers=h,
    )
    assert apply.status_code == 409, apply.text
    assert client.get(url).json()["board"]["scenes"][0]["title"] == "人工场景"


def test_generation_versions_replay_reference_guard_and_real_export(
    video_api,  # noqa: F811
    tmp_path,
    monkeypatch,  # noqa: F811
):  # noqa: F811
    client, settings, storage = video_api
    owner, h, story_url, project = setup(client, settings)
    assigned(client, settings, owner, "text_to_video")
    root = f"/api/v1/projects/{project}/productions"
    data = client.post(
        root, json={"story_id": story_url.split("/")[-1], "title": "Film"}, headers=h
    ).json()
    url = root + "/" + data["id"]
    shot = str(uuid4())
    board = {
        "scenes": [
            {
                "title": "海港",
                "shots": [
                    {
                        "id": shot,
                        "description": "海港",
                        "prompt": "a quiet harbor",
                        "confirmed": True,
                    }
                ],
            }
        ]
    }
    response = client.put(url + "/board", json={"expected_version": 1, "board": board}, headers=h)
    assert response.status_code == 200, response.text
    payload = {
        "expected_version": 2,
        "kind": "video",
        "parameters": {"duration": 5, "size": "1920*1080"},
    }
    generated = client.post(
        url + f"/shots/{shot}/generate", json=payload, headers={**h, "Idempotency-Key": "one"}
    )
    assert generated.status_code == 202, generated.text
    assert len(generated.json()["runs"]) == 1
    replay = client.post(
        url + f"/shots/{shot}/generate", json=payload, headers={**h, "Idempotency-Key": "one"}
    )
    assert replay.status_code == 202
    assert len(replay.json()["runs"]) == 1
    assert (
        client.post(
            url + f"/shots/{shot}/generate", json=payload, headers={**h, "Idempotency-Key": "two"}
        ).status_code
        == 409
    )
    path = tmp_path / "real.mp4"
    asyncio.run(sample(path))

    async def finish_and_check():
        engine = create_db_engine(settings)
        factory = create_session_factory(engine)
        async with factory() as session:
            run = await session.get(ProductionRun, UUID(generated.json()["runs"][0]["id"]))
            task = await services(settings, storage).images.get(
                UnitOfWork(session), project_id=UUID(project), task_id=run.task_id
            )
            task.status = "running"
            await session.commit()
            task_id = task.id
        video = VideoGenerationService(settings, session_factory=factory, storage=storage)
        await video._store(task_id, UUID(project), owner.id, (path.read_bytes(), "video/mp4"))
        async with factory() as session:
            images = services(settings, storage).images
            asset = (
                await images.output_ids(
                    UnitOfWork(session), project_id=UUID(project), task_ids=[task_id]
                )
            )[task_id][0]
            with pytest.raises(ConflictError):
                await AssetDeletionService(SettingsService(settings)).delete(
                    session, project_id=UUID(project), asset_id=asset, actor_id=owner.id
                )
        await engine.dispose()

    asyncio.run(finish_and_check())
    result = client.get(url).json()
    asset = result["runs"][0]["output_asset_ids"][0]
    adopted = result["board"]
    adopted["scenes"][0]["shots"][0]["selected_video_id"] = asset
    assert (
        client.put(
            url + "/board", json={"expected_version": 2, "board": adopted}, headers=h
        ).status_code
        == 200
    )
    response = client.post(
        url + "/exports",
        json={"expected_version": 3, "width": 320, "height": 240},
        headers={**h, "Idempotency-Key": "export"},
    )
    assert response.status_code == 202, response.text

    async def render():
        engine = create_db_engine(settings)
        factory = create_session_factory(engine)
        assert await services(settings, storage).editor.execute_next(factory)
        await engine.dispose()

    asyncio.run(render())
    result = client.get(url).json()
    exported = next(r for r in result["runs"] if r["kind"] == "export")
    assert exported["status"] == "succeeded", exported
    assert exported["output_asset_ids"]
    retry = client.post(
        url + f"/shots/{shot}/generate",
        json={**payload, "expected_version": 3},
        headers={**h, "Idempotency-Key": "two"},
    )
    assert retry.status_code == 202, retry.text
    assert len([r for r in retry.json()["runs"] if r["kind"] == "video"]) == 2
    assert retry.json()["board"]["scenes"][0]["shots"][0]["selected_video_id"] == asset


def test_v2_scope_settings_and_source_sync(api):  # noqa: F811
    client, settings = api
    _, headers, story_url, project = setup(client, settings)
    plot = story_url + "/plot"
    chapters = [
        client.post(plot + "/chapters", json={"title": name}, headers=headers).json()
        for name in ["相遇", "冲突"]
    ]
    scenes = []
    for chapter in chapters:
        for title in ["清晨", "夜晚"]:
            response = client.post(
                plot + f"/chapters/{chapter['id']}/scenes",
                json={
                    "title": title,
                    "blocks": [{"id": str(uuid4()), "type": "action", "content": title + "推门"}],
                },
                headers=headers,
            )
            assert response.status_code == 201, response.text
            scenes.append(response.json())
    base = f"/api/v1/projects/{project}/productions"
    source = client.get(base + "/source/" + story_url.split("/")[-1])
    assert source.status_code == 200, source.text
    assert len(source.json()["chapters"]) == 2
    selections = [
        {"chapter_id": chapters[1]["id"], "scene_ids": [scenes[2]["id"]]},
        {"chapter_id": chapters[0]["id"], "scene_ids": None},
    ]
    created = client.post(
        base,
        json={
            "story_id": story_url.split("/")[-1],
            "title": "选定制作",
            "selections": selections,
            "settings": {"target_duration": 90},
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    data = created.json()
    url = base + "/" + data["id"]
    assert [c["id"] for c in data["snapshot"]["chapters"]] == [c["chapter_id"] for c in selections]
    assert len(data["snapshot"]["chapters"][0]["scenes"]) == 1
    assert client.get(url + "/source-impact").json()["has_changes"] is False
    invalid = client.post(
        base,
        json={
            "story_id": data["story_id"],
            "title": "无效范围",
            "selections": [{"chapter_id": chapters[0]["id"], "scene_ids": [scenes[2]["id"]]}],
        },
        headers=headers,
    )
    assert invalid.status_code == 422
    board = {
        "scenes": [
            {
                "title": "场景",
                "source_chapter_ids": [chapters[1]["id"]],
                "shots": [
                    {
                        "source_chapter_id": chapters[1]["id"],
                        "source_scene_id": scenes[2]["id"],
                        "description": "人工编辑保留",
                    }
                ],
            }
        ]
    }
    saved = client.put(
        url + "/board", json={"expected_version": 1, "board": board}, headers=headers
    )
    assert saved.status_code == 200, saved.text
    board = saved.json()["board"]
    updated = client.put(
        url + "/settings",
        json={"expected_version": 2, "settings": {"mode": "professional", "target_duration": 60}},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["board"] == board
    assert (
        client.put(
            url + "/settings",
            json={"expected_version": 2, "settings": {"target_duration": 30}},
            headers=headers,
        ).status_code
        == 409
    )
    edited = client.patch(
        plot + "/scenes/" + scenes[2]["id"],
        json={"expected_version": 1, "title": "已修改清晨"},
        headers=headers,
    )
    assert edited.status_code == 200, edited.text
    impact = client.get(url + "/source-impact").json()
    assert impact["has_changes"]
    assert impact["affected_shot_ids"] == [board["scenes"][0]["shots"][0]["id"]]
    assert client.get(url).json()["snapshot"] == data["snapshot"]
    assert (
        client.post(
            url + "/sync-source",
            json={"expected_version": 3, "fingerprint": "stale"},
            headers=headers,
        ).status_code
        == 409
    )
    synced = client.post(
        url + "/sync-source",
        json={"expected_version": 3, "fingerprint": impact["fingerprint"]},
        headers=headers,
    )
    assert synced.status_code == 200, synced.text
    assert synced.json()["board"] == board
    assert client.get(url + "/source-impact").json()["has_changes"] is False


def test_v2_duration_is_weighted_bounded_and_pacing_sensitive():
    from app.modules.production.duration import allocate
    from app.modules.production.schemas import Board, ProductionSettings

    board = Board.model_validate(
        {
            "scenes": [
                {
                    "title": "故事",
                    "shots": [
                        {"narrative_role": "transition"},
                        {"narrative_role": "climax", "dialogue": "我必须找到真相" * 10},
                    ],
                }
            ]
        }
    )
    result = allocate(board, ProductionSettings(target_duration=30), [5, 10, 15])
    shots = result.scenes[0].shots
    assert len(shots) == 2
    assert all(s.duration <= 15 for s in shots)
    assert all(s.generation_duration in {5, 10, 15} for s in shots)
    assert shots[1].duration >= shots[0].duration
    assert any("不会复制同一画面" in risk for risk in result.risks)
    solo = Board.model_validate(
        {
            "scenes": [
                {
                    "title": "故事",
                    "shots": [{"narrative_role": "action", "prompt": "人物拿起钥匙出门，镜头跟拍"}],
                }
            ]
        }
    )
    covered = allocate(solo, ProductionSettings(target_duration=90), [5])
    clips = [s for scene in covered.scenes for s in scene.shots]
    assert len(clips) == 1
    assert clips[0].prompt == "人物拿起钥匙出门，镜头跟拍"
    assert clips[0].duration == 5
    assert clips[0].generation_duration == 5
    slow = allocate(board, ProductionSettings(target_duration=30, pacing="slow"), [5, 10, 15])
    fast = allocate(board, ProductionSettings(target_duration=30, pacing="fast"), [5, 10, 15])
    assert slow.scenes[0].shots[0].duration > fast.scenes[0].shots[0].duration
    assert board.scenes[0].shots[0].duration == 5


def test_same_place_with_new_action_is_not_a_duplicate_shot():
    from app.modules.production.continuity import find_duplicates
    from app.modules.production.schemas import Board

    classroom = Board.model_validate(
        {
            "scenes": [
                {
                    "title": "教室",
                    "shots": [
                        {
                            "description": "老师开始讲课",
                            "action": "老师翻开课本并开始讲解",
                            "environment": "教室",
                            "framing": "中景",
                            "movement": "固定",
                        },
                        {
                            "description": "学生提出问题",
                            "action": "前排学生举手提问",
                            "environment": "教室",
                            "framing": "中景",
                            "movement": "固定",
                        },
                        {
                            "description": "老师回答问题",
                            "action": "老师走向黑板写下答案",
                            "environment": "教室",
                            "framing": "中景",
                            "movement": "固定",
                        },
                    ],
                }
            ]
        }
    )
    assert find_duplicates(classroom) == []
    street = Board.model_validate(
        {
            "scenes": [
                {
                    "title": "街道",
                    "shots": [
                        {
                            "description": "女主站在街道上望向远方",
                            "action": "女主站在街道上静静望向远方",
                            "environment": "街道",
                            "framing": "中景",
                            "movement": "固定",
                            "prompt": "女主站在同一条街道上，电影级柔光",
                        },
                        {
                            "description": "女主站在街道上望向远方",
                            "action": "女主站在街道上静静望向远方",
                            "environment": "街道",
                            "framing": "中景",
                            "movement": "固定",
                            "prompt": "女主站在同一条街道上，电影级柔光",
                        },
                    ],
                }
            ]
        }
    )
    notes = find_duplicates(street)
    assert len(notes) == 1
    assert "镜头 01" in notes[0]
    assert str(street.scenes[0].shots[0].id) not in notes[0]


def test_v2_ai_citation_must_be_in_selected_source():
    from app.modules.production.prompts import validate_origins
    from app.modules.production.schemas import Board

    chapter, scene = str(uuid4()), str(uuid4())
    snapshot = {
        "chapters": [
            {
                "id": chapter,
                "summary": "",
                "scenes": [{"id": scene, "blocks": [{"content": "他在雨夜推开房门。"}]}],
            }
        ]
    }
    board = Board.model_validate(
        {
            "scenes": [
                {
                    "title": "雨夜",
                    "shots": [
                        {
                            "source_chapter_id": chapter,
                            "source_scene_id": scene,
                            "script_excerpt": "他在雨夜推开房门。",
                        }
                    ],
                }
            ]
        }
    )
    validate_origins(board, snapshot)
    board.scenes[0].shots[0].script_excerpt = "他毁灭了整个世界。"
    with pytest.raises(ValueError):
        validate_origins(board, snapshot)


@pytest.mark.parametrize("requires_frame", [False, True])
def test_story_execution_isolated_confirmed_and_restart_safe(
    video_api,  # noqa: F811
    tmp_path,
    requires_frame,
    monkeypatch,  # noqa: F811
):  # noqa: F811
    from app.modules.production.execution import ProductionExecution
    from sqlalchemy import select

    client, settings, storage = video_api
    owner, headers, story_url, project = setup(client, settings)
    assigned(
        client,
        settings,
        owner,
        "text_to_video",
        "wan2.1-i2v-turbo" if requires_frame else "model-test",
    )
    if requires_frame:
        assigned(client, settings, owner, "text_to_image")
    root = story_url + "/productions"
    created = client.post(
        root,
        json={
            "story_id": story_url.split("/")[-1],
            "title": "确认后生成",
            "settings": {"target_duration": 5},
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    data = created.json()
    url = root + "/" + data["id"]
    assert [p["id"] for p in client.get(root).json()] == [data["id"]]
    other = client.post(
        f"/api/v1/projects/{project}/stories", json={"title": "另一个故事"}, headers=headers
    )
    assert other.status_code == 201, other.text
    other_root = f"/api/v1/projects/{project}/stories/{other.json()['id']}/productions"
    assert client.get(other_root).json() == []
    assert client.get(other_root + "/" + data["id"]).status_code == 404
    assert (
        client.post(
            other_root, json={"story_id": data["story_id"], "title": "越权"}, headers=headers
        ).status_code
        == 404
    )
    shot = str(uuid4())
    board = {
        "scenes": [
            {"title": "海港", "shots": [{"id": shot, "description": "海港", "confirmed": True}]}
        ]
    }
    saved = client.put(
        url + "/board", json={"expected_version": 1, "board": board}, headers=headers
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["runs"] == []
    payload = {"expected_version": 2, "acknowledge_unpriced": False, "auto_export": True}
    h = {**headers, "Idempotency-Key": "execute-once"}
    result = client.post(url + "/execute", json=payload, headers=h)
    assert result.status_code == 202, result.text
    assert len(result.json()["runs"]) == 1
    assert (
        client.put(
            url + "/board", json={"expected_version": 2, "board": board}, headers=headers
        ).status_code
        == 409
    )
    assert (
        client.post(other_root + "/" + data["id"] + "/execute", json=payload, headers=h).status_code
        == 404
    )
    path = tmp_path / "shot.mp4"
    asyncio.run(sample(path))

    async def progress():
        engine = create_db_engine(settings)
        factory = create_session_factory(engine)
        service = services(settings, storage, factory)
        await ProductionExecution(service).collect(factory)
        if requires_frame:
            from io import BytesIO

            from PIL import Image

            async with factory() as session:
                image_run = await session.scalar(
                    select(ProductionRun).where(
                        ProductionRun.production_id == UUID(data["id"]),
                        ProductionRun.kind == "image",
                    )
                )
                assert image_run is not None
                image_task_id = image_run.task_id
                task = await service.images.get(
                    UnitOfWork(session), project_id=UUID(project), task_id=image_task_id
                )
                task.status = "running"
                await session.commit()
            buffer = BytesIO()
            Image.new("RGB", (256, 256), "white").save(buffer, format="PNG")
            image_service = ImageGenerationService(
                settings, session_factory=factory, storage=storage
            )
            await image_service._store(
                image_task_id, UUID(project), owner.id, [(buffer.getvalue(), "image/png")]
            )
            await ProductionExecution(service).collect(factory)
        # A fresh collector resumes the durable run without creating a second paid task.
        await ProductionExecution(service).collect(factory)
        async with factory() as session:
            runs = list(
                await session.scalars(
                    select(ProductionRun).where(
                        ProductionRun.production_id == UUID(data["id"]),
                        ProductionRun.kind == "video",
                    )
                )
            )
            assert len(runs) == 1
            task_id = runs[0].task_id
            task = await service.images.get(
                UnitOfWork(session), project_id=UUID(project), task_id=task_id
            )
            task.status = "running"
            await session.commit()
        video = VideoGenerationService(settings, session_factory=factory, storage=storage)
        await video._store(task_id, UUID(project), owner.id, (path.read_bytes(), "video/mp4"))
        await ProductionExecution(service).collect(factory)
        await ProductionExecution(service).collect(factory)
        assert await service.editor.execute_next(factory)
        await ProductionExecution(service).collect(factory)
        await engine.dispose()

    asyncio.run(progress())
    result = client.get(url).json()
    assert next(r for r in result["runs"] if r["kind"] == "execution")["status"] == "succeeded", (
        result
    )
    assert result["board"]["scenes"][0]["shots"][0]["selected_video_id"]
    replay = client.post(url + "/execute", json=payload, headers=h)
    assert replay.status_code == 202, replay.text
    assert len(replay.json()["runs"]) == (4 if requires_frame else 3)
    assert next(r for r in result["runs"] if r["kind"] == "export")["output_asset_ids"]
    copied = client.post(url + "/copy-settings", headers=headers)
    assert copied.status_code == 201, copied.text
    assert copied.json()["id"] != data["id"]
    assert copied.json()["board"]["scenes"] == []
    assert copied.json()["runs"] == []
    assert copied.json()["snapshot"] == result["snapshot"]
    assert (
        client.post(other_root + "/" + data["id"] + "/copy-settings", headers=headers).status_code
        == 404
    )


def test_planner_normalizes_dialogue_without_accepting_media_ids():
    import json

    plan = {
        "scenes": [
            {
                "title": "教室",
                "shots": [{"dialogue": []}, {"dialogue": [{"speaker": "老师", "text": "请坐"}]}],
            }
        ]
    }
    result = validate_plan(json.dumps(plan))
    assert result.scenes[0].shots[0].dialogue == ""
    assert result.scenes[0].shots[1].dialogue == "老师：请坐"
    plan["scenes"][0]["shots"][0]["selected_video_id"] = str(uuid4())
    with pytest.raises(ValueError):
        validate_plan(json.dumps(plan))


def test_i2v_model_cannot_be_advertised_as_text_to_video():
    from types import SimpleNamespace

    from app.core.errors import ValidationError as AppValidationError
    from app.infrastructure.ai.video_parameters import video_options

    config = SimpleNamespace(model_name="wan2.1-i2v-turbo", parameters_schema={})
    with pytest.raises(AppValidationError, match="首帧"):
        video_options(config, None)


def test_legacy_origin_recovery_requires_unique_literal_match():
    from app.modules.production.prompts import restore_missing_origins
    from app.modules.production.schemas import Board

    chapter, scene = str(uuid4()), str(uuid4())
    source = {
        "chapters": [
            {
                "id": chapter,
                "scenes": [{"id": scene, "blocks": [{"content": "老师推开教室的门。"}]}],
            }
        ]
    }
    board = Board.model_validate(
        {"scenes": [{"title": "教室", "shots": [{"script_excerpt": "老师推开教室的门。"}]}]}
    )
    restore_missing_origins(board, source)
    assert str(board.scenes[0].shots[0].source_scene_id) == scene
    board.scenes[0].shots[0].source_chapter_id = None
    board.scenes[0].shots[0].source_scene_id = None
    source["chapters"][0]["scenes"].append(
        {"id": str(uuid4()), "blocks": [{"content": "老师推开教室的门。"}]}
    )
    restore_missing_origins(board, source)
    assert board.scenes[0].shots[0].source_chapter_id is None


def test_failed_plan_revalidates_cached_output_without_model_call(text_api, monkeypatch):  # noqa: F811
    from app.core.errors import VersionConflictError
    from app.infrastructure.db.session import UnitOfWork
    from app.modules.production.models import Production

    client, settings = text_api
    owner, headers, story_url, project = setup(client, settings)
    assigned(client, settings, owner, "text_generation")
    root = f"/api/v1/projects/{project}/productions"
    production = client.post(
        root, json={"story_id": story_url.split("/")[-1], "title": "Recovery"}, headers=headers
    ).json()
    run = client.post(
        root + "/" + production["id"] + "/plans",
        json={"expected_version": 1},
        headers={**headers, "Idempotency-Key": "recovery"},
    ).json()["runs"][0]
    calls = []

    class FakePlanner:
        async def complete(self, **kwargs):
            calls.append(True)
            return '{"scenes":[{"title":"场景","shots":[{"description":"走入"}]}]}'

    async def execute():
        engine = create_db_engine(settings)
        factory = create_session_factory(engine)
        service = services(settings, factory=factory)
        service.completions.client = FakePlanner()
        planning = ProductionPlanning(service)
        async with factory() as db:
            old = await db.get(ProductionRun, UUID(run["id"]))
            completion = old.completion_id
        await service.completions.execute(completion)
        with monkeypatch.context() as patch:

            def fail(content):
                raise ValueError("legacy parser failure")

            patch.setattr("app.modules.production.planning.validate_plan", fail)
            await planning.collect(factory)
        async with factory() as db:
            uow = UnitOfWork(db)
            row = await db.get(Production, UUID(production["id"]))
            row.version = 2
            with pytest.raises(VersionConflictError):
                await planning.retry_validation(
                    uow, owner.id, UUID(project), row.id, UUID(run["id"])
                )
            await db.rollback()
        async with factory() as db:
            new_id = await planning.retry_validation(
                UnitOfWork(db), owner.id, UUID(project), UUID(production["id"]), UUID(run["id"])
            )
        await planning.collect(factory)
        async with factory() as db:
            old = await db.get(ProductionRun, UUID(run["id"]))
            new = await db.get(ProductionRun, new_id)
            assert old.status == "failed"
            assert new.status == "succeeded"
            assert new.completion_id == old.completion_id
            assert (
                await planning.retry_validation(
                    UnitOfWork(db), owner.id, UUID(project), UUID(production["id"]), old.id
                )
                == new.id
            )
        await engine.dispose()

    asyncio.run(execute())
    assert len(calls) == 1


def test_plan_errors_do_not_expose_model_payload():
    from app.modules.production.planning import planning_error
    from pydantic import ValidationError as SchemaError

    with pytest.raises(SchemaError) as error:
        validate_plan('{"scenes":[{"title":"A","shots":[{"character_ids":["private-value"]}]}]}')
    assert "人物引用" in planning_error("format", error.value)
    assert "private-value" not in planning_error("format", error.value)
    assert "原文" in planning_error("origins", ValueError("private script"))
