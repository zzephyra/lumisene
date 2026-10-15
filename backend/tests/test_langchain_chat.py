import json

import httpx
import pytest
from app.core.errors import ProviderError, RateLimitError
from app.infrastructure.ai.adapters.langchain_chat import LangChainCreativeChat


@pytest.mark.asyncio
@pytest.mark.parametrize("model", ["deepseek-chat", "deepseek-flash", "other-model"])
@pytest.mark.parametrize(
    "intent,prompt", [("chat", None), ("image_generation", "白色猫咪"), ("clarification", None)]
)
async def test_real_langchain_pipeline_parses_structured_response(intent, prompt, model):
    requests = []

    def respond(request):
        body = json.loads(request.content)
        requests.append(body)
        assert body["model"] == model
        if model == "deepseek-flash":
            assert body["thinking"] == {"type": "disabled"}
        else:
            assert "thinking" not in body
        assert body["response_format"] == {"type": "json_object"}
        assert body["messages"][-1]["content"] == "按刚才说的画一张"
        previous = json.loads(body["messages"][2]["content"])
        assert previous["reply"] == "白色的猫吗？"
        assert previous["generation_prompt"] is None
        assert "不要生成" in body["messages"][0]["content"]
        return httpx.Response(
            200,
            json={
                "id": "chat-1",
                "object": "chat.completion",
                "created": 1,
                "model": "deepseek-chat",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": json.dumps(
                                {"reply": "你好", "intent": intent, "generation_prompt": prompt}
                            ),
                        },
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    result = await LangChainCreativeChat(httpx.MockTransport(respond)).converse(
        base_url="https://example.test/v1",
        api_key="test",
        model=model,
        messages=[
            {"role": "user", "content": "一只猫"},
            {"role": "assistant", "content": "白色的猫吗？"},
            {"role": "user", "content": "按刚才说的画一张"},
        ],
    )
    assert result.intent == intent
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_rate_limit_does_not_retry_or_expose_secret():
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(429, json={"error": {"message": "private-provider-details"}})

    with pytest.raises(RateLimitError) as error:
        await LangChainCreativeChat(httpx.MockTransport(respond)).converse(
            base_url="https://example.test/v1", api_key="test", model="deepseek-chat", messages=[]
        )
    assert "private-provider-details" not in str(error.value)
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_invalid_generation_proposal_fails_closed():
    def respond(request):
        return httpx.Response(
            200,
            json={
                "id": "c",
                "object": "chat.completion",
                "created": 1,
                "model": "deepseek-chat",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": json.dumps(
                                {
                                    "reply": "ok",
                                    "intent": "image_generation",
                                    "generation_prompt": None,
                                }
                            ),
                        },
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    with pytest.raises(ProviderError):
        await LangChainCreativeChat(httpx.MockTransport(respond)).converse(
            base_url="https://example.test/v1", api_key="test", model="deepseek-chat", messages=[]
        )


@pytest.mark.asyncio
async def test_stream_exposes_reply_before_completion_without_json():
    updates = []
    chunks = ['{"reply":"你', '好","intent":"chat",', '"generation_prompt":null}']

    def respond(request):
        assert json.loads(request.content)["stream"] is True
        events = []
        for part in chunks:
            events.append(
                "data: "
                + json.dumps(
                    {
                        "id": "s",
                        "object": "chat.completion.chunk",
                        "created": 1,
                        "model": "deepseek-flash",
                        "choices": [
                            {
                                "index": 0,
                                "delta": {"role": "assistant", "content": part},
                                "finish_reason": None,
                            }
                        ],
                    }
                )
                + "\n\n"
            )
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content="".join(events) + "data: [DONE]\n\n",
        )

    async def collect(reply):
        updates.append(reply)

    result = await LangChainCreativeChat(httpx.MockTransport(respond)).converse(
        base_url="https://example.test",
        api_key="test",
        model="deepseek-flash",
        messages=[{"role": "user", "content": "你好"}],
        on_reply=collect,
    )
    assert updates == ["你", "你好"]
    assert result.reply == "你好"
