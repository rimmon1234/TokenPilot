"""Hugging Face Hub model discovery service."""
import logging
import time
from typing import Dict, List, Optional, Tuple
import httpx

from app.config import settings
from app.schemas.models import (
    HuggingFaceDiscoveredModel,
    HFSearchResponse,
    GatedStatus,
    ExecutionMode,
    ExecutionLocation,
)

logger = logging.getLogger(__name__)

HF_API_BASE_URL = "https://huggingface.co/api/models"

# In-memory search cache: (query, task, limit) -> (timestamp, List[HuggingFaceDiscoveredModel])
_CACHE: Dict[Tuple[str, str, int], Tuple[float, List[HuggingFaceDiscoveredModel]]] = {}
CACHE_TTL_SECONDS = 300.0  # 5 minutes


def _parse_license(tags: List[str], card_data: dict) -> Tuple[str, bool]:
    """Extract and verify license from tags or cardData."""
    # Check cardData first
    if isinstance(card_data, dict):
        raw_lic = card_data.get("license")
        if raw_lic and isinstance(raw_lic, str):
            clean = raw_lic.strip().lower()
            if clean and clean not in ("other", "none", "unknown"):
                return clean, True
            if clean == "other":
                return "custom/other", True

    # Check tags e.g. "license:apache-2.0"
    for tag in tags:
        if isinstance(tag, str) and tag.startswith("license:"):
            lic = tag.split("license:", 1)[1].strip().lower()
            if lic:
                return lic, True

    return "unknown", False


def _parse_gated(raw_gated: any) -> GatedStatus:
    """Normalize Hugging Face gated attribute."""
    if raw_gated is True:
        return GatedStatus.MANUAL
    if isinstance(raw_gated, str):
        val = raw_gated.lower().strip()
        if val in ("auto", "manual"):
            return GatedStatus(val)
        if val == "true":
            return GatedStatus.MANUAL
        if val in ("false", "none", "no"):
            return GatedStatus.NONE
    if raw_gated is False or raw_gated is None:
        return GatedStatus.NONE
    return GatedStatus.UNKNOWN


def _parse_chat_support(pipeline_tag: Optional[str], tags: List[str]) -> bool:
    """Determine whether model is verified for conversational/chat generation."""
    if pipeline_tag in ("conversational", "text-generation"):
        chat_keywords = {"conversational", "chat", "instruct", "assistant", "chatml"}
        tag_set = {t.lower() for t in tags if isinstance(t, str)}
        if any(kw in tag_set for kw in chat_keywords):
            return True
        # Check if instruct is part of repo name
        return False
    return False


def _extract_parameters_and_context(tags: List[str], card_data: dict) -> Tuple[Optional[str], Optional[int], Optional[str]]:
    """Extract parameter count, context window, and quantization if verified."""
    params_str: Optional[str] = None
    context_window: Optional[int] = None
    quantization: Optional[str] = None

    for tag in tags:
        if not isinstance(tag, str):
            continue
        tag_lower = tag.lower()
        # Parameter hints (e.g. 7b, 1.5b, 70b)
        if tag_lower.endswith("b") and tag_lower[:-1].replace(".", "", 1).isdigit():
            params_str = tag_lower.upper()
        # Quantization hints
        if tag_lower in ("gguf", "awq", "gptq", "exl2", "4bit", "8bit", "bnb"):
            quantization = tag_lower

    if isinstance(card_data, dict):
        if "max_position_embeddings" in card_data:
            try:
                context_window = int(card_data["max_position_embeddings"])
            except (ValueError, TypeError):
                pass
        if not params_str and "parameters" in card_data:
            params_str = str(card_data["parameters"])

    return params_str, context_window, quantization


async def search_hf_models(
    query: str = "",
    task: str = "text-generation",
    limit: int = 20,
    use_cache: bool = True,
) -> HFSearchResponse:
    """
    Search Hugging Face Hub for text-generation models with verified metadata.
    Does not require API tokens for public models.
    Fails gracefully on network error or rate-limiting.
    """
    cache_key = (query.strip().lower(), task, limit)
    now = time.time()

    if use_cache and cache_key in _CACHE:
        cached_time, cached_results = _CACHE[cache_key]
        if now - cached_time < CACHE_TTL_SECONDS:
            return HFSearchResponse(
                query=query,
                total_found=len(cached_results),
                models=cached_results,
                cached=True,
                error=None,
            )

    # Prepare HTTP headers
    headers = {"User-Agent": "TokenPilot-Gateway/0.1.0"}
    if settings.hf_token:
        headers["Authorization"] = f"Bearer {settings.hf_token}"

    params = {
        "limit": min(limit, 50),
        "full": "true",
        "config": "true",
    }
    if query.strip():
        params["search"] = query.strip()
    if task:
        params["filter"] = task

    try:
        async with httpx.AsyncClient(timeout=settings.hf_api_timeout_seconds) as client:
            response = await client.get(HF_API_BASE_URL, params=params, headers=headers)

            if response.status_code == 429:
                logger.warning("Hugging Face API rate limit reached.")
                return HFSearchResponse(
                    query=query,
                    total_found=0,
                    models=[],
                    cached=False,
                    error="Hugging Face API rate limit reached. Please retry in a few moments or configure an HF_TOKEN.",
                )

            if response.status_code != 200:
                logger.error(f"Hugging Face API responded with status {response.status_code}: {response.text}")
                return HFSearchResponse(
                    query=query,
                    total_found=0,
                    models=[],
                    cached=False,
                    error=f"Hugging Face API returned error status {response.status_code}. Please retry.",
                )

            data = response.json()
            if not isinstance(data, list):
                return HFSearchResponse(
                    query=query,
                    total_found=0,
                    models=[],
                    cached=False,
                    error="Unexpected response structure received from Hugging Face Hub.",
                )

            discovered_models: List[HuggingFaceDiscoveredModel] = []
            for item in data:
                repo_id = item.get("id") or item.get("modelId")
                if not repo_id:
                    continue

                tags = item.get("tags") or []
                card_data = item.get("cardData") or {}
                license_val, is_lic_verified = _parse_license(tags, card_data)
                gated_val = _parse_gated(item.get("gated"))
                is_chat = _parse_chat_support(item.get("pipeline_tag"), tags)
                
                # Check for instruct in name if not flagged in tags
                if not is_chat and any(term in repo_id.lower() for term in ("instruct", "chat", "it")):
                    is_chat = True

                params_str, ctx_window, quant = _extract_parameters_and_context(tags, card_data)

                # Check inference providers support
                # Models with serverless inference or inference provider widgets
                is_inf = False
                supported_providers = []
                if item.get("inference") in ("warm", "cold", True):
                    is_inf = True
                    supported_providers.append("huggingface_serverless")
                
                # Check if known provider tags are present (e.g. Together, Sambanova, Fal)
                for t in tags:
                    if isinstance(t, str) and t.startswith("provider:"):
                        provider_name = t.split("provider:", 1)[1]
                        supported_providers.append(provider_name)
                        is_inf = True

                discovered_model = HuggingFaceDiscoveredModel(
                    repo_id=repo_id,
                    name=repo_id.split("/")[-1] if "/" in repo_id else repo_id,
                    author=item.get("author") or (repo_id.split("/")[0] if "/" in repo_id else None),
                    likes=item.get("likes") or 0,
                    downloads=item.get("downloads") or 0,
                    license=license_val,
                    is_license_verified=is_lic_verified,
                    gated_status=gated_val,
                    is_chat_verified=is_chat,
                    is_inference_provider_available=is_inf,
                    context_window=ctx_window or (128000 if "128k" in repo_id.lower() else (32768 if "32k" in repo_id.lower() else None)),
                    parameters_raw=params_str,
                    quantization=quant,
                    tags=tags[:15],  # Top tags
                    model_card_url=f"https://huggingface.co/{repo_id}",
                    supported_providers=list(set(supported_providers)),
                    suggested_execution_mode=ExecutionMode.HUGGINGFACE_INFERENCE_PROVIDERS if is_inf else ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
                    suggested_location=ExecutionLocation.REMOTE if is_inf else ExecutionLocation.LOCAL,
                )
                discovered_models.append(discovered_model)

            # Store in cache
            _CACHE[cache_key] = (now, discovered_models)

            return HFSearchResponse(
                query=query,
                total_found=len(discovered_models),
                models=discovered_models,
                cached=False,
                error=None,
            )

    except httpx.TimeoutException:
        logger.warning(f"Timeout querying Hugging Face API for query: {query}")
        return HFSearchResponse(
            query=query,
            total_found=0,
            models=[],
            cached=False,
            error="Connection to Hugging Face Hub timed out. Check internet connection and click retry.",
        )
    except Exception as exc:
        logger.error(f"Error querying Hugging Face API: {exc}", exc_info=True)
        return HFSearchResponse(
            query=query,
            total_found=0,
            models=[],
            cached=False,
            error=f"Unable to reach Hugging Face Hub ({type(exc).__name__}). Please retry.",
        )
