"""Qiniu Kodo adapter. The secret key stays in this process and is never returned."""

from urllib.parse import quote, urlsplit

from app.core.config import Settings
from app.core.errors import ProviderError, StorageUnavailableError
from app.infrastructure.storage.provider import ObjectStat, StoredObject, UploadGrant

_UPLOAD_HOSTS = {
    "z0": "https://upload.qiniup.com",
    "z1": "https://upload-z1.qiniup.com",
    "z2": "https://upload-z2.qiniup.com",
    "na0": "https://upload-na0.qiniup.com",
    "as0": "https://upload-as0.qiniup.com",
    "cn-east-2": "https://upload-cn-east-2.qiniup.com",
}
_REGION_ALIASES = {
    "华东": "z0",
    "华东-浙江": "z0",
    "华北": "z1",
    "华北-河北": "z1",
    "华南": "z2",
    "华南-广东": "z2",
    "北美": "na0",
    "东南亚": "as0",
}


class QiniuStorageProvider:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def generate_upload_token(self, *, key: str, content_type: str, size: int) -> UploadGrant:
        self._require_config()
        auth = self._auth()
        policy = {
            "insertOnly": 1,
            "mimeLimit": content_type,
            "fsizeLimit": size,
            "fsizeMin": 1,
        }
        expires = self._settings.qiniu_upload_token_ttl_seconds
        token = auth.upload_token(self._settings.qiniu_bucket.strip(), key, expires, policy)
        return UploadGrant(
            token=token,
            upload_url=self.upload_url(),
            domain=self._domain(),
            expires_in=expires,
        )

    def upload_bytes(self, *, key: str, content: bytes, content_type: str) -> StoredObject:
        from qiniu import put_data

        grant = self.generate_upload_token(key=key, content_type=content_type, size=len(content))
        _ret, info = put_data(grant.token, key, content, mime_type=content_type)
        self._require_ok(info, "The object store rejected the upload")
        return StoredObject(key=key, url=self.public_url(key), size=len(content))

    def upload_path(self, *, key: str, path: str, content_type: str) -> StoredObject:
        from qiniu import put_file

        size = _file_size(path)
        grant = self.generate_upload_token(key=key, content_type=content_type, size=size)
        _ret, info = put_file(grant.token, key, path, mime_type=content_type)
        self._require_ok(info, "The object store rejected the upload")
        return StoredObject(key=key, url=self.public_url(key), size=size)

    def stat(self, key: str) -> ObjectStat | None:
        from qiniu import BucketManager

        self._require_config()
        _ret, info = BucketManager(self._auth()).stat(self._settings.qiniu_bucket.strip(), key)
        if getattr(info, "status_code", None) == 612:
            return None
        self._require_ok(info, "The object store could not confirm the file")
        body = info.json() if hasattr(info, "json") else None
        if not isinstance(body, dict):
            body = _ret if isinstance(_ret, dict) else None
        if not isinstance(body, dict):
            raise ProviderError("The object store could not confirm the file")
        size = body.get("fsize")
        mime = body.get("mimeType")
        if isinstance(size, bool) or not isinstance(size, int) or not isinstance(mime, str):
            raise ProviderError("The object store could not confirm the file")
        return ObjectStat(size=size, mime_type=mime.strip().lower())

    def delete(self, key: str) -> None:
        from qiniu import BucketManager

        self._require_config()
        _ret, info = BucketManager(self._auth()).delete(self._settings.qiniu_bucket.strip(), key)
        if getattr(info, "status_code", None) == 612:
            return
        self._require_ok(info, "The object store could not delete the file")

    def public_url(self, key: str) -> str:
        return f"{self._domain()}/{quote(key)}"

    def private_download_url(self, key: str, expires: int = 300) -> str:
        self._require_config()
        return self._auth().private_download_url(self.public_url(key), expires=expires)

    def upload_url(self) -> str:
        configured = self._settings.qiniu_region.strip()
        region = _REGION_ALIASES.get(configured, configured)
        host = _UPLOAD_HOSTS.get(region)
        if host is None:
            raise StorageUnavailableError("Upload region is not configured")
        return host

    def _auth(self):
        from qiniu import Auth

        access_key = self._settings.qiniu_access_key.strip()
        secret_key = self._settings.qiniu_secret_key.strip()
        return Auth(access_key, secret_key)

    def _require_config(self) -> None:
        if not self._settings.qiniu_configured:
            raise StorageUnavailableError("Upload storage is not configured")

    def _domain(self) -> str:
        raw = self._settings.qiniu_domain.strip().rstrip("/")
        parts = urlsplit(raw if "://" in raw else f"https://{raw}")
        if parts.scheme not in {"http", "https"} or not parts.hostname:
            raise StorageUnavailableError("Upload storage is not configured")
        if parts.username or parts.password:
            raise StorageUnavailableError("Upload storage is not configured")
        host = parts.hostname
        if host.endswith(".clouddn.com") and parts.scheme == "https":
            return f"http://{host}"
        return f"{parts.scheme}://{host}"

    def _require_ok(self, info: object, message: str) -> None:
        status = getattr(info, "status_code", None)
        if status is None or status < 200 or status >= 300:
            raise ProviderError(message)


def _file_size(path: str) -> int:
    from pathlib import Path

    size = Path(path).stat().st_size
    if size < 1:
        raise ProviderError("The object store rejected the upload")
    return size
