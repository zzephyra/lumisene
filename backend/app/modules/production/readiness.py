"""Server-owned board readiness; billing is deferred."""

from app.modules.production.schemas import Board, Readiness


def readiness(board: Board) -> Readiness:
    shots = [s for c in board.scenes for s in c.shots]
    pending = sum(not s.selected_video_id for s in shots)
    if not shots:
        return Readiness(
            allowed=False, billing="unavailable", message="请先添加分镜", pending_shots=0
        )
    if pending:
        return Readiness(
            allowed=True, billing="disabled", pending_shots=pending, message="分镜已就绪"
        )
    return Readiness(
        allowed=True,
        billing="no_generation",
        pending_shots=0,
        message="所有镜头已有视频，可直接合成",
    )
