import asyncio
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from app.api.deps import get_image_generation_service
from app.infrastructure.db.session import UnitOfWork, create_db_engine, create_session_factory
from app.infrastructure.media.render import command, frame_filter, probe, render
from app.modules.editor.schemas import Composition
from app.modules.editor.service import EditorService
from app.modules.generation.service import ImageGenerationService
from pydantic import ValidationError

from tests.test_identity_projects import PASSWORD, _create_user, _login, _mutation_headers
from tests.test_image_generations import MemoryStorage
from tests.test_model_configs import api, migrated_database  # noqa: F401


def composition(asset_id=None):
    return {
        "schema_version": 1,
        "fps": 30,
        "width": 320,
        "height": 240,
        "duration_in_frames": 90,
        "tracks": [
            {
                "id": "video",
                "type": "video",
                "clips": [
                    {
                        "id": str(uuid4()),
                        "asset_id": str(asset_id or uuid4()),
                        "source_start_frame": 30,
                        "source_end_frame": 60,
                        "original_duration": 90,
                        "timeline_start_frame": 30,
                        "duration": 30,
                        "volume": 0.5,
                        "muted": False,
                        "speed": 1,
                    }
                ],
            }
        ],
    }


def test_fill_covers_canvas_and_fit_pads():
    fill = frame_filter(1080, 1920, 30, 0, 150, "fill")
    fit = frame_filter(1080, 1920, 30, 0, 150, "fit")
    assert "force_original_aspect_ratio=increase" in fill
    assert "crop=1080:1920" in fill
    assert "pad=" not in fill
    assert "force_original_aspect_ratio=decrease" in fit
    assert "pad=1080:1920" in fit


def test_schema_rejects_overlap_and_source_overrun():
    doc = composition()
    Composition.model_validate(doc)
    doc["tracks"][0]["clips"].append({**doc["tracks"][0]["clips"][0], "id": str(uuid4())})
    with pytest.raises(ValidationError):
        Composition.model_validate(doc)
    doc = composition()
    doc["tracks"][0]["clips"][0]["source_end_frame"] = 100
    with pytest.raises(ValidationError):
        Composition.model_validate(doc)
    doc = composition()
    doc["fps"] = 60
    with pytest.raises(ValidationError):
        Composition.model_validate(doc)


async def sample(path: Path):
    await command(
        "ffmpeg",
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=320x240:r=30:d=1[r];color=c=blue:s=320x240:r=30:d=2[b];[r][b]concat=n=2:v=1:a=0",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-t",
        "3",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        str(path),
    )


@pytest.mark.asyncio
async def test_real_ffmpeg_renders_trim_and_black_gaps(tmp_path):
    source = tmp_path / "source.mp4"
    await sample(source)
    doc = composition()
    asset_id = doc["tracks"][0]["clips"][0]["asset_id"]
    output = await render(doc, {asset_id: source}, tmp_path)
    assert (await probe(output))["frames"] == 90

    async def pixel(second):
        return await command(
            "ffmpeg",
            "-v",
            "error",
            "-ss",
            str(second),
            "-i",
            str(output),
            "-frames:v",
            "1",
            "-vf",
            "scale=1:1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        )

    assert max(await pixel(0.3)) < 10
    blue = await pixel(1.5)
    assert blue[2] > 200 and blue[0] < 30
    assert max(await pixel(2.5)) < 10
    doc["tracks"][0]["clips"][0]["source_end_frame"] = 120
    with pytest.raises(ValueError):
        await render(doc, {asset_id: source}, tmp_path)


async def seed(settings, project_id, owner_id, storage, data):
    engine = create_db_engine(settings)
    factory = create_session_factory(engine)
    asset_id = uuid4()
    try:
        service = ImageGenerationService(settings, storage=storage)
        await storage.put_object(object_key=str(asset_id), content=data, content_type="video/mp4")
        async with factory() as session:
            uow = UnitOfWork(session)
            await service.register_editor_output(
                uow,
                project_id=UUID(project_id),
                actor_id=owner_id,
                asset_id=asset_id,
                object_key=str(asset_id),
                content=data,
                width=320,
                height=240,
            )
            await uow.commit()
    finally:
        await engine.dispose()
    return asset_id


async def execute(settings, storage):
    engine = create_db_engine(settings)
    try:
        return await EditorService(
            settings, ImageGenerationService(settings, storage=storage)
        ).execute_next(create_session_factory(engine))
    finally:
        await engine.dispose()


def test_api_save_conflict_isolation_export_and_replay(api, tmp_path):  # noqa: F811
    client, settings = api
    owner = asyncio.run(_create_user(settings, "editor@example.com", PASSWORD))
    outsider = asyncio.run(_create_user(settings, "outside@example.com", PASSWORD))
    _login(client, settings, owner.email, PASSWORD)
    headers = _mutation_headers(client, settings)
    project = client.post("/api/v1/projects", json={"name": "Editor"}, headers=headers).json()["id"]
    other = client.post("/api/v1/projects", json={"name": "Other"}, headers=headers).json()["id"]
    path = tmp_path / "source.mp4"
    asyncio.run(sample(path))
    storage = MemoryStorage()
    asset = asyncio.run(seed(settings, project, owner.id, storage, path.read_bytes()))
    client.app.dependency_overrides[get_image_generation_service] = lambda: ImageGenerationService(
        settings, storage=storage
    )
    body = {"title": "My edit", "composition": composition(asset)}
    root = f"/api/v1/projects/{project}/editor"
    created = client.post(f"{root}/documents", json=body, headers=headers)
    assert created.status_code == 201, created.text
    document_id = created.json()["id"]
    url = f"{root}/documents/{document_id}"
    saved = client.patch(url, json={**body, "expected_version": 1}, headers=headers)
    assert saved.status_code == 200
    assert (
        client.patch(url, json={**body, "expected_version": 1}, headers=headers).status_code == 409
    )
    assert (
        client.post(
            f"/api/v1/projects/{other}/editor/documents", json=body, headers=headers
        ).status_code
        == 404
    )
    export_headers = {**headers, "Idempotency-Key": "export-one"}
    queued = client.post(f"{url}/renders", json={"expected_version": 2}, headers=export_headers)
    assert queued.status_code == 202, queued.text
    task_id = queued.json()["id"]
    replay = client.post(f"{url}/renders", json={"expected_version": 2}, headers=export_headers)
    assert replay.json()["id"] == task_id
    assert (
        client.post(
            f"{url}/renders", json={"expected_version": 1}, headers=export_headers
        ).status_code
        == 409
    )
    assert asyncio.run(execute(settings, storage))
    finished = client.get(f"{root}/renders/{task_id}")
    assert finished.json()["status"] == "succeeded", finished.text
    output = client.get(
        f"/api/v1/projects/{project}/assets/{finished.json()['output_asset_id']}/content"
    )
    assert output.status_code == 200 and len(output.content) > 1000
    asset_url = f"/api/v1/projects/{project}/assets/{finished.json()['output_asset_id']}/content"
    partial = client.get(asset_url, headers={"Range": "bytes=0-99"})
    assert partial.status_code == 206 and partial.content == output.content[:100]
    assert client.get(asset_url, headers={"Range": "bytes=999999999-"}).status_code == 416
    assert client.get(f"{url}/latest-render").json()["id"] == task_id
    _login(client, settings, outsider.email, PASSWORD)
    assert client.get(url).status_code == 404
    assert client.get(f"{root}/renders/{task_id}").status_code == 404
    assert client.get(f"{root}/media").status_code == 404
