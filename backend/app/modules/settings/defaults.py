"""Load the seed file. It never overwrites settings an administrator already saved."""

import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError as ModelError

from app.core.config import Settings
from app.core.errors import ValidationError

DELETION_POLICIES = frozenset({"retain_cloud_file", "delete_cloud_file"})


class AssetDefaults(BaseModel):
    model_config = ConfigDict(extra="forbid")

    deletion_policy: str

    def checked(self) -> str:
        if self.deletion_policy not in DELETION_POLICIES:
            raise ValueError("deletion policy is invalid")
        return self.deletion_policy


class SettingsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assets: AssetDefaults


class DefaultsDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = Field(ge=1)
    settings: SettingsBody


def resolve_defaults_path(settings: Settings) -> Path:
    if settings.system_defaults_file.strip():
        return Path(settings.system_defaults_file.strip())
    repo = Path(__file__).resolve().parents[4]
    return repo / "config" / "system-defaults.json"


def load_defaults(settings: Settings) -> DefaultsDocument:
    path = resolve_defaults_path(settings)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        document = DefaultsDocument.model_validate(payload)
        document.settings.assets.checked()
    except (OSError, json.JSONDecodeError, ModelError, ValueError) as exc:
        raise ValidationError("系统默认配置无法读取或校验失败") from exc
    return document


def missing_setting_keys(existing: set[tuple[str, str]], document: DefaultsDocument) -> list[tuple[str, str, dict]]:
    """Return only keys the database does not have yet."""

    wanted = [("assets", "deletion_policy", {"policy": document.settings.assets.deletion_policy})]
    return [item for item in wanted if (item[0], item[1]) not in existing]


def cache_accepts(current_revision: int | None, incoming_revision: int) -> bool:
    """A delayed writer must not replace a newer cached revision."""

    return current_revision is None or incoming_revision >= current_revision
