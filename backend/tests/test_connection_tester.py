"""Automated tests for model connection testing, diagnostics, and SSRF protection."""
import pytest
from unittest.mock import patch
from pydantic import SecretStr
import httpx

from app.schemas.models import (
    ConnectionTestRequest,
    ConnectionTestStatus,
    ExecutionMode,
)
from app.services.connection_tester import test_model_connection as run_connection_test
from app.core.network_validator import validate_outbound_url, sanitize_url_for_display


# --- SSRF & Network Security Tests ---

def test_url_sanitization():
    """Verify that credentials and query parameters in URLs are cleanly sanitized."""
    assert sanitize_url_for_display("https://user:secret123@api.groq.com/v1/chat") == "https://api.groq.com"
    assert sanitize_url_for_display("http://localhost:11434/v1") == "http://localhost:11434"


def test_ssrf_blocks_cloud_metadata():
    """Verify that cloud metadata IPs (169.254.169.254) are rejected even in development mode."""
    with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("169.254.169.254", 80))]):
        is_valid, _, err = validate_outbound_url("http://169.254.169.254/latest/meta-data/", allow_local_network=True)
        assert is_valid is False
        assert "cloud metadata" in err.lower()


def test_ssrf_blocks_metadata_hostnames():
    """Verify that cloud metadata hostnames are blocked immediately."""
    is_valid, _, err = validate_outbound_url("http://metadata.google.internal/computeMetadata/v1/")
    assert is_valid is False
    assert "metadata" in err.lower()


def test_ssrf_blocks_private_ip_in_production():
    """Verify private/loopback network targets are blocked when allow_local_network=False."""
    with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("127.0.0.1", 11434))]):
        is_valid, _, err = validate_outbound_url("http://localhost:11434/v1", allow_local_network=False)
        assert is_valid is False
        assert "private/loopback" in err.lower()

    with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("192.168.1.50", 8000))]):
        is_valid, _, err = validate_outbound_url("http://192.168.1.50:8000/v1", allow_local_network=False)
        assert is_valid is False
        assert "private/loopback" in err.lower()


def test_invalid_url_schemes_rejected():
    """Verify non-HTTP schemes (file://, ftp://, gopher://) are rejected."""
    is_valid, _, err = validate_outbound_url("file:///etc/passwd")
    assert is_valid is False
    assert "scheme" in err.lower()


# --- Local & Remote OpenAI-Compatible Endpoint Tests ---

@pytest.mark.asyncio
async def test_openai_compatible_local_success():
    """Verify successful local endpoint connection with model catalog confirmation."""
    mock_resp = httpx.Response(
        200,
        json={"data": [{"id": "llama3.2:3b"}, {"id": "mistral:7b"}]},
        request=httpx.Request("GET", "http://localhost:11434/v1/models"),
    )

    req = ConnectionTestRequest(
        provider_type="ollama",
        execution_mode=ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
        provider_model_id="llama3.2:3b",
        base_url="http://localhost:11434/v1",
    )

    with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("127.0.0.1", 11434))]):
        with patch("httpx.AsyncClient.get", return_value=mock_resp):
            res = await run_connection_test(req)
            assert res.status == ConnectionTestStatus.CONNECTED
            assert res.endpoint_reachable is True
            assert res.auth_status == "not_required"
            assert res.inference_verified is False
            assert "Confirmed model 'llama3.2:3b'" in res.diagnostic_message
            assert res.safe_details["model_matched"] is True


@pytest.mark.asyncio
async def test_openai_compatible_remote_with_token_success():
    """Verify remote endpoint with bearer token and latency measurement."""
    mock_resp = httpx.Response(
        200,
        json={"data": [{"id": "deepseek-chat"}]},
        request=httpx.Request("GET", "https://api.deepseek.com/v1/models"),
    )

    req = ConnectionTestRequest(
        provider_type="deepseek",
        execution_mode=ExecutionMode.REMOTE_OPENAI_COMPATIBLE,
        provider_model_id="deepseek-chat",
        base_url="https://api.deepseek.com/v1",
        transient_credential=SecretStr("sk-test-secret-12345"),
    )

    with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("104.18.2.1", 443))]):
        with patch("httpx.AsyncClient.get", return_value=mock_resp) as mock_get:
            res = await run_connection_test(req)
            assert res.status == ConnectionTestStatus.CONNECTED
            assert res.auth_status == "valid"
            assert res.latency_ms is not None
            assert "sk-test-secret-12345" not in res.diagnostic_message
            sent_headers = mock_get.call_args[1]["headers"]
            assert sent_headers["Authorization"] == "Bearer sk-test-secret-12345"


@pytest.mark.asyncio
async def test_openai_compatible_auth_failure_401():
    """Verify HTTP 401 returns authentication_failed with retryable flag."""
    mock_resp = httpx.Response(
        401,
        request=httpx.Request("GET", "https://api.openai.com/v1/models"),
    )

    req = ConnectionTestRequest(
        provider_type="openai",
        execution_mode=ExecutionMode.REMOTE_OPENAI_COMPATIBLE,
        provider_model_id="gpt-4o",
        base_url="https://api.openai.com/v1",
        transient_credential=SecretStr("sk-bad-key"),
    )

    with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("104.18.2.1", 443))]):
        with patch("httpx.AsyncClient.get", return_value=mock_resp):
            res = await run_connection_test(req)
            assert res.status == ConnectionTestStatus.AUTHENTICATION_FAILED
            assert res.auth_status == "invalid"
            assert res.endpoint_reachable is True
            assert res.retryable is True
            assert "sk-bad-key" not in res.diagnostic_message


@pytest.mark.asyncio
async def test_openai_compatible_404_inconclusive():
    """Verify HTTP 404 for health/models route reports inconclusive rather than crashing."""
    mock_resp = httpx.Response(
        404,
        request=httpx.Request("GET", "http://localhost:5000/v1/models"),
    )

    req = ConnectionTestRequest(
        provider_type="custom",
        execution_mode=ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
        provider_model_id="custom-model",
        base_url="http://localhost:5000",
    )

    with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("127.0.0.1", 5000))]):
        with patch("httpx.AsyncClient.get", return_value=mock_resp):
            res = await run_connection_test(req)
            assert res.status == ConnectionTestStatus.INCONCLUSIVE
            assert res.endpoint_reachable is True
            assert "404" in res.diagnostic_message


@pytest.mark.asyncio
async def test_openai_compatible_timeout():
    """Verify connection timeout returns unreachable."""
    req = ConnectionTestRequest(
        provider_type="ollama",
        execution_mode=ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
        provider_model_id="llama3.2:3b",
        base_url="http://localhost:11434/v1",
    )

    with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("127.0.0.1", 11434))]):
        with patch("httpx.AsyncClient.get", side_effect=httpx.TimeoutException("mocked timeout")):
            res = await run_connection_test(req)
            assert res.status == ConnectionTestStatus.UNREACHABLE
            assert res.endpoint_reachable is False
            assert res.retryable is True
            assert "timed out" in res.diagnostic_message.lower()


@pytest.mark.asyncio
async def test_openai_compatible_rate_limit_429():
    """Verify HTTP 429 returns rate limit diagnostic."""
    mock_resp = httpx.Response(
        429,
        request=httpx.Request("GET", "https://api.groq.com/openai/v1/models"),
    )

    req = ConnectionTestRequest(
        provider_type="groq",
        execution_mode=ExecutionMode.REMOTE_OPENAI_COMPATIBLE,
        provider_model_id="llama-3.1-8b-instant",
        base_url="https://api.groq.com/openai/v1",
    )

    with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("104.18.2.1", 443))]):
        with patch("httpx.AsyncClient.get", return_value=mock_resp):
            res = await run_connection_test(req)
            assert res.status == ConnectionTestStatus.UNREACHABLE
            assert res.retryable is True
            assert "429" in res.diagnostic_message


# --- Hugging Face Inference Providers Tests ---

@pytest.mark.asyncio
async def test_hf_provider_missing_token_inconclusive():
    """Verify that querying without token reports model existence but missing auth token."""
    mock_model_resp = httpx.Response(
        200,
        json={
            "id": "meta-llama/Llama-3.1-8B-Instruct",
            "gated": "manual",
            "inference": "warm",
        },
        request=httpx.Request("GET", "https://huggingface.co/api/models/meta-llama/Llama-3.1-8B-Instruct"),
    )

    req = ConnectionTestRequest(
        provider_type="huggingface",
        execution_mode=ExecutionMode.HUGGINGFACE_INFERENCE_PROVIDERS,
        provider_model_id="meta-llama/Llama-3.1-8B-Instruct",
    )

    with patch("httpx.AsyncClient.get", return_value=mock_model_resp):
        res = await run_connection_test(req)
        assert res.status == ConnectionTestStatus.INCONCLUSIVE
        assert res.auth_status == "untested"
        assert res.endpoint_reachable is True
        assert res.inference_verified is False
        assert "no user token was provided" in res.diagnostic_message


@pytest.mark.asyncio
async def test_hf_provider_invalid_token():
    """Verify that invalid Hugging Face token returns authentication_failed."""
    mock_whoami = httpx.Response(
        401,
        request=httpx.Request("GET", "https://huggingface.co/api/whoami-v2"),
    )

    req = ConnectionTestRequest(
        provider_type="huggingface",
        execution_mode=ExecutionMode.HUGGINGFACE_INFERENCE_PROVIDERS,
        provider_model_id="Qwen/Qwen2.5-Coder-7B-Instruct",
        transient_credential=SecretStr("hf_invalid_token"),
    )

    with patch("httpx.AsyncClient.get", return_value=mock_whoami):
        res = await run_connection_test(req)
        assert res.status == ConnectionTestStatus.AUTHENTICATION_FAILED
        assert res.auth_status == "invalid"
        assert "hf_invalid_token" not in res.diagnostic_message


@pytest.mark.asyncio
async def test_hf_provider_original_unicode_failure_scenario():
    """
    Original failure scenario: transient credential containing non-ASCII character (em-dash \u2014).
    Verify that it no longer throws UnicodeEncodeError, reaches endpoint, and returns AUTHENTICATION_FAILED.
    """
    mock_whoami = httpx.Response(
        401,
        request=httpx.Request("GET", "https://huggingface.co/api/whoami-v2"),
    )

    req = ConnectionTestRequest(
        provider_type="huggingface",
        execution_mode=ExecutionMode.HUGGINGFACE_INFERENCE_PROVIDERS,
        provider_model_id="meta-llama/Llama-3.1-8B-Instruct",
        huggingface_repo_id="meta-llama/Llama-3.1-8B-Instruct",
        transient_credential=SecretStr("hf_\u2014bad_token"),
    )

    with patch("httpx.AsyncClient.get", return_value=mock_whoami) as mock_get:
        res = await run_connection_test(req)
        # Must NOT fail with UnicodeEncodeError or mark endpoint unreachable
        assert res.status == ConnectionTestStatus.AUTHENTICATION_FAILED
        assert res.endpoint_reachable is True
        assert res.auth_status == "invalid"
        assert "UnicodeEncodeError" not in res.diagnostic_message
        assert "token validation failed" in res.diagnostic_message.lower()
        # Verify that Authorization header was encoded without exception
        headers = mock_get.call_args[1]["headers"]
        assert isinstance(headers, httpx.Headers)


@pytest.mark.asyncio
async def test_hf_provider_hub_search_failure_preserves_endpoint_reachability():
    """
    Verify that Hugging Face Hub search / metadata query failures do not incorrectly
    imply that the inference endpoint is unreachable when auth succeeded.
    """
    mock_whoami = httpx.Response(
        200,
        json={"name": "testuser"},
        request=httpx.Request("GET", "https://huggingface.co/api/whoami-v2"),
    )

    async def route_mock(url, **kwargs):
        if "whoami" in url:
            return mock_whoami
        # Model metadata lookup on Hub times out
        raise httpx.TimeoutException("Hub metadata timeout")

    req = ConnectionTestRequest(
        provider_type="huggingface",
        execution_mode=ExecutionMode.HUGGINGFACE_INFERENCE_PROVIDERS,
        provider_model_id="meta-llama/Llama-3.1-8B-Instruct",
        transient_credential=SecretStr("hf_valid_token"),
    )

    with patch("httpx.AsyncClient.get", side_effect=route_mock):
        res = await run_connection_test(req)
        # Hub search timeout must NOT mark the endpoint unreachable
        assert res.status == ConnectionTestStatus.INCONCLUSIVE
        assert res.endpoint_reachable is True
        assert res.auth_status == "valid"
        assert "timed out" in res.diagnostic_message.lower()


@pytest.mark.asyncio
async def test_hf_provider_hub_unexpected_status_preserves_endpoint_reachability():
    """Verify that HTTP 500 from Hugging Face Hub metadata API reports inconclusive, not unreachable."""
    mock_whoami = httpx.Response(
        200,
        json={"name": "testuser"},
        request=httpx.Request("GET", "https://huggingface.co/api/whoami-v2"),
    )
    mock_hub_error = httpx.Response(
        500,
        request=httpx.Request("GET", "https://huggingface.co/api/models/test-model"),
    )

    async def route_mock(url, **kwargs):
        if "whoami" in url:
            return mock_whoami
        return mock_hub_error

    req = ConnectionTestRequest(
        provider_type="huggingface",
        execution_mode=ExecutionMode.HUGGINGFACE_INFERENCE_PROVIDERS,
        provider_model_id="test-model",
        transient_credential=SecretStr("hf_valid_token"),
    )

    with patch("httpx.AsyncClient.get", side_effect=route_mock):
        res = await run_connection_test(req)
        assert res.status == ConnectionTestStatus.INCONCLUSIVE
        assert res.endpoint_reachable is True
        assert res.auth_status == "valid"
        assert "unexpected status 500" in res.diagnostic_message


@pytest.mark.asyncio
async def test_hf_provider_non_ascii_repo_id_url_quoting():
    """Verify model repo ID with unicode characters is URL percent-quoted safely."""
    mock_whoami = httpx.Response(
        200,
        json={"name": "testuser"},
        request=httpx.Request("GET", "https://huggingface.co/api/whoami-v2"),
    )
    mock_model = httpx.Response(
        200,
        json={"id": "author/モデル—7b", "inference": "warm"},
        request=httpx.Request("GET", "https://huggingface.co/api/models/author/%E3%83%A2%E3%83%87%E3%83%AB%E2%80%947b"),
    )

    async def route_mock(url, **kwargs):
        if "whoami" in url:
            return mock_whoami
        assert "%E3%83%A2%E3%83%87%E3%83%AB%E2%80%947b" in url
        return mock_model

    req = ConnectionTestRequest(
        provider_type="huggingface",
        execution_mode=ExecutionMode.HUGGINGFACE_INFERENCE_PROVIDERS,
        provider_model_id="author/モデル—7b",
        transient_credential=SecretStr("hf_valid_token"),
    )

    with patch("httpx.AsyncClient.get", side_effect=route_mock):
        res = await run_connection_test(req)
        assert res.status == ConnectionTestStatus.CONNECTED
        assert res.endpoint_reachable is True
        assert res.auth_status == "valid"


@pytest.mark.asyncio
async def test_hf_provider_successful_token_and_model():
    """Verify that valid token and existing model returns connected status."""
    mock_whoami = httpx.Response(
        200,
        json={"name": "testuser"},
        request=httpx.Request("GET", "https://huggingface.co/api/whoami-v2"),
    )

    mock_model = httpx.Response(
        200,
        json={
            "id": "Qwen/Qwen2.5-Coder-7B-Instruct",
            "gated": False,
            "inference": "warm",
            "tags": ["provider:together", "provider:sambanova"],
        },
        request=httpx.Request("GET", "https://huggingface.co/api/models/Qwen/Qwen2.5-Coder-7B-Instruct"),
    )

    req = ConnectionTestRequest(
        provider_type="huggingface",
        execution_mode=ExecutionMode.HUGGINGFACE_INFERENCE_PROVIDERS,
        provider_model_id="Qwen/Qwen2.5-Coder-7B-Instruct",
        transient_credential=SecretStr("hf_valid_token_abc"),
    )

    async def route_mock(url, **kwargs):
        if "whoami" in url:
            return mock_whoami
        return mock_model

    with patch("httpx.AsyncClient.get", side_effect=route_mock):
        res = await run_connection_test(req)
        assert res.status == ConnectionTestStatus.CONNECTED
        assert res.auth_status == "valid"
        assert res.inference_verified is False
        assert "testuser" in res.diagnostic_message
        assert res.safe_details["inference_provider_ready"] is True


# --- Hugging Face Inference Endpoint Tests ---

@pytest.mark.asyncio
async def test_hf_endpoint_confused_with_hub_url():
    """Verify error when user mistakenly enters huggingface.co Hub URL as endpoint."""
    req = ConnectionTestRequest(
        provider_type="huggingface",
        execution_mode=ExecutionMode.HUGGINGFACE_INFERENCE_ENDPOINT,
        provider_model_id="my-endpoint-model",
        base_url="https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct",
    )
    res = await run_connection_test(req)
    assert res.status == ConnectionTestStatus.CONFIGURATION_ERROR
    assert "Hub repository URL" in res.diagnostic_message


@pytest.mark.asyncio
async def test_hf_endpoint_healthy_active():
    """Verify successful dedicated endpoint connection."""
    mock_resp = httpx.Response(
        200,
        request=httpx.Request("GET", "https://xyz.endpoints.huggingface.cloud/health"),
    )

    req = ConnectionTestRequest(
        provider_type="huggingface",
        execution_mode=ExecutionMode.HUGGINGFACE_INFERENCE_ENDPOINT,
        provider_model_id="custom-endpoint-model",
        base_url="https://xyz.endpoints.huggingface.cloud",
        transient_credential=SecretStr("hf_my_secret_token"),
    )

    with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("54.210.1.1", 443))]):
        with patch("httpx.AsyncClient.get", return_value=mock_resp):
            res = await run_connection_test(req)
            assert res.status == ConnectionTestStatus.CONNECTED
            assert res.auth_status == "valid"
            assert res.endpoint_reachable is True
            assert "Dedicated Endpoint is reachable" in res.diagnostic_message
