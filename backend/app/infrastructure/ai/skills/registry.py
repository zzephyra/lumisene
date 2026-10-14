import hashlib
import json

from .base import BaseSkill, ModelInfo, SkillSnapshot
from .errors import SkillDisabledError, SkillNotFoundError, SkillValidationError
from .prompt_builder import CONSTRAINTS


class SkillRegistry:
    def __init__(self) -> None:
        self._skills: dict[tuple[str, str], BaseSkill] = {}
        self._active: dict[str, str] = {}

    def register(self, skill: BaseSkill) -> None:
        identity = (skill.key, skill.version)
        if identity in self._skills:
            raise SkillValidationError("重复注册技能版本")
        self._skills[identity] = skill
        self._active[skill.key] = skill.version

    def get(self, key: str, version: str | None = None, *, pinned: bool = False) -> BaseSkill:
        skill = self._skills.get((key, version or self._active.get(key, "")))
        if skill is None:
            raise SkillNotFoundError("技能或版本尚未实现")
        if not pinned and not skill.config.enabled:
            raise SkillDisabledError("技能已停用")
        return skill

    def snapshot(self, key: str, model: ModelInfo) -> SkillSnapshot:
        skill = self.get(key)
        if skill.supported_models and model.name not in skill.supported_models:
            raise SkillValidationError("当前统一模型不在该技能支持列表中")
        override = skill.config.model_overrides.get(model.name, "")
        templates = {}
        digest = hashlib.sha256(
            (
                skill.system_prompt
                + "\n"
                + skill.refine_prompt
                + "\n"
                + override
                + "\n"
                + CONSTRAINTS
                + json.dumps(templates, sort_keys=True)
            ).encode()
        ).hexdigest()
        return SkillSnapshot(
            key=key,
            version=skill.version,
            prompt_version=digest,
            system_prompt=skill.system_prompt,
            task_templates=templates,
            refine_prompt=skill.refine_prompt,
            constraints=CONSTRAINTS,
            model_override=override,
            model=model,
            scene_analysis=skill.config.scene_analysis,
        )


def default_registry() -> SkillRegistry:
    """Only registered implementations can execute; native outpaint has no prompt skill."""
    return SkillRegistry()
