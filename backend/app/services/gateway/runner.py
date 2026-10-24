"""Internal inference runner reusing existing provider adapters without HTTP looping."""
import logging
from dataclasses import dataclass
from typing import Optional, List
from app.config import settings
from app.schemas.gateway import GatewayChatRequest, TokenProvenance
from app.services.gateway.registry import get_adapter_for_mode, UnsupportedExecutionModeError

logger = logging.getLogger(__name__)


@dataclass
class InternalInferenceResult:
    """Consolidated response payload from internal provider inference execution."""
    success: bool
    output_text: Optional[str] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    token_provenance: str = "unavailable"
    latency_ms: float = 0.0
    ttft_ms: Optional[float] = None
    finish_reason: Optional[str] = None
    estimated_cost_usd: Optional[float] = None
    error_message: Optional[str] = None
    error_category: Optional[str] = None


async def execute_internal_inference(
    request: GatewayChatRequest,
    credential: Optional[str] = None,
) -> InternalInferenceResult:
    """
    Execute inference against the appropriate provider adapter in-process.
    Reuses provider streaming, token normalization, error classification, and usage tracking.
    """
    # 1. Resolve adapter for the requested execution mode
    try:
        adapter = get_adapter_for_mode(request.execution_mode)
    except UnsupportedExecutionModeError as uerr:
        return InternalInferenceResult(
            success=False,
            error_message=str(uerr),
            error_category="unsupported_execution_mode",
        )
    except Exception as ex:
        return InternalInferenceResult(
            success=False,
            error_message=f"Failed to resolve adapter: {str(ex)}",
            error_category="adapter_resolution_error",
        )

    # 2. Validate configuration
    is_valid, validation_err = adapter.validate_configuration(
        request, allow_local_network=settings.allow_local_network_tests
    )
    if not is_valid:
        return InternalInferenceResult(
            success=False,
            error_message=validation_err or "Invalid provider configuration.",
            error_category="configuration_error",
        )

    # 3. Stream and consolidate response
    tokens: List[str] = []
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    token_provenance: str = "unavailable"
    estimated_cost: Optional[float] = None
    latency_ms: float = 0.0
    ttft_ms: Optional[float] = None
    finish_reason: Optional[str] = "stop"

    try:
        async for item in adapter.open_chat_stream(request, credential=credential):
            item_type = item.get("type")

            if item_type == "token":
                tokens.append(item.get("text", ""))

            elif item_type == "usage":
                prompt_tokens = item.get("prompt_tokens")
                completion_tokens = item.get("completion_tokens")
                total_tokens = item.get("total_tokens")
                token_provenance = item.get("provenance", "unavailable")
                estimated_cost = item.get("estimated_cost_usd")

            elif item_type == "done":
                finish_reason = item.get("finish_reason", "stop")
                latency_ms = item.get("latency_ms", 0.0)
                ttft_ms = item.get("ttft_ms")

            elif item_type == "error":
                return InternalInferenceResult(
                    success=False,
                    output_text="".join(tokens) if tokens else None,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    total_tokens=total_tokens,
                    token_provenance=token_provenance,
                    latency_ms=latency_ms,
                    ttft_ms=ttft_ms,
                    error_message=item.get("error", "Upstream provider error."),
                    error_category=item.get("code", "upstream_error"),
                )

        full_output = "".join(tokens)
        return InternalInferenceResult(
            success=True,
            output_text=full_output,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            token_provenance=token_provenance,
            latency_ms=latency_ms,
            ttft_ms=ttft_ms,
            finish_reason=finish_reason,
            estimated_cost_usd=estimated_cost,
        )

    except Exception as ex:
        logger.error("Exception during internal inference execution: %s", str(ex), exc_info=True)
        return InternalInferenceResult(
            success=False,
            output_text="".join(tokens) if tokens else None,
            latency_ms=latency_ms,
            error_message=f"Inference execution exception: {str(ex)}",
            error_category="runtime_exception",
        )
