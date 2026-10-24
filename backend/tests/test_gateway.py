"""Automated tests for the LLM Chat Completion Gateway and Provider Adapters."""
import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
import httpx
from fastapi.testclient import TestClient
from app.main import app
from app.schemas.models import ExecutionMode, ExecutionLocation
from app.schemas.gateway import GatewayChatRequest, ChatMessage, MessageRole

client = TestClient(app)


class MockStreamContext:
    """Mock async context manager returned by httpx.AsyncClient.stream."""
    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        return self.response

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return None


def build_mock_sse_stream(events: list) -> MockStreamContext:
    """Helper to mock an httpx.Response aiter_text stream yielding SSE lines."""
    async def aiter_text_gen():
        for ev in events:
            if isinstance(ev, dict):
                yield f"data: {json.dumps(ev)}\n\n"
            elif ev == "[DONE]":
                yield "data: [DONE]\n\n"
            else:
                yield str(ev)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.aiter_text = aiter_text_gen
    return MockStreamContext(mock_resp)


def parse_sse_response_body(body_text: str) -> list:
    """Parse SSE event data blocks from a streaming HTTP response body."""
    events = []
    blocks = body_text.strip().split("\n\n")
    for block in blocks:
        for line in block.split("\n"):
            line = line.strip()
            if line.startswith("data:"):
                data_json = line[5:].strip()
                try:
                    events.append(json.loads(data_json))
                except json.JSONDecodeError:
                    events.append({"raw": data_json})
    return events


# 1. Direct local transformers rejection
def test_local_transformers_unsupported():
    payload = {
        "provider_type": "huggingface",
        "execution_mode": "huggingface_local_transformers",
        "provider_model_id": "meta-llama/Llama-3.2-3B",
        "messages": [{"role": "user", "content": "Hello"}],
    }
    resp = client.post("/api/gateway/chat/completions", json=payload)
    assert resp.status_code == 422
    assert "not supported for in-process inference" in resp.json()["detail"]


# 2. SSRF protection on base_url
def test_ssrf_cloud_metadata_blocked():
    payload = {
        "provider_type": "custom",
        "execution_mode": "remote_openai_compatible",
        "provider_model_id": "evil-model",
        "base_url": "http://169.254.169.254/v1",
        "messages": [{"role": "user", "content": "Hello"}],
    }
    resp = client.post("/api/gateway/chat/completions", json=payload)
    assert resp.status_code == 422
    assert "Disallowed destination" in resp.json()["detail"] or "cloud metadata" in resp.json()["detail"]


# 3. Missing HF token validation
def test_hf_provider_missing_token_rejected():
    payload = {
        "provider_type": "huggingface",
        "execution_mode": "huggingface_inference_providers",
        "provider_model_id": "Qwen/Qwen2.5-Coder-7B-Instruct",
        "messages": [{"role": "user", "content": "Hello"}],
    }
    resp = client.post("/api/gateway/chat/completions", json=payload)
    assert resp.status_code == 422
    assert "Hugging Face User Access Token" in resp.json()["detail"]


# 4. Successful OpenAI-compatible streaming flow
@pytest.mark.asyncio
async def test_openai_compatible_successful_stream():
    sample_events = [
        {"id": "1", "choices": [{"delta": {"content": "Hello"}, "finish_reason": None}]},
        {"id": "2", "choices": [{"delta": {"content": " world!"}, "finish_reason": None}]},
        {
            "id": "3",
            "choices": [{"delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
        },
        "[DONE]",
    ]
    mock_cm = build_mock_sse_stream(sample_events)

    with patch("httpx.AsyncClient.stream", return_value=mock_cm):
        payload = {
            "provider_type": "ollama",
            "execution_mode": "local_openai_compatible",
            "provider_model_id": "llama3.2:3b",
            "base_url": "http://localhost:11434/v1",
            "messages": [{"role": "user", "content": "Hi"}],
            "input_price_per_million": 0.20,
            "output_price_per_million": 0.40,
        }
        resp = client.post("/api/gateway/chat/completions", json=payload)
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]

        events = parse_sse_response_body(resp.text)
        assert len(events) >= 4

        # Meta event
        meta = events[0]
        assert meta["type"] == "meta"
        assert meta["provider_model_id"] == "llama3.2:3b"

        # Token events
        tokens = [e["text"] for e in events if e.get("type") == "token"]
        assert "".join(tokens) == "Hello world!"

        # Usage event with cost calculation
        usage = next(e for e in events if e.get("type") == "usage")
        assert usage["prompt_tokens"] == 10
        assert usage["completion_tokens"] == 2
        assert usage["total_tokens"] == 12
        assert usage["provenance"] == "provider_reported"
        assert usage["estimated_cost_usd"] == 0.0000028

        # Done event
        done = next(e for e in events if e.get("type") == "done")
        assert done["finish_reason"] == "stop"
        assert "latency_ms" in done


# 5. Upstream 401 authentication failure returns sanitized error event
@pytest.mark.asyncio
async def test_openai_compatible_auth_failure_stream():
    mock_resp = MagicMock()
    mock_resp.status_code = 401
    mock_resp.aread = AsyncMock(return_value=b'{"error": "Unauthorized"}')
    mock_cm = MockStreamContext(mock_resp)

    with patch("httpx.AsyncClient.stream", return_value=mock_cm):
        payload = {
            "provider_type": "openai",
            "execution_mode": "remote_openai_compatible",
            "provider_model_id": "gpt-4o",
            "base_url": "https://api.openai.com/v1",
            "transient_credential": "sk-secret-bad-key",
            "messages": [{"role": "user", "content": "Hi"}],
        }
        resp = client.post("/api/gateway/chat/completions", json=payload)
        assert resp.status_code == 200
        events = parse_sse_response_body(resp.text)

        error_ev = next(e for e in events if e.get("type") == "error")
        assert "authentication failed" in error_ev["error"].lower()
        # Ensure secret is not in output!
        assert "sk-secret-bad-key" not in resp.text


# 6. Hugging Face Inference Providers stream
@pytest.mark.asyncio
async def test_hf_provider_successful_stream():
    sample_events = [
        {"id": "1", "choices": [{"delta": {"content": "HF response"}, "finish_reason": "stop"}]},
        "[DONE]",
    ]
    mock_cm = build_mock_sse_stream(sample_events)

    with patch("httpx.AsyncClient.stream", return_value=mock_cm):
        payload = {
            "provider_type": "huggingface",
            "execution_mode": "huggingface_inference_providers",
            "provider_model_id": "Qwen/Qwen2.5-Coder-7B-Instruct",
            "transient_credential": "hf_valid_token_123",
            "provider_selection": "together",
            "messages": [{"role": "user", "content": "Write code"}],
        }
        resp = client.post("/api/gateway/chat/completions", json=payload)
        assert resp.status_code == 200

        events = parse_sse_response_body(resp.text)
        token_texts = [e["text"] for e in events if e.get("type") == "token"]
        assert "".join(token_texts) == "HF response"
        # Secret must never be in serialized stream
        assert "hf_valid_token_123" not in resp.text


# 6b. Hugging Face Inference Providers HTTP 402 Payment Required
@pytest.mark.asyncio
async def test_hf_provider_402_payment_required_error():
    mock_resp = MagicMock()
    mock_resp.status_code = 402
    mock_resp.aread = AsyncMock(
        return_value=b'{"error": "You have exceeded your monthly included credits for Inference Providers. Subscribe to PRO to get 20x more monthly included credits."}'
    )
    mock_cm = MockStreamContext(mock_resp)

    with patch("httpx.AsyncClient.stream", return_value=mock_cm):
        payload = {
            "provider_type": "huggingface",
            "execution_mode": "huggingface_inference_providers",
            "provider_model_id": "meta-llama/Llama-3.1-8B-Instruct",
            "transient_credential": "hf_valid_token_123",
            "messages": [{"role": "user", "content": "Hi"}],
        }
        resp = client.post("/api/gateway/chat/completions", json=payload)
        assert resp.status_code == 200
        events = parse_sse_response_body(resp.text)
        error_ev = next(e for e in events if e.get("type") == "error")
        assert "Payment Required" in error_ev["error"]
        assert "exceeded your monthly included credits" in error_ev["error"]
        assert error_ev["code"] == "hf_http_402"


# 7. Hugging Face Dedicated Endpoints URL confusion
def test_hf_endpoints_hub_url_rejected():
    payload = {
        "provider_type": "huggingface",
        "execution_mode": "huggingface_inference_endpoint",
        "provider_model_id": "custom",
        "base_url": "https://huggingface.co/meta-llama/Llama-3.2-3B",
        "transient_credential": "hf_tok_123",
        "messages": [{"role": "user", "content": "Hi"}],
    }
    resp = client.post("/api/gateway/chat/completions", json=payload)
    assert resp.status_code == 422
    assert "Hub model page" in resp.json()["detail"]


# 8. Timeout error handling
@pytest.mark.asyncio
async def test_upstream_timeout_handling():
    with patch("httpx.AsyncClient.stream", side_effect=httpx.ConnectTimeout("Connect timeout")):
        payload = {
            "provider_type": "ollama",
            "execution_mode": "local_openai_compatible",
            "provider_model_id": "llama3.2:3b",
            "base_url": "http://localhost:11434/v1",
            "messages": [{"role": "user", "content": "Hi"}],
        }
        resp = client.post("/api/gateway/chat/completions", json=payload)
        assert resp.status_code == 200
        events = parse_sse_response_body(resp.text)
        error_ev = next(e for e in events if e.get("type") == "error")
        assert "timed out" in error_ev["error"].lower()
        assert error_ev["code"] == "connect_timeout"


# --- Regression Tests for Contract Validation ---

# 9. Valid Hugging Face Inference Providers request (without custom base_url)
@pytest.mark.asyncio
async def test_valid_hf_inference_providers_request():
    mock_events = [
        {"id": "1", "choices": [{"delta": {"content": "Hello HF"}, "finish_reason": "stop"}]},
        "[DONE]",
    ]
    mock_cm = build_mock_sse_stream(mock_events)

    with patch("httpx.AsyncClient.stream", return_value=mock_cm):
        payload = {
            "model_id": "model-hf-1",
            "model_display_name": "Qwen 2.5 Coder",
            "provider_type": "huggingface",
            "execution_mode": "huggingface_inference_providers",
            "provider_model_id": "Qwen/Qwen2.5-Coder-7B-Instruct",
            "huggingface_repo_id": "Qwen/Qwen2.5-Coder-7B-Instruct",
            "transient_credential": "hf_test_credential_123",
            "messages": [{"role": "user", "content": "Test prompt"}],
        }
        resp = client.post("/api/gateway/chat/completions", json=payload)
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]
        events = parse_sse_response_body(resp.text)
        meta = next(e for e in events if e.get("type") == "meta")
        assert meta["provider_model_id"] == "Qwen/Qwen2.5-Coder-7B-Instruct"


# 10. Valid local OpenAI-compatible request (with base_url)
@pytest.mark.asyncio
async def test_valid_local_openai_compatible_request():
    mock_events = [
        {"id": "1", "choices": [{"delta": {"content": "Hello Local"}, "finish_reason": "stop"}]},
        "[DONE]",
    ]
    mock_cm = build_mock_sse_stream(mock_events)

    with patch("httpx.AsyncClient.stream", return_value=mock_cm):
        payload = {
            "model_id": "model-local-1",
            "provider_type": "ollama",
            "execution_mode": "local_openai_compatible",
            "provider_model_id": "llama3.2:3b",
            "base_url": "http://localhost:11434/v1",
            "messages": [{"role": "user", "content": "Hello local model"}],
        }
        resp = client.post("/api/gateway/chat/completions", json=payload)
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]


# 11. Valid dedicated Hugging Face endpoint request
@pytest.mark.asyncio
async def test_valid_dedicated_endpoint_request():
    mock_events = [
        {"id": "1", "choices": [{"delta": {"content": "Dedicated endpoint output"}, "finish_reason": "stop"}]},
        "[DONE]",
    ]
    mock_cm = build_mock_sse_stream(mock_events)

    with patch("httpx.AsyncClient.stream", return_value=mock_cm):
        with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("54.210.1.1", 443))]):
            payload = {
                "model_id": "model-ded-1",
                "provider_type": "huggingface",
                "execution_mode": "huggingface_inference_endpoint",
                "provider_model_id": "custom-endpoint",
                "base_url": "https://xyz.endpoints.huggingface.cloud",
                "transient_credential": "hf_secret_token",
                "messages": [{"role": "user", "content": "Hello endpoint"}],
            }
            resp = client.post("/api/gateway/chat/completions", json=payload)
            assert resp.status_code == 200
            assert "text/event-stream" in resp.headers["content-type"]


# 12. Missing provider model ID returns clear configuration error
def test_missing_provider_model_id_error():
    payload = {
        "provider_type": "ollama",
        "execution_mode": "local_openai_compatible",
        "provider_model_id": "",
        "base_url": "http://localhost:11434/v1",
        "messages": [{"role": "user", "content": "Hello"}],
    }
    resp = client.post("/api/gateway/chat/completions", json=payload)
    assert resp.status_code == 422
    assert "Configuration error: provider_model_id is missing. Open Model Studio and configure the selected model." in resp.json()["detail"]


# 13. Missing required endpoint URL returns clear configuration error
def test_missing_required_endpoint_url_error():
    payload = {
        "provider_type": "ollama",
        "execution_mode": "local_openai_compatible",
        "provider_model_id": "llama3.2:3b",
        "base_url": "",
        "messages": [{"role": "user", "content": "Hello"}],
    }
    resp = client.post("/api/gateway/chat/completions", json=payload)
    assert resp.status_code == 422
    assert "base_url is required" in resp.json()["detail"]


# 14. Missing or empty message returns clear validation error
def test_empty_message_content_error():
    payload = {
        "provider_type": "ollama",
        "execution_mode": "local_openai_compatible",
        "provider_model_id": "llama3.2:3b",
        "base_url": "http://localhost:11434/v1",
        "messages": [{"role": "user", "content": "   "}],
    }
    resp = client.post("/api/gateway/chat/completions", json=payload)
    assert resp.status_code == 422
    assert "message content cannot be empty" in resp.json()["detail"].lower()


def test_empty_messages_list_error():
    payload = {
        "provider_type": "ollama",
        "execution_mode": "local_openai_compatible",
        "provider_model_id": "llama3.2:3b",
        "base_url": "http://localhost:11434/v1",
        "messages": [],
    }
    resp = client.post("/api/gateway/chat/completions", json=payload)
    assert resp.status_code == 422
    assert "at least one message is required" in resp.json()["detail"].lower()


# 15. Malformed workspace model configuration
def test_malformed_workspace_model_configuration():
    payload = {
        "provider_type": "ollama",
        "execution_mode": "local_openai_compatible",
        "provider_model_id": "llama3.2:3b",
        "base_url": "http://localhost:11434/v1",
        "messages": [{"role": "invalid_role", "content": "Hi"}],
        "temperature": 5.0,  # exceeds max 2.0
    }
    resp = client.post("/api/gateway/chat/completions", json=payload)
    assert resp.status_code == 422
    assert "Configuration error" in resp.json()["detail"]
