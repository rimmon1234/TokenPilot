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
