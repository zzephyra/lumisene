import asyncio
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from app.core.errors import ProviderTaskFailedError
from app.infrastructure.ai.adapters.dashscope_video import DashScopeVideo
from app.modules.generation.video import VideoGenerationService


def test_provider_algorithm_failure_keeps_code_but_hides_trace():
    def post(*args):
        return 200, {
            "output": {"task_status": "FAILED", "code": "AlgoError", "message": "secret traceback"}
        }

    with pytest.raises(ProviderTaskFailedError) as failure:
        asyncio.run(
            DashScopeVideo(post=post).poll(
                base_url="https://example.test", api_key="test", provider_task_id="task"
            )
        )
    assert "AlgoError" in failure.value.message
    assert "secret" not in failure.value.message


def test_terminal_failure_is_not_retried_as_poll_transport_error():
    service = object.__new__(VideoGenerationService)
    service._load_poll = AsyncMock(return_value=(uuid4(), "task", None))
    service.finish_persisted = AsyncMock(return_value=False)
    service._call_poll = AsyncMock(side_effect=ProviderTaskFailedError("算法失败（AlgoError）"))
    service._fail = AsyncMock()
    service._schedule = AsyncMock()
    identity = uuid4()
    asyncio.run(service.poll(identity))
    service._fail.assert_awaited_once_with(identity, "provider_failed", "算法失败（AlgoError）")
    service._schedule.assert_not_awaited()
