"""Metadata and truthful cost resolution for benchmark models and results."""
from typing import Optional, Dict, Any
from app.schemas.models import ExecutionMode, ExecutionLocation, SourceType


def resolve_model_metadata(model_obj_or_dict: Any) -> Dict[str, Any]:
    """
    Disambiguate model source, execution runtime, locality, and runtime model ID.
    Supports WorkspaceModel, BenchmarkModelConfig, ModelTemplate, and raw dict representations.
    Conservative: Never guesses execution provider from display name alone.
    """
    def _get(key: str, default: Any = None) -> Any:
        if isinstance(model_obj_or_dict, dict):
            return model_obj_or_dict.get(key, default)
        return getattr(model_obj_or_dict, key, default)

    display_name = _get("display_name") or ""
    raw_provider_type = _get("provider_type") or ""
    raw_exec_mode = _get("execution_mode")
    raw_exec_loc = _get("execution_location")
    raw_source_type = _get("source_type")
    raw_hf_repo = _get("huggingface_repo_id")
    raw_source_repo = _get("source_repo_id")
    raw_model_source = _get("model_source")
    raw_exec_provider = _get("execution_provider")
    raw_base_url = (_get("base_url") or "").lower()
    raw_provider_model_id = _get("provider_model_id") or ""
    raw_model_id = _get("model_id") or ""

    # 1. Runtime Model ID
    runtime_model_id = raw_provider_model_id if raw_provider_model_id.strip() else raw_model_id

    # 2. Source Repository ID
    source_repo_id = raw_source_repo or raw_hf_repo or None

    # 3. Execution Provider / Runtime
    execution_provider = None
    if raw_exec_provider and raw_exec_provider.strip():
        execution_provider = raw_exec_provider.strip()
    else:
        # Resolve from runtime endpoints and modes
        if "11434" in raw_base_url or raw_provider_type.lower() == "ollama":
            execution_provider = "ollama"
        elif raw_exec_mode in (
            ExecutionMode.HUGGINGFACE_INFERENCE_PROVIDERS,
            "huggingface_inference_providers",
        ):
            execution_provider = "huggingface_inference_providers"
        elif raw_exec_mode in (
            ExecutionMode.HUGGINGFACE_INFERENCE_ENDPOINT,
            "huggingface_inference_endpoint",
        ):
            execution_provider = "huggingface_inference_endpoint"
        elif raw_exec_mode in (
            ExecutionMode.HUGGINGFACE_LOCAL_TRANSFORMERS,
            "huggingface_local_transformers",
        ):
            execution_provider = "huggingface_local_transformers"
        elif raw_exec_mode in (
            ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
            "local_openai_compatible",
        ):
            if "8000" in raw_base_url and "vllm" in raw_provider_type.lower():
                execution_provider = "vllm"
            elif raw_provider_type.lower() == "ollama":
                execution_provider = "ollama"
            elif "localhost" in raw_base_url or "127.0.0.1" in raw_base_url:
                # Default local OpenAI server in TokenPilot is Ollama unless specified
                execution_provider = "ollama" if ("11434" in raw_base_url or not raw_provider_type) else raw_provider_type.lower()
            else:
                execution_provider = raw_provider_type.lower() if raw_provider_type else "local_openai_compatible"
        elif raw_exec_mode in (
            ExecutionMode.REMOTE_OPENAI_COMPATIBLE,
            "remote_openai_compatible",
        ):
            execution_provider = raw_provider_type.lower() if raw_provider_type else "remote_openai_compatible"
        elif raw_provider_type:
            execution_provider = raw_provider_type.lower()
        else:
            execution_provider = "unknown"

    # Normalize execution_provider
    if execution_provider == "huggingface":
        # Disambiguate: was it marked huggingface due to repo origin while running locally?
        if raw_exec_mode in (ExecutionMode.LOCAL_OPENAI_COMPATIBLE, "local_openai_compatible") or "11434" in raw_base_url:
            execution_provider = "ollama"

    # 4. Execution Location
    execution_location = None
    if raw_exec_loc in ("local", ExecutionLocation.LOCAL):
        execution_location = "local"
    elif raw_exec_loc in ("remote", ExecutionLocation.REMOTE):
        execution_location = "remote"
    else:
        # Infer locality from execution_mode and base_url
        if raw_exec_mode in (
            ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
            "local_openai_compatible",
            ExecutionMode.HUGGINGFACE_LOCAL_TRANSFORMERS,
            "huggingface_local_transformers",
        ) or "11434" in raw_base_url or "localhost" in raw_base_url or "127.0.0.1" in raw_base_url:
            execution_location = "local"
        elif raw_exec_mode in (
            ExecutionMode.HUGGINGFACE_INFERENCE_PROVIDERS,
            "huggingface_inference_providers",
            ExecutionMode.HUGGINGFACE_INFERENCE_ENDPOINT,
            "huggingface_inference_endpoint",
            ExecutionMode.REMOTE_OPENAI_COMPATIBLE,
            "remote_openai_compatible",
        ):
            execution_location = "remote"
        elif execution_provider == "ollama":
            execution_location = "local"
        else:
            execution_location = "unknown"

    # 5. Model Source
    model_source = None
    if raw_model_source and raw_model_source.strip():
        model_source = raw_model_source.strip()
    else:
        if source_repo_id or raw_source_type in (SourceType.HUGGINGFACE_HUB, "huggingface_hub") or raw_provider_type.lower() == "huggingface":
            model_source = "huggingface_hub"
        elif execution_provider == "ollama" and not source_repo_id:
            model_source = "ollama_library"
        elif not raw_provider_type and not raw_exec_mode and not raw_model_id and not raw_provider_model_id:
            model_source = "unknown"
        else:
            model_source = "custom"

    if not runtime_model_id:
        runtime_model_id = "unknown"

    # Display labels
    source_display_map = {
        "huggingface_hub": "Hugging Face Hub",
        "ollama_library": "Ollama Library",
        "custom": "Custom / Self-hosted",
        "google_ai_studio": "Google AI Studio",
        "openai": "OpenAI",
        "unknown": "Unknown Source",
    }
    runtime_display_map = {
        "ollama": "Ollama",
        "vllm": "vLLM",
        "huggingface_inference_providers": "Hugging Face Providers",
        "huggingface_inference_endpoint": "Hugging Face Dedicated",
        "huggingface_local_transformers": "Hugging Face Transformers",
        "openai": "OpenAI",
        "gemini": "Google Gemini",
        "unknown": "Unknown Runtime",
    }

    return {
        "model_source": model_source,
        "source_repo_id": source_repo_id,
        "execution_provider": execution_provider,
        "execution_location": execution_location,
        "runtime_model_id": runtime_model_id,
        "source_display": source_display_map.get(model_source, model_source.replace("_", " ").title()),
        "runtime_display": runtime_display_map.get(execution_provider, execution_provider.replace("_", " ").title()),
    }


def calculate_cost_breakdown(
    execution_location: str,
    prompt_tokens: Optional[int] = None,
    completion_tokens: Optional[int] = None,
    total_tokens: Optional[int] = None,
    latency_ms: Optional[float] = None,
    input_price_per_million: Optional[float] = None,
    output_price_per_million: Optional[float] = None,
    local_compute_cost_per_second: Optional[float] = None,
    local_compute_price_per_million: Optional[float] = None,
    pricing_source: Optional[str] = None,
    pricing_snapshot: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Truthful multi-dimensional cost calculation.
    Separates provider API charge from local hardware compute cost.
    Never coerces unknown cost to zero.
    """
    if pricing_snapshot:
        if isinstance(pricing_snapshot, dict):
            input_price_per_million = pricing_snapshot.get("input_price_per_million", input_price_per_million)
            output_price_per_million = pricing_snapshot.get("output_price_per_million", output_price_per_million)
            local_compute_cost_per_second = pricing_snapshot.get("local_compute_cost_per_second", local_compute_cost_per_second)
            local_compute_price_per_million = pricing_snapshot.get("local_compute_price_per_million", local_compute_price_per_million)
            pricing_source = pricing_snapshot.get("pricing_source", pricing_source)
        else:
            input_price_per_million = getattr(pricing_snapshot, "input_price_per_million", input_price_per_million)
            output_price_per_million = getattr(pricing_snapshot, "output_price_per_million", output_price_per_million)
            local_compute_cost_per_second = getattr(pricing_snapshot, "local_compute_cost_per_second", local_compute_cost_per_second)
            local_compute_price_per_million = getattr(pricing_snapshot, "local_compute_price_per_million", local_compute_price_per_million)
            pricing_source = getattr(pricing_snapshot, "pricing_source", pricing_source)

    if total_tokens is None and (prompt_tokens is not None or completion_tokens is not None):
        total_tokens = (prompt_tokens or 0) + (completion_tokens or 0)

    is_local = execution_location == "local"

    # 1. Provider API Cost
    provider_api_cost_usd: Optional[float] = None
    if is_local:
        # Local inference (e.g. Ollama) has known $0.00 provider API invoice
        provider_api_cost_usd = 0.0
    else:
        # Remote inference requires valid non-negative token counts and prices
        has_tokens = prompt_tokens is not None and completion_tokens is not None
        has_prices = (
            input_price_per_million is not None
            and output_price_per_million is not None
            and input_price_per_million >= 0.0
            and output_price_per_million >= 0.0
        )
        if has_tokens and has_prices:
            api_cost = (
                (prompt_tokens * input_price_per_million / 1_000_000.0)
                + (completion_tokens * output_price_per_million / 1_000_000.0)
            )
            provider_api_cost_usd = round(api_cost, 8)
        else:
            provider_api_cost_usd = None

    # 2. Local Compute Cost
    local_compute_cost_usd: Optional[float] = None
    if is_local:
        if local_compute_cost_per_second is not None and local_compute_cost_per_second >= 0.0 and latency_ms is not None:
            local_compute_cost_usd = round((latency_ms / 1000.0) * local_compute_cost_per_second, 8)
        elif local_compute_price_per_million is not None and local_compute_price_per_million >= 0.0 and total_tokens is not None:
            local_compute_cost_usd = round((total_tokens / 1_000_000.0) * local_compute_price_per_million, 8)
        else:
            # Unconfigured hardware cost model -> strictly unknown
            local_compute_cost_usd = None
    else:
        local_compute_cost_usd = 0.0

    # 3. Estimated Total Inference Cost
    total_cost_usd: Optional[float] = None
    cost_provenance: str = "unknown"
    if is_local:
        # For local, total cost requires known compute cost
        if local_compute_cost_usd is not None:
            total_cost_usd = round(provider_api_cost_usd + local_compute_cost_usd, 8)
            cost_provenance = "local_compute_configured"
        else:
            total_cost_usd = None
            cost_provenance = "local_api_free_compute_unpriced"
    else:
        # For remote, total cost is provider API cost
        total_cost_usd = provider_api_cost_usd
        if total_cost_usd is not None:
            cost_provenance = "remote_provider_api_invoiced"
        else:
            cost_provenance = "remote_pricing_unconfigured"

    return {
        "provider_api_cost_usd": provider_api_cost_usd,
        "local_compute_cost_usd": local_compute_cost_usd,
        "total_cost_usd": total_cost_usd,
        "is_cost_known": total_cost_usd is not None,
        "cost_provenance": cost_provenance,
    }
