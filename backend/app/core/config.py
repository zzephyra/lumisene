import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, Self
from urllib.parse import urlsplit

import yaml
from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.infrastructure.ai.domain import MEDIA_ASSIGNMENTS, ModelCapability

EnvironmentName = Literal["development", "testing", "staging", "production"]

# Development-only placeholder. Staging and production must replace it.
INSECURE_CSRF_SECRET = "development-only-csrf-secret-change-me"
LOCAL_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
SECRET_REF_NAME = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
PARAMETER_NAME = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
INPUT_MODALITIES = frozenset({"text", "image", "video", "audio"})
CONFIGURABLE_CAPABILITIES = frozenset(
    item.value for item in ModelCapability if item.value not in MEDIA_ASSIGNMENTS
)


class ModelAlias(BaseModel):
    model_config = ConfigDict(extra="forbid")

    zh: str = ""
    en: str = ""

    @field_validator("zh", "en")
    @classmethod
    def alias_text(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) > 32 or any(character in cleaned for character in "\r\n"):
            raise ValueError("model alias is invalid")
        return cleaned


class CatalogModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    alias: ModelAlias = Field(default_factory=ModelAlias)
    capabilities: list[str]
    inputs: list[str] = Field(default_factory=list)
    parameters: dict[str, Any] = Field(default_factory=dict)

    @field_validator("capabilities")
    @classmethod
    def known_capabilities(cls, value: list[str]) -> list[str]:
        if not 1 <= len(value) <= 8 or len(set(value)) != len(value):
            raise ValueError("model capabilities are invalid")
        if any(item not in CONFIGURABLE_CAPABILITIES | {"image_inpaint"} for item in value):
            raise ValueError("model capabilities are invalid")
        return value

    @field_validator("inputs")
    @classmethod
    def known_inputs(cls, value: list[str]) -> list[str]:
        if len(value) > 8 or len(set(value)) != len(value):
            raise ValueError("model inputs are invalid")
        if any(item not in INPUT_MODALITIES for item in value):
            raise ValueError("model inputs are invalid")
        return value

    @field_validator("parameters")
    @classmethod
    def parameter_choices(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(value) > 16:
            raise ValueError("model parameters are invalid")
        for key, item in value.items():
            if not isinstance(key, str) or PARAMETER_NAME.fullmatch(key) is None:
                raise ValueError("model parameters are invalid")
            if not isinstance(item, list) or not 1 <= len(item) <= 32:
                raise ValueError("model parameters are invalid")
            strings = all(isinstance(part, str) and 1 <= len(part) <= 64 for part in item)
            numbers = all(isinstance(part, int) and not isinstance(part, bool) for part in item)
            if not strings and not numbers:
                raise ValueError("model parameters are invalid")
        return value


class ModelEndpoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_url: str
    api_key: str
    alias: ModelAlias = Field(default_factory=ModelAlias)
    models: dict[str, CatalogModel] = Field(default_factory=dict)

    @model_validator(mode="after")
    def native_tool_capability(self):
        for name, model in self.models.items():
            if "image_inpaint" in model.capabilities and name not in {
                "image-out-painting",
                "wanx2.1-imageedit",
            }:
                raise ValueError("Only the native outpainting tool may register image_inpaint")
        return self

    @model_validator(mode="after")
    def named_models(self) -> Self:
        for name in self.models:
            if not 1 <= len(name) <= 128 or any(character.isspace() for character in name):
                raise ValueError("model name is invalid")
        return self


class Settings(BaseSettings):
    """Process configuration. Business code must use this object instead of os.getenv."""

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        extra="ignore",
    )

    environment: EnvironmentName = "development"
    log_level: str = "INFO"
    database_url: str = "postgresql+asyncpg://fluxora:fluxora@localhost:5432/fluxora"
    database_connect_timeout_seconds: float = 5.0
    session_ttl_seconds: int = Field(default=7 * 24 * 60 * 60, gt=0)
    # The API contract requires a short-lived pre-auth CSRF token but does not
    # fix the duration. Ten minutes matches the upload credential TTL.
    csrf_preauth_ttl_seconds: int = Field(default=10 * 60, gt=0)
    csrf_secret: str = INSECURE_CSRF_SECRET
    session_cookie_name: str = "fluxora_session"
    csrf_cookie_name: str = "fluxora_csrf"
    cors_allowed_origins: list[str] = Field(default_factory=list)
    # Comma-separated names of configured secrets. Values are never stored here.
    model_secret_refs: str = ""
    # JSON object kept for tests. Local configuration uses model_endpoints_file.
    model_endpoints: str = Field(default="", repr=False)
    # YAML file whose keys are the secret names a model may use.
    model_endpoints_file: str = ""
    s3_endpoint_url: str = ""
    s3_bucket: str = ""
    s3_region: str = "us-east-1"
    s3_access_key_id: str = ""
    s3_secret_access_key: str = Field(default="", repr=False)
    qiniu_access_key: str = ""
    qiniu_secret_key: str = Field(default="", repr=False)
    qiniu_bucket: str = ""
    qiniu_domain: str = ""
    qiniu_region: str = "z2"
    qiniu_upload_token_ttl_seconds: int = Field(default=3600, gt=0, le=7200)
    redis_url: str = "redis://localhost:6379/0"
    system_defaults_file: str = ""
    image_max_size: int = Field(default=20 * 1024 * 1024, gt=0)
    video_max_size: int = Field(default=512 * 1024 * 1024, gt=0)
    file_max_size: int = Field(default=50 * 1024 * 1024, gt=0)
    _parsed_endpoints: dict[str, ModelEndpoint] = PrivateAttr(default_factory=dict)

    @property
    def is_testing(self) -> bool:
        return self.environment == "testing"

    @property
    def session_cookie_secure(self) -> bool:
        """Secure cookies stay on outside local development and tests."""

        return self.environment not in ("development", "testing")

    @model_validator(mode="after")
    def enforce_deployed_auth_settings(self) -> Self:
        if not self.cors_allowed_origins and self.environment in ("development", "testing"):
            self.cors_allowed_origins = list(LOCAL_DEV_ORIGINS)
        if self.environment in ("staging", "production"):
            if not self.cors_allowed_origins or self.cors_allowed_origins == LOCAL_DEV_ORIGINS:
                raise ValueError(
                    "cors_allowed_origins must be set explicitly outside development and testing"
                )
            if self.csrf_secret == INSECURE_CSRF_SECRET or len(self.csrf_secret) < 32:
                raise ValueError(
                    "csrf_secret must be a non-default value of at least 32 characters"
                )
        for name in (part.strip() for part in self.model_secret_refs.split(",")):
            if name and SECRET_REF_NAME.fullmatch(name) is None:
                raise ValueError("model_secret_refs contains an invalid name")
        self._parsed_endpoints = _load_model_endpoints(
            self.model_endpoints,
            self.model_endpoints_file,
        )
        if not self.model_endpoints_file.strip():
            allowed = {part.strip() for part in self.model_secret_refs.split(",") if part.strip()}
            unknown = set(self._parsed_endpoints).difference(allowed)
            if unknown:
                raise ValueError("model endpoint name is not listed in model_secret_refs")
        return self

    @property
    def object_storage_configured(self) -> bool:
        return bool(
            self.s3_endpoint_url.strip()
            and self.s3_bucket.strip()
            and self.s3_access_key_id.strip()
            and self.s3_secret_access_key.strip()
        )

    @property
    def qiniu_configured(self) -> bool:
        return bool(
            self.qiniu_access_key.strip()
            and self.qiniu_secret_key.strip()
            and self.qiniu_bucket.strip()
            and self.qiniu_domain.strip()
            and self.qiniu_region.strip()
        )

    def upload_size_limit(self, category: str) -> int:
        if category == "image":
            return self.image_max_size
        if category == "video":
            return self.video_max_size
        if category == "file":
            return self.file_max_size
        raise ValueError("upload category is invalid")

    def configured_secret_refs(self) -> frozenset[str]:
        names = {part.strip() for part in self.model_secret_refs.split(",") if part.strip()}
        names.update(self._current_endpoints())
        return frozenset(names)

    def model_endpoint(self, secret_ref: str) -> tuple[str, str] | None:
        endpoint = self._current_endpoints().get(secret_ref)
        if endpoint is None:
            return None
        return endpoint.base_url, endpoint.api_key

    def endpoint_models(self, secret_ref: str) -> dict[str, CatalogModel] | None:
        endpoint = self._current_endpoints().get(secret_ref)
        if endpoint is None or not endpoint.models:
            return None
        return endpoint.models

    def provider_catalog(self) -> list[dict[str, Any]]:
        endpoints = self._current_endpoints()
        items: list[dict[str, Any]] = []
        for name in sorted(endpoints):
            endpoint = endpoints[name]
            if not endpoint.models:
                continue
            items.append(
                {
                    "id": name,
                    "alias_zh": endpoint.alias.zh,
                    "alias_en": endpoint.alias.en,
                    "models": [
                        {
                            "name": model_name,
                            "alias_zh": model.alias.zh,
                            "alias_en": model.alias.en,
                            "capabilities": list(model.capabilities),
                            "inputs": list(model.inputs),
                            "parameters": model.parameters,
                        }
                        for model_name, model in endpoint.models.items()
                    ],
                }
            )
        return items

    def _current_endpoints(self) -> dict[str, ModelEndpoint]:
        # The file can change without restarting the process. JSON settings stay cached.
        if self.model_endpoints_file.strip():
            self._parsed_endpoints = _load_model_endpoints("", self.model_endpoints_file)
        return self._parsed_endpoints


@lru_cache
def get_settings() -> Settings:
    return Settings()


def _load_model_endpoints(raw_json: str, file_path: str) -> dict[str, ModelEndpoint]:
    if file_path.strip():
        return _endpoints_from_mapping(_read_endpoints_file(file_path.strip()))
    return _parse_model_endpoints(raw_json)


def _read_endpoints_file(raw: str) -> object:
    path = _resolve_endpoints_file(raw)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        raise ValueError("model endpoints file was not found") from None
    try:
        return yaml.safe_load(text)
    except yaml.YAMLError:
        raise ValueError("model endpoints file is invalid") from None


def _resolve_endpoints_file(raw: str) -> Path:
    requested = Path(raw)
    if requested.is_absolute():
        if not requested.is_file():
            raise ValueError("model endpoints file was not found")
        return requested
    candidates = [
        Path.cwd() / requested,
        Path.cwd() / "backend" / requested,
        Path.cwd().parent / requested,
        Path.cwd().parent / "backend" / requested,
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise ValueError("model endpoints file was not found")


def _parse_model_endpoints(raw: str) -> dict[str, ModelEndpoint]:
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise ValueError("model_endpoints must be a JSON object") from None
    return _endpoints_from_mapping(parsed)


def _endpoints_from_mapping(parsed: object) -> dict[str, ModelEndpoint]:
    if parsed is None:
        return {}
    if not isinstance(parsed, dict):
        raise ValueError("model endpoints must be a mapping of names")
    endpoints: dict[str, ModelEndpoint] = {}
    for name, value in parsed.items():
        if not isinstance(name, str) or SECRET_REF_NAME.fullmatch(name) is None:
            raise ValueError("model endpoint name is invalid")
        if not isinstance(value, dict):
            raise ValueError("model endpoint must include base_url and api_key")
        try:
            endpoint = ModelEndpoint.model_validate(value)
        except ValueError:
            raise ValueError("model endpoint must include base_url and api_key") from None
        _validate_base_url(endpoint.base_url)
        if not endpoint.api_key.strip():
            raise ValueError("model endpoint api key is missing")
        endpoints[name] = endpoint
    return endpoints


def _validate_base_url(value: str) -> None:
    parts = urlsplit(value.strip())
    if (
        parts.scheme != "https"
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.fragment
    ):
        raise ValueError("model endpoint base_url must be an https URL without credentials")
