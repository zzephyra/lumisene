import json
import math
import re
from enum import StrEnum
from typing import Any

from app.core.errors import ValidationError

MAX_MODEL_CONFIGS = 200
PROMPT_MAX_LENGTH = 10_000
TEXT_COMPLETION_CONTENT_MAX = 100_000
IMAGE_BYTES_MAX = 20 * 1024 * 1024
QWEN_REFERENCE_EDIT_MODELS = frozenset(
    {
        "qwen-image-2.0",
        "qwen-image-3.0",
        "qwen-image-3.0-pro",
    }
)
# qwen-image-2.0 rejects data-URI references on compatible images/generations.
QWEN_NATIVE_EDIT_MODELS = frozenset({"qwen-image-2.0"})
# wan3.0-video accepts a first-frame media item, not the older img_url field.
WAN3_MEDIA_VIDEO_MODELS = frozenset({"wan3.0-video"})
VIDEO_BYTES_MAX = 80 * 1024 * 1024
MAX_JSON_BYTES = 8192
MAX_JSON_STRING = 500
SECRET_REF_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
TOKEN_PATTERN = re.compile(r"(?i)(?:sk-|rk-|key-|bearer\s)")
FORBIDDEN_JSON_KEYS = frozenset(
    {"api_key", "apikey", "secret", "access_token", "authorization", "password"}
)


class ModelCapability(StrEnum):
    TEXT_GENERATION = "text_generation"
    EMBEDDING = "embedding"
    TEXT_TO_VIDEO = "text_to_video"
    IMAGE_TO_VIDEO = "image_to_video"
    IMAGE_INPAINT = "image_inpaint"
    TEXT_TO_IMAGE = "text_to_image"
    SPEECH_SYNTHESIS = "speech_synthesis"
    SPEECH_RECOGNITION = "speech_recognition"


class AuditAction(StrEnum):
    CREATED = "created"
    DISABLED = "disabled"
    ENABLED = "enabled"
    ASSIGNED = "assigned"
    UNASSIGNED = "unassigned"


def clean_provider(value: str) -> str:
    return _clean_name(value, max_length=64, label="Provider")


def clean_model_name(value: str) -> str:
    return _clean_name(value, max_length=128, label="Model name")


def clean_capability(value: str) -> str:
    try:
        return ModelCapability(value).value
    except ValueError as exc:
        raise ValidationError("Capability is not supported") from exc


def json_object(value: object, *, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"{label} must be a JSON object")
    _reject_secret_material(value)
    try:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{label} must be a JSON object") from exc
    if len(encoded.encode("utf-8")) > MAX_JSON_BYTES:
        raise ValidationError(f"{label} is too large")
    return value


def _clean_name(value: str, *, max_length: int, label: str) -> str:
    cleaned = value.strip()
    if not 1 <= len(cleaned) <= max_length or any(character.isspace() for character in cleaned):
        raise ValidationError(f"{label} is invalid")
    return cleaned


def _reject_secret_material(value: object) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or key.lower() in FORBIDDEN_JSON_KEYS:
                raise ValidationError("Request must not include a secret")
            _reject_secret_material(item)
        return
    if isinstance(value, list):
        for item in value:
            _reject_secret_material(item)
        return
    if isinstance(value, str):
        if len(value) > MAX_JSON_STRING or TOKEN_PATTERN.search(value):
            raise ValidationError("Request must not include a secret")
        return
    if isinstance(value, bool) or value is None or isinstance(value, int):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValidationError("Parameters must be JSON")
        return
    raise ValidationError("Parameters must be JSON")


MEDIA_ASSIGNMENTS = {"image_inpaint": "text_to_image", "image_to_video": "text_to_video"}


def assignment_capability(value: str) -> str:
    selected = clean_capability(value)
    return MEDIA_ASSIGNMENTS.get(selected, selected)


def configurable_capability(value: str) -> str:
    selected = clean_capability(value)
    if selected in MEDIA_ASSIGNMENTS:
        raise ValidationError("请统一配置图片生成或视频生成模型，无需单独配置此操作")
    return selected
