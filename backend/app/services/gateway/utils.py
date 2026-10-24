"""Utilities for SSE stream parsing, cost calculations, and payload sanitization."""
import json
import logging
from typing import Optional, Dict, Any, AsyncIterator
from app.schemas.gateway import TokenProvenance

logger = logging.getLogger(__name__)


def calculate_estimated_cost(
    prompt_tokens: Optional[int],
    completion_tokens: Optional[int],
    input_price_per_million: Optional[float],
    output_price_per_million: Optional[float],
) -> Optional[float]:
    """
    Calculate estimated cost in USD based on configured token prices.
    Returns None if pricing basis is missing or unknown (never falsely zero unless explicitly 0.0).
    """
    if prompt_tokens is None or completion_tokens is None:
        return None
    if input_price_per_million is None or output_price_per_million is None:
        return None

    cost = (prompt_tokens * input_price_per_million / 1_000_000.0) + (
        completion_tokens * output_price_per_million / 1_000_000.0
    )
    return round(cost, 8)


async def iterate_sse_events(response_stream: AsyncIterator[str]) -> AsyncIterator[Dict[str, Any]]:
    """
    Robust Server-Sent Events parser over an async line/text iterator.
    Handles data: prefixes, [DONE] markers, and multi-line chunks.
    """
    buffer = ""
    async for chunk in response_stream:
        buffer += chunk
        while "\n\n" in buffer:
            event_block, buffer = buffer.split("\n\n", 1)
            event_lines = event_block.split("\n")
            data_parts = []
            for line in event_lines:
                line = line.strip()
                if not line or line.startswith(":"):
                    continue  # comment / keep-alive
                if line.startswith("data:"):
                    data_parts.append(line[5:].strip())

            if not data_parts:
                continue

            data_str = " ".join(data_parts)
            if data_str == "[DONE]":
                yield {"type": "done", "finish_reason": "stop"}
                return

            try:
                parsed_json = json.loads(data_str)
                yield parsed_json
            except json.JSONDecodeError:
                logger.debug("Failed to decode SSE data line as JSON: %s", data_str[:100])
                continue
