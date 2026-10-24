"""Adapter registry resolving LLM execution modes to concrete provider adapters."""
from typing import Dict
from app.schemas.models import ExecutionMode
from app.services.gateway.base import BaseProviderAdapter
from app.services.gateway.openai_adapter import OpenAICompatibleAdapter
from app.services.gateway.hf_providers_adapter import HFInferenceProvidersAdapter
from app.services.gateway.hf_endpoints_adapter import HFInferenceEndpointsAdapter


class UnsupportedExecutionModeError(Exception):
    """Raised when an execution mode is not supported by the streaming gateway."""
    pass


class AdapterRegistry:
    """Registry maintaining singletons of provider adapters."""

    def __init__(self):
        self._openai_adapter = OpenAICompatibleAdapter()
        self._hf_providers_adapter = HFInferenceProvidersAdapter()
        self._hf_endpoints_adapter = HFInferenceEndpointsAdapter()

    def get_adapter(self, mode: ExecutionMode) -> BaseProviderAdapter:
        if mode in (ExecutionMode.LOCAL_OPENAI_COMPATIBLE, ExecutionMode.REMOTE_OPENAI_COMPATIBLE):
            return self._openai_adapter
        elif mode == ExecutionMode.HUGGINGFACE_INFERENCE_PROVIDERS:
            return self._hf_providers_adapter
        elif mode == ExecutionMode.HUGGINGFACE_INFERENCE_ENDPOINT:
            return self._hf_endpoints_adapter
        elif mode == ExecutionMode.HUGGINGFACE_LOCAL_TRANSFORMERS:
            raise UnsupportedExecutionModeError(
                "Execution mode 'huggingface_local_transformers' is not supported for in-process inference in this milestone. "
                "To run this model, expose it via an OpenAI-compatible runtime such as Ollama, vLLM, or LM Studio, "
                "and select 'local_openai_compatible'."
            )
        else:
            raise UnsupportedExecutionModeError(f"Unsupported execution mode: {mode}")


_registry = AdapterRegistry()


def get_adapter_for_mode(mode: ExecutionMode) -> BaseProviderAdapter:
    """Helper to retrieve provider adapter for execution mode."""
    return _registry.get_adapter(mode)
