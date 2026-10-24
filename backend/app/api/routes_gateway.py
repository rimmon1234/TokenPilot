"""FastAPI router for the TokenPilot LLM Chat Completion Gateway."""
import json
import logging
import uuid
from typing import AsyncGenerator
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from app.config import settings
from app.schemas.gateway import (
    GatewayChatRequest,
    StreamMetaEvent,
    StreamTokenEvent,
    StreamUsageEvent,
    StreamDoneEvent,
    StreamErrorEvent,
)
from app.services.gateway.registry import get_adapter_for_mode, UnsupportedExecutionModeError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/gateway", tags=["Gateway"])


@router.post("/chat/completions")
async def chat_completions(request: GatewayChatRequest):
    """
    Execute streaming LLM chat completions across supported providers.
    Returns Server-Sent Events (SSE) of type text/event-stream.
    """
    # 1. Resolve adapter for the requested execution mode
    try:
        adapter = get_adapter_for_mode(request.execution_mode)
    except UnsupportedExecutionModeError as uerr:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(uerr)
        )

    # 2. Validate configuration before beginning stream
    is_valid, validation_err = adapter.validate_configuration(
        request, allow_local_network=settings.allow_local_network_tests
    )
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=validation_err or "Invalid provider configuration."
        )

    # 3. Extract transient credential in-memory
    credential = (
        request.transient_credential.get_secret_value()
        if request.transient_credential
        else None
    )

    req_id = request.request_id or f"req-{uuid.uuid4().hex[:12]}"

    # 4. Define streaming generator
    async def sse_event_generator() -> AsyncGenerator[str, None]:
        # Emit initial metadata event
        meta = StreamMetaEvent(
            request_id=req_id,
            model_id=request.model_id,
            provider_model_id=request.provider_model_id,
            provider_type=request.provider_type,
            execution_mode=request.execution_mode.value,
        )
        yield f"data: {meta.model_dump_json()}\n\n"

        try:
            async for item in adapter.open_chat_stream(request, credential=credential):
                item_type = item.get("type")

                if item_type == "token":
                    ev = StreamTokenEvent(text=item["text"])
                    yield f"data: {ev.model_dump_json()}\n\n"

                elif item_type == "usage":
                    ev = StreamUsageEvent(
                        prompt_tokens=item.get("prompt_tokens"),
                        completion_tokens=item.get("completion_tokens"),
                        total_tokens=item.get("total_tokens"),
                        provenance=item.get("provenance", "unavailable"),
                        estimated_cost_usd=item.get("estimated_cost_usd"),
                    )
                    yield f"data: {ev.model_dump_json()}\n\n"

                elif item_type == "done":
                    ev = StreamDoneEvent(
                        finish_reason=item.get("finish_reason", "stop"),
                        latency_ms=item.get("latency_ms", 0.0),
                        ttft_ms=item.get("ttft_ms"),
                    )
                    yield f"data: {ev.model_dump_json()}\n\n"

                elif item_type == "error":
                    ev = StreamErrorEvent(
                        error=item.get("error", "An error occurred during inference streaming."),
                        code=item.get("code", "upstream_error"),
                    )
                    yield f"data: {ev.model_dump_json()}\n\n"
                    return

        except Exception as ex:
            logger.error("Unhandled exception in SSE event generator: %s", str(ex))
            err_ev = StreamErrorEvent(
                error="Internal gateway error occurred during stream generation.",
                code="internal_stream_error",
            )
            yield f"data: {err_ev.model_dump_json()}\n\n"

    # 5. Return Server-Sent Events response
    headers = {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Content-Type": "text/event-stream; charset=utf-8",
    }
    return StreamingResponse(sse_event_generator(), media_type="text/event-stream", headers=headers)
