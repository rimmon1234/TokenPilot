"""Base Provider Adapter contract for LLM chat completion streaming."""
from abc import ABC, abstractmethod
from typing import AsyncGenerator, Dict, Any, Tuple, Optional
from app.schemas.gateway import GatewayChatRequest, TokenProvenance


class BaseProviderAdapter(ABC):
    """Abstract base class for LLM gateway provider adapters."""

    @abstractmethod
    def supports_streaming(self, request: GatewayChatRequest) -> bool:
        """Return whether streaming is supported for this configuration."""
        pass

    @abstractmethod
    def validate_configuration(
        self, request: GatewayChatRequest, allow_local_network: bool = True
    ) -> Tuple[bool, Optional[str]]:
        """
        Validate provider configuration, URLs, and required fields before initiating network stream.
        Returns:
            (is_valid, error_message)
        """
        pass

    @abstractmethod
    async def open_chat_stream(
        self, request: GatewayChatRequest, credential: Optional[str] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Open upstream HTTP stream and yield normalized stream items.
        Yielded item schema:
            {
                "type": "token" | "usage" | "done" | "error",
                ... fields matching event type ...
            }
        """
        pass

    @abstractmethod
    def normalize_chunk(self, provider_chunk: Dict[str, Any]) -> Optional[str]:
        """Extract incremental text delta from a provider's raw SSE JSON chunk."""
        pass

    @abstractmethod
    def normalize_usage(self, provider_usage: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Normalize token usage payload into standard prompt/completion/total tokens."""
        pass
