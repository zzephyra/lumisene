import asyncio

from app.infrastructure.ai.adapters.openai_images import OpenAICompatibleImages


def test_qwen_text_uses_native_endpoint_without_reference_urls():
    calls = []

    def post(url, key, payload, timeout):
        calls.append(payload)
        assert (
            url
            == "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
        )
        assert payload["input"]["messages"][0]["content"] == [{"text": "香水海报"}]
        assert payload["parameters"]["size"] == "1024*1536"
        assert payload["parameters"]["n"] == 2
        return 200, {
            "output": {
                "choices": [
                    {
                        "message": {
                            "content": [
                                {"image": "https://example.test/a.png"},
                                {"image": "https://example.test/b.png"},
                            ]
                        }
                    }
                ]
            }
        }

    client = OpenAICompatibleImages(post=post)

    async def download(url):
        return b"test", "image/png"

    client._download = download
    result = asyncio.run(
        client.generate(
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            api_key="test",
            model="qwen-image-2.0",
            prompt="香水海报",
            size="1024x1536",
            count=2,
        )
    )
    assert len(result) == 2
    assert len(calls) == 1
