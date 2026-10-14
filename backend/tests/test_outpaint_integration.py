"""PG-backed native outpaint lifecycle; no real provider calls."""

import asyncio
from uuid import UUID, uuid4

import pytest
from app.core.errors import TimeoutError as ProviderTimeout
from app.infrastructure.db.session import create_db_engine, create_session_factory
from app.modules.generation.models import GenerationTask
from app.modules.generation.service import ImageGenerationService

from tests.test_identity_projects import _mutation_headers
from tests.test_image_actions import b64, picture, setup
from tests.test_image_generations import image_api, migrated_database  # noqa: F401
from tests.test_model_configs import _publish
from tests.test_native_outpainting import PARAMS


@pytest.mark.parametrize("unknown", [False, True])
@pytest.mark.parametrize("operation", ["outpaint", "inpaint", "reference"])
def test_native_submission_resume_and_no_duplicate_submit(image_api, unknown, operation):  # noqa: F811
    client, settings, storage = image_api
    project = setup(client, settings)
    model = _publish(client, settings, model_name="wanx2.1-imageedit", capability="image_inpaint")
    headers = _mutation_headers(client, settings)
    saved = client.post(
        f"/api/v1/projects/{project}/generation-inputs",
        json={
            "id": str(uuid4()),
            "image_base64": b64(picture("red", (512, 512))),
            "mask_base64": b64(picture("white", (512, 512))) if operation == "inpaint" else None,
        },
        headers=headers,
    )
    assert saved.status_code == 201, saved.text
    route = f"/api/v1/projects/{project}/generation-tasks"
    payload = dict(
        kind="image",
        input_id=saved.json()["id"],
        prompt="扩展画面",
        parameters={"outpaint": PARAMS} if operation == "outpaint" else {},
    )
    headers = {**headers, "Idempotency-Key": "native-expand"}
    response = client.post(route, json=payload, headers=headers)
    assert response.status_code == 202, response.text
    task_id = UUID(response.json()["id"])
    assert client.post(route, json=payload, headers=headers).json()["id"] == str(task_id)

    class Native:
        calls = 0

        async def submit(self, **kw):
            self.calls += 1
            if unknown:
                raise ProviderTimeout("unknown")
            return "remote-123"

        async def poll(self, **kw):
            return "succeeded", (picture("blue", (812, 512)), "image/png")

    provider = Native()

    async def run():
        engine = create_db_engine(settings)
        factory = create_session_factory(engine)
        try:
            service = ImageGenerationService(settings, factory, storage=storage)
            service.image_edit_client = provider
            await service.execute(task_id)
            await service.execute(task_id)
            async with factory() as session:
                row = await session.get(GenerationTask, task_id)
                assert str(row.model_config_id) == model["id"]
                assert row.status == "running"
                assert row.reconciliation_required == unknown
                assert row.provider_task_id == (None if unknown else "remote-123")
            # New service/process resumes persisted remote task, without submit.
            resumed = ImageGenerationService(settings, factory, storage=storage)
            resumed.image_edit_client = provider
            await resumed.poll_outpaints()
            await resumed.poll_outpaints()
            assert provider.calls == 1
        finally:
            await engine.dispose()

    asyncio.run(run())
    result = client.get(f"{route}/{task_id}").json()
    assert result["status"] == ("running" if unknown else "succeeded")
    if not unknown:
        output = client.get(
            f"/api/v1/projects/{project}/assets/{result['output_asset_ids'][0]}/content"
        )
        assert output.content == picture("blue", (812, 512))
