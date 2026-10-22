"""Editorial estimates, not provider requests or measured audio durations."""

from app.modules.production.continuity import find_duplicates
from app.modules.production.schemas import Board, ProductionSettings

WEIGHTS = {
    "conflict": 1.5,
    "dialogue": 1.25,
    "climax": 1.8,
    "transition": 0.65,
    "establishing": 0.8,
    "action": 1.2,
    "turning_point": 1.6,
}


def allocate(board: Board, settings: ProductionSettings, supported: list[int]) -> Board:
    result = board.model_copy(deep=True)
    shots = [shot for scene in result.scenes for shot in scene.shots]
    if not shots:
        return result
    risks = list(result.risks)
    pace = {"slow": 1.4, "balanced": 1.0, "fast": 0.65}[settings.pacing]
    weights = [
        WEIGHTS[shot.narrative_role]
        * (pace if shot.narrative_role in {"transition", "establishing"} else 1)
        + min(len(shot.dialogue) / 80, 4)
        + min(len(shot.action) / 150, 1)
        for shot in shots
    ]
    target = settings.target_duration
    durations = [round(target * weight / sum(weights), 2) for weight in weights]
    durations[-1] = round(target - sum(durations[:-1]), 2)
    for shot, duration in zip(shots, durations, strict=True):
        shot.duration = max(0.1, min(120, duration))
    cap = max(supported) if supported else None
    if cap is None:
        risks.append("部分镜头时长超出当前模型单次能力，需拆分镜头或调整制作计划。")
    else:
        _cap_without_copying(result, cap, risks)
    shots = [shot for scene in result.scenes for shot in scene.shots]
    risks.extend(find_duplicates(result))
    for shot in shots:
        choices = sorted(value for value in supported if value >= shot.duration)
        shot.generation_duration = choices[0] if choices else None
        if shot.dialogue and len(shot.dialogue) / 4 > shot.duration:
            risks.append("部分对白可能超出分配时长；这是按文字长度的粗略提示，需配音后复核。")
        if supported and shot.generation_duration is None:
            risks.append("部分镜头时长超出当前模型单次能力，需拆分镜头或调整制作计划。")
    if abs(sum(shot.duration for shot in shots) - target) > 0.1:
        risks.append("镜头数量及单镜头边界无法满足目标时长，请调整范围或镜头数量。")
    risks.append("计划时长不等于成片时长；实际生成、剪辑和音频时长需单独确认。")
    too_much_dialogue = any(len(shot.dialogue) / 4 > shot.duration for shot in shots)
    if settings.retention == "strict" and too_much_dialogue:
        risks.append("严格保留策略与目标时长可能冲突，请延长目标时长。")
    result.risks = list(dict.fromkeys(risks))[:30]
    return result


def _cap_without_copying(board: Board, cap: int, risks: list[str]) -> None:
    """A long beat becomes one model clip. Copying it would repeat the same picture."""
    if any(shot.duration > cap for scene in board.scenes for shot in scene.shots):
        risks.append(
            "部分镜头长于模型单次上限，只保留一段可生成时长，不会复制同一画面来凑目标时长。请按不同事件增加镜头。"
        )
    for scene in board.scenes:
        for shot in scene.shots:
            if shot.duration > cap:
                shot.duration = float(cap)
