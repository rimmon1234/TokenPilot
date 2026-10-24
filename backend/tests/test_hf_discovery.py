"""Unit tests for Hugging Face model discovery service."""
import pytest
from unittest.mock import patch, AsyncMock
import httpx
from app.services.hf_discovery import (
    _parse_license,
    _parse_gated,
    _parse_chat_support,
    _extract_parameters_and_context,
    search_hf_models,
)
from app.schemas.models import GatedStatus


def test_license_extraction_from_card_data():
    """Verify license is extracted correctly from cardData."""
    lic, verified = _parse_license(["pytorch", "safetensors"], {"license": "apache-2.0"})
    assert lic == "apache-2.0"
    assert verified is True


def test_license_extraction_from_tags():
    """Verify license tag fallback."""
    lic, verified = _parse_license(["license:mit", "arxiv:1234"], {})
    assert lic == "mit"
    assert verified is True


def test_unknown_license_not_faked():
    """Verify missing or empty license reports unknown."""
    lic, verified = _parse_license(["pytorch"], {})
    assert lic == "unknown"
    assert verified is False


def test_gated_status_parsing():
    """Verify normalization of various gated indicators."""
    assert _parse_gated("auto") == GatedStatus.AUTO
    assert _parse_gated("manual") == GatedStatus.MANUAL
    assert _parse_gated(True) == GatedStatus.MANUAL
    assert _parse_gated(False) == GatedStatus.NONE
    assert _parse_gated(None) == GatedStatus.NONE
    assert _parse_gated("invalid_string") == GatedStatus.UNKNOWN


def test_chat_verification():
    """Verify chat/instruct models are flagged correctly."""
    assert _parse_chat_support("conversational", ["conversational"]) is True
    assert _parse_chat_support("text-generation", ["chat"]) is True
    assert _parse_chat_support("text-generation", ["fill-mask"]) is False


def test_parameter_extraction():
    """Verify parameter count and context window extraction."""
    params, ctx, quant = _extract_parameters_and_context(
        ["7b", "gguf", "llama"],
        {"max_position_embeddings": 32768}
    )
    assert params == "7B"
    assert ctx == 32768
    assert quant == "gguf"


@pytest.mark.asyncio
async def test_search_hf_models_graceful_timeout():
    """Verify that network timeout returns a structured error without crashing."""
    with patch("httpx.AsyncClient.get", side_effect=httpx.TimeoutException("Mocked timeout")):
        result = await search_hf_models(query="deepseek", use_cache=False)
        assert result.total_found == 0
        assert result.error is not None
        assert "timed out" in result.error.lower()


@pytest.mark.asyncio
async def test_search_hf_models_rate_limit_handling():
    """Verify that HTTP 429 returns clean user-friendly rate limit error."""
    mock_response = AsyncMock()
    mock_response.status_code = 429
    mock_response.text = "Rate limit exceeded"

    with patch("httpx.AsyncClient.get", return_value=mock_response):
        result = await search_hf_models(query="llama", use_cache=False)
        assert result.total_found == 0
        assert result.error is not None
        assert "rate limit" in result.error.lower()


@pytest.mark.asyncio
async def test_search_hf_models_ascii_query():
    """Verify standard ASCII query executes and parses valid response."""
    mock_data = [
        {
            "id": "meta-llama/Llama-3.1-8B-Instruct",
            "author": "meta-llama",
            "likes": 5000,
            "downloads": 120000,
            "tags": ["text-generation", "chat", "license:llama3.1", "provider:together"],
            "cardData": {"license": "llama3.1"},
            "inference": "warm",
        }
    ]
    mock_response = AsyncMock()
    mock_response.status_code = 200
    mock_response.json = lambda: mock_data

    with patch("httpx.AsyncClient.get", return_value=mock_response) as mock_get:
        result = await search_hf_models(query="Llama-3.1", use_cache=False)
        assert result.total_found == 1
        assert result.error is None
        assert result.models[0].repo_id == "meta-llama/Llama-3.1-8B-Instruct"
        assert result.models[0].is_chat_verified is True
        # Verify query params were passed
        call_kwargs = mock_get.call_args[1]
        params = call_kwargs["params"]
        assert "search" in params
        assert params["search"] == "Llama-3.1"


@pytest.mark.asyncio
async def test_search_hf_models_non_ascii_query():
    """Verify non-ASCII query handles UTF-8 encoding properly without UnicodeEncodeError."""
    mock_response = AsyncMock()
    mock_response.status_code = 200
    mock_response.json = lambda: []

    with patch("httpx.AsyncClient.get", return_value=mock_response) as mock_get:
        # Non-ASCII query containing CJK, Unicode symbols, and em-dash
        non_ascii_query = "日本語 Qwen 2.5 © DeepSeek—model"
        result = await search_hf_models(query=non_ascii_query, use_cache=False)
        assert result.error is None
        call_kwargs = mock_get.call_args[1]
        params = call_kwargs["params"]
        # Verify params is an httpx.QueryParams instance with valid encoding
        assert isinstance(params, httpx.QueryParams)
        assert "%E6%97%A5%E6%9C%AC%E8%AA%9E" in str(params)


@pytest.mark.asyncio
async def test_search_hf_models_malformed_json_response():
    """Verify that malformed JSON response is handled gracefully without crashing."""
    mock_response = httpx.Response(
        200,
        content=b"invalid-json-{broken",
        request=httpx.Request("GET", "https://huggingface.co/api/models"),
    )

    with patch("httpx.AsyncClient.get", return_value=mock_response):
        result = await search_hf_models(query="corrupted-json-test", use_cache=False)
        assert result.total_found == 0
        assert result.error is not None
        assert "malformed JSON" in result.error


@pytest.mark.asyncio
async def test_search_hf_models_malformed_items():
    """Verify that non-dict or invalid items in the response list do not cause errors."""
    mock_data = [
        "not-a-dict",
        {"id": None},
        {"no_id_field": True},
        {
            "id": "valid/model",
            "tags": "not-a-list",  # malformed tags
            "cardData": "not-a-dict",  # malformed cardData
        },
    ]
    mock_response = AsyncMock()
    mock_response.status_code = 200
    mock_response.json = lambda: mock_data

    with patch("httpx.AsyncClient.get", return_value=mock_response):
        result = await search_hf_models(query="malformed-items-test", use_cache=False)
        assert result.error is None
        assert result.total_found == 1
        assert result.models[0].repo_id == "valid/model"
