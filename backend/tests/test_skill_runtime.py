import pytest
from app.infrastructure.ai.skills.errors import SkillNotFoundError
from app.infrastructure.ai.skills.registry import default_registry


def test_retired_outpainting_cannot_execute_old_prompt_skill():
    with pytest.raises(SkillNotFoundError):
        default_registry().get("image.outpainting", "1.0.0", pinned=True)
