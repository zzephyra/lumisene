import asyncio
from time import perf_counter
from typing import Any, Protocol

from app.core.errors import ApplicationError
from app.core.logging import get_logger

from .base import ImageAdapter, ImageResults, SkillContext, SkillSnapshot
from .errors import SkillExecutionError, SkillValidationError
from .registry import SkillRegistry

logger = get_logger(__name__)
SCENE_FIELDS = {
    "scene",
    "subjects",
    "objects",
    "background",
    "lighting",
    "perspective",
    "camera",
    "style",
    "color_palette",
    "depth_of_field",
    "spatial_structure",
}


class SceneAnalyzer(Protocol):
    async def analyze(self, context: SkillContext) -> dict[str, Any]: ...


class SkillExecutor:
    def __init__(
        self, registry: SkillRegistry, scene_analyzer: SceneAnalyzer | None = None
    ) -> None:
        self.registry = registry
        self.scene_analyzer = scene_analyzer

    async def execute(
        self,
        *,
        skill_key: str,
        context: SkillContext,
        adapter: ImageAdapter,
        snapshot: SkillSnapshot | None = None,
    ) -> ImageResults:
        started = perf_counter()
        pinned = snapshot is not None
        fields = dict(
            trace_id=context.trace_id,
            skill_key=skill_key,
            skill_version=snapshot.version if snapshot else None,
            prompt_version=snapshot.prompt_version if snapshot else None,
            model=context.model.name,
            provider=context.model.provider,
        )
        success = False
        error = None
        try:
            snapshot = snapshot or self.registry.snapshot(skill_key, context.model)
            fields.update(skill_version=snapshot.version, prompt_version=snapshot.prompt_version)
            if snapshot.key != skill_key or snapshot.model != context.model:
                raise SkillValidationError("技能快照与当前操作或模型不一致")
            skill = self.registry.get(skill_key, snapshot.version, pinned=pinned)
            await asyncio.to_thread(skill.validate_input, context)
            if snapshot.scene_analysis and self.scene_analyzer:
                try:
                    result = await asyncio.wait_for(
                        self.scene_analyzer.analyze(context), timeout=15
                    )
                    # Bounded descriptive data, never instructions or provider credentials.
                    safe = {k: str(v)[:1000] for k, v in result.items() if k in SCENE_FIELDS}
                    context = context.model_copy(update={"scene_context": safe})
                except Exception as exc:
                    logger.warning(
                        "skill_scene_analysis_skipped", **fields, error=type(exc).__name__
                    )
            prompt = skill.build_prompt(context, snapshot)
            results = await skill.execute(
                context, prompt=prompt, snapshot=snapshot, adapter=adapter
            )
            success = True
            return results
        except ApplicationError as exc:
            error = type(exc).__name__
            raise
        except Exception as exc:
            error = type(exc).__name__
            raise SkillExecutionError("技能执行失败，请通过任务记录定位") from exc
        finally:
            logger.info(
                "skill_execution_finished",
                **fields,
                latency_ms=round((perf_counter() - started) * 1000),
                success=success,
                error=error,
            )
