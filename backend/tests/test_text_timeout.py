"""Background planning gets a longer bounded provider timeout, without retries."""
import asyncio

import pytest
from app.core.errors import TimeoutError as ProviderTimeout
from app.infrastructure.ai.adapters.openai_compatible import OpenAICompatibleChat, _TransportFailure
from app.infrastructure.ai.text_completion import TextCompletionService

from tests.conftest import make_settings


def test_worker_passes_configured_timeout_to_transport():
    service = TextCompletionService(make_settings(text_completion_timeout_seconds=240))
    seen = []

    def post(url, key, payload, timeout):
        seen.append(timeout)
        return 200, {"choices": [{"message": {"content": "result"}}]}

    service.client._post = post
    result = asyncio.run(service.client.complete(
        base_url="https://example.test/v1", api_key="test", model="test", prompt="plan"
    ))
    assert result == "result"
    assert seen == [240]


def test_timeout_is_reported_without_automatic_duplicate_request():
    calls = []

    def post(url, key, payload, timeout):
        calls.append(timeout)
        raise _TransportFailure("timeout")

    with pytest.raises(ProviderTimeout):
        asyncio.run(OpenAICompatibleChat(post, timeout_seconds=300).complete(
            base_url="https://example.test/v1", api_key="test", model="test", prompt="plan"
        ))
    assert calls == [300]
