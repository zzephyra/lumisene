"""Direct-upload rules. The object store is a stand-in; the secret must stay on the server."""

import base64
import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from app.core.errors import NotFoundError, ValidationError
from app.infrastructure.db.session import UnitOfWork
from app.infrastructure.storage.provider import ObjectStat, StoredObject, UploadGrant
from app.infrastructure.storage.qiniu import QiniuStorageProvider
from app.infrastructure.storage.service import StorageService
from app.modules.uploads.domain import (
    display_filename,
    extension_for,
    key_belongs_to_user,
    object_key,
)
from app.modules.uploads.models import UploadFile
from app.modules.uploads.router import router
from app.modules.uploads.schemas import UploadTokenResponse
from app.modules.uploads.service import UploadService

from tests.conftest import make_settings

USER_ID = UUID("719fc7dd-8554-4001-a9c3-8868825b5417")
OTHER_ID = UUID("c3a87959-7ae3-416c-b0e4-b59a7b7b71f2")
SECRET = "server-only-secret-value"


class MemorySession:
    async def flush(self) -> None:
        return None

    async def scalar(self, _statement: object) -> int:
        return 0


class MemoryUnitOfWork(UnitOfWork):
    def __init__(self) -> None:
        super().__init__(MemorySession())  # type: ignore[arg-type]
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1


class MemoryUploads:
    def __init__(self) -> None:
        self.rows: list[UploadFile] = []

    async def add(self, session: object, upload: UploadFile) -> None:
        self.rows.append(upload)

    async def get_for_user(
        self,
        session: object,
        user_id: UUID,
        upload_id: UUID,
    ) -> UploadFile | None:
        for row in self.rows:
            if row.user_id == user_id and row.id == upload_id:
                return row
        return None

    async def get_by_key_for_user(
        self,
        session: object,
        user_id: UUID,
        object_key_value: str,
    ) -> UploadFile | None:
        for row in self.rows:
            if row.user_id == user_id and row.object_key == object_key_value:
                return row
        return None

    async def list_uploaded(self, session: object, user_id: UUID, limit: int) -> list[UploadFile]:
        rows = [row for row in self.rows if row.user_id == user_id and row.status == "uploaded"]
        return rows[:limit]


class RecordingProvider:
    def __init__(self) -> None:
        self.objects: dict[str, ObjectStat] = {}
        self.deleted: list[str] = []
        self.tokens: list[tuple[str, str, int]] = []

    def generate_upload_token(self, *, key: str, content_type: str, size: int) -> UploadGrant:
        self.tokens.append((key, content_type, size))
        return UploadGrant(
            token="signed-upload-grant",
            upload_url="https://upload-z2.qiniup.com",
            domain="http://cdn.example.test",
            expires_in=3600,
        )

    def upload_bytes(self, *, key: str, content: bytes, content_type: str) -> StoredObject:
        self.objects[key] = ObjectStat(size=len(content), mime_type=content_type)
        return StoredObject(key=key, url=self.public_url(key), size=len(content))

    def upload_path(self, *, key: str, path: str, content_type: str) -> StoredObject:
        raise AssertionError(path)

    def stat(self, key: str) -> ObjectStat | None:
        return self.objects.get(key)

    def delete(self, key: str) -> None:
        self.deleted.append(key)
        self.objects.pop(key, None)

    def public_url(self, key: str) -> str:
        return f"http://cdn.example.test/{key}"


def settings():
    return make_settings(
        qiniu_access_key="public-access-key",
        qiniu_secret_key=SECRET,
        qiniu_bucket="fluxora",
        qiniu_domain="https://cdn.example.clouddn.com",
        qiniu_region="华南-广东",
        image_max_size=20,
        video_max_size=30,
        file_max_size=10,
    )


def service(
    provider: RecordingProvider | None = None,
) -> tuple[UploadService, RecordingProvider, MemoryUploads]:
    store = provider or RecordingProvider()
    repository = MemoryUploads()
    return UploadService(settings(), store, repository), store, repository  # type: ignore[arg-type]


def test_object_key_is_server_owned_and_rejects_traversal() -> None:
    file_id = uuid4()
    now = datetime(2026, 9, 28, tzinfo=UTC)
    key = object_key("video", USER_ID, "mp4", now, file_id)
    assert key == f"uploads/video/{USER_ID}/2026/09/{file_id}.mp4"
    assert key_belongs_to_user(key, USER_ID)
    assert key_belongs_to_user(key, OTHER_ID) is False
    traversed = f"uploads/video/{USER_ID}/2026/09/../{file_id}.mp4"
    assert key_belongs_to_user(traversed, USER_ID) is False
    assert display_filename("../../secret.mp4") == "secret.mp4"
    with pytest.raises(ValidationError):
        display_filename("..")
    assert extension_for("clip.mp4", "video/mp4", "video") == "mp4"
    with pytest.raises(ValidationError):
        extension_for("clip.exe", "application/x-msdownload", "file")


def test_routes_do_not_accept_a_client_user_id() -> None:
    paths = {getattr(route, "path", "") for route in router.routes}
    assert "/api/v1/uploads/token" in paths
    assert "/api/v1/uploads/complete" in paths
    assert "/api/v1/uploads/{upload_id}" in paths
    fields = set(UploadTokenResponse.model_fields)
    assert "secret" not in fields
    assert "secret_key" not in fields


@pytest.mark.asyncio
async def test_token_uses_the_session_user_and_omits_the_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(
        "app.modules.uploads.service.logger.info",
        lambda event, **kwargs: events.append((event, kwargs)),
    )
    uploads, store, _repository = service()
    uow = MemoryUnitOfWork()
    token, key, domain, upload_url, expires_in = await uploads.issue_token(
        uow,
        USER_ID,
        filename="../../demo.mp4",
        content_type="video/mp4",
        size=12,
        category="video",
        key=None,
    )
    assert token == "signed-upload-grant"
    assert key.startswith(f"uploads/video/{USER_ID}/")
    assert domain == "http://cdn.example.test"
    assert upload_url == "https://upload-z2.qiniup.com"
    assert expires_in == 3600
    assert SECRET not in token
    assert SECRET not in str(events)
    assert events[0][0] == "upload_token_generated"
    assert "token" not in events[0][1]
    refreshed, same_key, *_rest = await uploads.issue_token(
        uow,
        USER_ID,
        filename="demo.mp4",
        content_type="video/mp4",
        size=12,
        category="video",
        key=key,
    )
    assert refreshed == token
    assert same_key == key
    assert store.tokens[-1][0] == key
    with pytest.raises(ValidationError):
        await uploads.issue_token(
            uow,
            USER_ID,
            filename="demo.mp4",
            content_type="video/mp4",
            size=31,
            category="video",
            key=None,
        )


@pytest.mark.asyncio
async def test_complete_confirms_the_object_and_delete_is_authorized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    monkeypatch.setattr(
        "app.modules.uploads.service.logger.info",
        lambda event, **kwargs: events.append(event),
    )
    uploads, store, repository = service()
    uow = MemoryUnitOfWork()
    _token, key, *_rest = await uploads.issue_token(
        uow,
        USER_ID,
        filename="still.png",
        content_type="image/png",
        size=8,
        category="image",
        key=None,
    )
    with pytest.raises(ValidationError):
        await uploads.complete(uow, USER_ID, key)
    row = repository.rows[0]
    assert row.status == "pending"
    with pytest.raises(NotFoundError):
        await uploads.complete(uow, OTHER_ID, key)
    store.objects[key] = ObjectStat(size=8, mime_type="image/jpeg")
    with pytest.raises(ValidationError):
        await uploads.complete(uow, USER_ID, key)
    assert row.status == "failed"
    assert key in store.deleted
    row.status = "pending"
    store.objects[key] = ObjectStat(size=8, mime_type="image/png")
    saved = await uploads.complete(uow, USER_ID, key)
    assert saved.status == "uploaded"
    assert saved.url.endswith(key)
    assert "upload_completed" in events
    with pytest.raises(NotFoundError):
        await uploads.delete(uow, OTHER_ID, saved.id)
    await uploads.delete(uow, USER_ID, saved.id)
    assert saved.status == "deleted"
    assert store.deleted[-1] == key
    assert "upload_deleted" in events
    assert SECRET not in str(events)


def test_worker_upload_builds_its_own_key() -> None:
    store = RecordingProvider()
    result = StorageService(settings(), store).upload_bytes(
        b"frames",
        "generated/video",
        content_type="video/mp4",
        extension="mp4",
    )
    assert str(result["key"]).startswith("uploads/generated/video/")
    assert result["size"] == 6
    assert SECRET not in str(result)


def test_qiniu_upload_host_and_test_domain() -> None:
    provider = QiniuStorageProvider(settings())
    assert provider.upload_url() == "https://upload-z2.qiniup.com"
    assert provider.public_url("uploads/image/a/2026/09/file.png").startswith("http://cdn.example.clouddn.com/")


def test_qiniu_token_policy_does_not_embed_the_secret() -> None:
    pytest.importorskip("qiniu")
    provider = QiniuStorageProvider(settings())
    grant = provider.generate_upload_token(
        key="uploads/image/a/2026/09/file.png",
        content_type="image/png",
        size=8,
    )
    assert SECRET not in grant.token
    encoded = grant.token.split(":")[-1]
    padding = "=" * (-len(encoded) % 4)
    policy = json.loads(base64.urlsafe_b64decode(encoded + padding))
    assert policy["insertOnly"] == 1
    assert policy["mimeLimit"] == "image/png"
    assert policy["fsizeLimit"] == 8
    assert policy["scope"] == "fluxora:uploads/image/a/2026/09/file.png"
    assert "secret" not in policy
