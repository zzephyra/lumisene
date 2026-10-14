"""Deletion policy, settings seed, and generated-object decisions. Storage is mocked."""

import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.core.errors import ValidationError
from app.modules.generation.asset_migration import migrate_legacy_asset
from app.modules.generation.deletion import deletion_plan, purge_outcome
from app.modules.generation.persistence import describe_outputs, generated_object_key, put_if_changed
from app.modules.settings.defaults import (
    cache_accepts,
    load_defaults,
    missing_setting_keys,
    resolve_defaults_path,
)
from app.core.config import Settings


def test_defaults_file_uses_retain_and_rejects_unknown_keys(tmp_path):
    path = tmp_path / "system-defaults.json"
    path.write_text(json.dumps({
        "schema_version": 1,
        "settings": {"assets": {"deletion_policy": "retain_cloud_file"}},
    }), encoding="utf-8")
    settings = Settings(system_defaults_file=str(path), environment="testing")
    document = load_defaults(settings)
    assert document.settings.assets.deletion_policy == "retain_cloud_file"
    path.write_text(json.dumps({
        "schema_version": 1,
        "settings": {"assets": {"deletion_policy": "retain_cloud_file", "extra": True}},
    }), encoding="utf-8")
    with pytest.raises(ValidationError):
        load_defaults(settings)


def test_missing_keys_do_not_replace_an_existing_policy():
    from app.modules.settings.defaults import DefaultsDocument

    document = DefaultsDocument.model_validate({
        "schema_version": 1,
        "settings": {"assets": {"deletion_policy": "retain_cloud_file"}},
    })
    assert missing_setting_keys(set(), document)[0][2] == {"policy": "retain_cloud_file"}
    assert missing_setting_keys({("assets", "deletion_policy")}, document) == []


def test_repo_defaults_resolve():
    settings = Settings(environment="testing")
    assert resolve_defaults_path(settings).name == "system-defaults.json"


def test_cache_rejects_an_older_revision():
    assert cache_accepts(None, 1)
    assert cache_accepts(4, 4)
    assert cache_accepts(4, 5)
    assert not cache_accepts(5, 4)


def test_retain_does_not_purge_and_shared_objects_stay():
    assert deletion_plan(policy="retain_cloud_file", editor_refs=0, other_ready=0) == "retain"
    assert deletion_plan(policy="delete_cloud_file", editor_refs=0, other_ready=1) == "retain"
    assert deletion_plan(policy="delete_cloud_file", editor_refs=0, other_ready=0) == "purge"
    assert deletion_plan(policy="delete_cloud_file", editor_refs=1, other_ready=0) == "blocked"


def test_missing_cloud_object_counts_as_purged():
    assert purge_outcome(missing=True, failed=False) == "purged"
    assert purge_outcome(missing=False, failed=True) == "failed"
    assert purge_outcome(missing=False, failed=False) == "purged"


def test_generated_key_is_stable_for_the_task():
    project_id, task_id = uuid4(), uuid4()
    assert generated_object_key(project_id, task_id, 1, "png") == (
        f"projects/{project_id}/assets/{task_id}/1.png"
    )
    items = describe_outputs(project_id, task_id, [(b"png-bytes", "image/png"), (b"mp4", "video/mp4")])
    assert items[0]["kind"] == "IMAGE"
    assert items[1]["object_key"].endswith("/2.mp4")
    assert items[0]["sha256"]


class _Store:
    def __init__(self, existing: int | None = None):
        self.existing = existing
        self.puts = 0

    async def stat_object(self, *, object_key: str) -> int | None:
        return self.existing

    async def put_object(self, *, object_key: str, content: bytes, content_type: str) -> None:
        self.puts += 1
        self.existing = len(content)


@pytest.mark.asyncio
async def test_upload_skips_when_the_same_object_is_already_stored():
    store = _Store(existing=4)
    await put_if_changed(store, object_key="k", content=b"abcd", content_type="image/png")
    assert store.puts == 0
    await put_if_changed(store, object_key="k", content=b"abcde", content_type="image/png")
    assert store.puts == 1


class _Broken:
    async def get_object(self, *, object_key: str) -> bytes:
        raise RuntimeError("gone")


class _Memory:
    def __init__(self):
        self.objects = {}
        self.bucket_name = "works"

    async def get_object(self, *, object_key: str) -> bytes:
        return self.objects[object_key]

    async def put_object(self, *, object_key: str, content: bytes, content_type: str) -> None:
        self.objects[object_key] = content


@pytest.mark.asyncio
async def test_legacy_migration_is_idempotent_and_reports_unreadable_files():
    source, destination = _Memory(), _Memory()
    source.objects["old"] = b"image"
    asset = SimpleNamespace(storage_provider="s3", object_key="old", mime="image/png", bucket="")
    assert await migrate_legacy_asset(asset, source, destination) == "migrated"
    assert asset.storage_provider == "qiniu"
    assert destination.objects["old"] == b"image"
    assert await migrate_legacy_asset(asset, source, destination) == "skipped"
    missing = SimpleNamespace(storage_provider="s3", object_key="missing", mime="image/png", bucket="")
    assert await migrate_legacy_asset(missing, _Broken(), destination) == "unrecoverable"
    assert missing.storage_provider == "s3"
