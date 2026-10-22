"""Structural shot review. Same place with a new action is not a duplicate."""

import re
from difflib import SequenceMatcher

from app.modules.production.schemas import Board, Shot

_CLONE = re.compile(r"（\d+/\d+）$")


def find_duplicates(board: Board) -> list[str]:
    shots = [shot for scene in board.scenes for shot in scene.shots]
    notes: list[str] = []
    for index, left in enumerate(shots):
        for right_index, right in enumerate(shots[index + 1 :], index + 1):
            if _same_picture(left, right):
                notes.append(
                    f"镜头 {index + 1:02d} 与镜头 {right_index + 1:02d} 内容相似，建议检查。"
                    "请改写动作、合并镜头，或重新规划不同事件。"
                )
    return notes[:12]


def _same_picture(left: Shot, right: Shot) -> bool:
    left_motion = _motion(left)
    right_motion = _motion(right)
    description = SequenceMatcher(None, _text(left.description), _text(right.description)).ratio()
    action = SequenceMatcher(None, left_motion, right_motion).ratio()
    prompt = SequenceMatcher(None, _text(left.prompt), _text(right.prompt)).ratio()
    same_camera = _text(left.framing) == _text(right.framing) and _text(left.movement) == _text(
        right.movement
    )
    copied_prompt = len(_text(left.prompt)) >= 12 and prompt == 1
    copied_description = len(_text(left.description)) >= 8 and description == 1
    if left.narrative_role != right.narrative_role or _text(left.emotion) != _text(right.emotion):
        return False
    if not same_camera or _text(left.angle) != _text(right.angle):
        return False
    if left.action and right.action and _text(left.action) != _text(right.action):
        return False
    if copied_prompt and copied_description:
        return True
    if len(left_motion) < 8 or len(right_motion) < 8:
        return False
    # A shared location is not enough. The action has to stay essentially the same.
    return same_camera and action >= 0.72 and description >= 0.62


def _text(value: str) -> str:
    return _CLONE.sub("", "".join(value.split())).casefold()


def _motion(shot: Shot) -> str:
    return _text(shot.action + shot.description)
