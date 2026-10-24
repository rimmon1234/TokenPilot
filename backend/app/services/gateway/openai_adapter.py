"""OpenAI-compatible chat completion streaming adapter for local and remote runtimes."""
import logging
import time
from typing import AsyncGenerator, Dict, Any, Tuple, Optional
import httpx
from app.core.network_validator import validate_outbound_url, sanitize_url_for_display
from app.schemas.gateway import GatewayChatRequest, TokenProvenance
from app.services.gateway.base import BaseProviderAdapter
from app.services.gateway.utils import calculate_estimated_cost, iterate_sse_events

logger = logging.getLogger(__name__)


def build_chat_completions_url(base_url: str) -> str:
    """Safely append /chat/completions to an OpenAI-compatible base URL."""
    clean = base_url.rstrip("/")
    if clean.endswith("/chat/completions"):
        return clean
    if clean.endswith("/v1"):
        return f"{clean}/chat/completions"
    return f"{clean}/v1/chat/completions"


class OpenAICompatibleAdapter(BaseProviderAdapter):
    """Adapter for local runtimes (Ollama, vLLM, LM Studio) and remote OpenAI-compatible endpoints."""

    def supports_streaming(self, request: GatewayChatRequest) -> bool:
        return True

    def validate_configuration(
        self, request: GatewayChatRequest, allow_local_network: bool = True
    ) -> Tuple[bool, Optional[str]]:
        if not request.base_url:
            return False, "Base URL is required for OpenAI-compatible execution mode."

        is_valid, sanitized_url, err = validate_outbound_url(
            request.base_url, allow_local_network=allow_local_network
        )
        if not is_valid:
            return False, f"Invalid or disallowed base URL: {err}"

        if not request.provider_model_id or not request.provider_model_id.strip():
            return False, "Provider model ID is required."

        if not request.messages:
            return False, "At least one message is required."

        return True, None

    def normalize_chunk(self, provider_chunk: Dict[str, Any]) -> Optional[str]:
        """Extract text delta from an OpenAI-format chunk."""
        choices = provider_chunk.get("choices") or []
        if not choices:
            return None
        delta = choices[0].get("delta") or {}
        return delta.get("content")

    def normalize_usage(self, provider_usage: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Normalize usage from an OpenAI-format chunk."""
        if not provider_usage:
            return None
        p_tokens = provider_usage.get("prompt_tokens")
        c_tokens = provider_usage.get("completion_tokens")
        t_tokens = provider_usage.get("total_tokens")
        if p_tokens is None and c_tokens is None and t_tokens is None:
            return None

        return {
            "prompt_tokens": p_tokens,
            "completion_tokens": c_tokens,
            "total_tokens": t_tokens,
            "provenance": TokenProvenance.PROVIDER_REPORTED.value,
        }

    async def open_chat_stream(
        self, request: GatewayChatRequest, credential: Optional[str] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        target_url = build_chat_completions_url(request.base_url or "")
        headers_dict = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        if credential and credential.strip():
            headers_dict["Authorization"] = f"Bearer {credential.strip()}"
        headers = httpx.Headers(headers_dict, encoding="utf-8")

        payload: Dict[str, Any] = {
            "model": request.provider_model_id,
            "messages": [{"role": m.role.value, "content": m.content} for m in request.messages],
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if request.temperature is not None:
            payload["temperature"] = request.temperature
        if request.max_tokens is not None:
            payload["max_tokens"] = request.max_tokens
        if request.top_p is not None:
            payload["top_p"] = request.top_p

        start_time = time.perf_counter()
        first_token_time: Optional[float] = None
        finish_reason: Optional[str] = "stop"
        usage_reported = False

        sanitized_dest = sanitize_url_for_display(target_url)
        logger.info(
            "Opening stream to %s for model '%s'",
            sanitized_dest,
            request.provider_model_id
        )

        timeout = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", target_url, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        error_body = await response.aread()
                        sanitized_msg = f"Upstream endpoint returned HTTP {response.status_code}."
                        if response.status_code == 401:
                            sanitized_msg = "Upstream authentication failed (HTTP 401). Please verify your API token."
                        elif response.status_code == 403:
                            sanitized_msg = "Access forbidden (HTTP 403). Ensure token has required permissions."
                        elif response.status_code == 404:
                            sanitized_msg = f"Model '{request.provider_model_id}' or /chat/completions route not found (HTTP 404)."
                        elif response.status_code == 429:
                            sanitized_msg = "Upstream rate limit reached (HTTP 429). Please retry later."

                        yield {
                            "type": "error",
                            "error": sanitized_msg,
                            "code": f"http_{response.status_code}",
                        }
                        return

                    async for chunk_obj in iterate_sse_events(response.aiter_text()):
                        # Check for done marker
                        if chunk_obj.get("type") == "done":
                            finish_reason = chunk_obj.get("finish_reason") or finish_reason
                            continue

                        # Check for usage in chunk
                        if "usage" in chunk_obj and chunk_obj["usage"]:
                            norm_usage = self.normalize_usage(chunk_obj["usage"])
                            if norm_usage:
                                cost = calculate_estimated_cost(
                                    norm_usage["prompt_tokens"],
                                    norm_usage["completion_tokens"],
                                    request.input_price_per_million,
                                    request.output_price_per_million,
                                )
                                norm_usage["estimated_cost_usd"] = cost
                                norm_usage["type"] = "usage"
                                usage_reported = True
                                yield norm_usage

                        # Extract text delta
                        token_text = self.normalize_chunk(chunk_obj)
                        if token_text:
                            if first_token_time is None:
                                first_token_time = time.perf_counter()
                            yield {"type": "token", "text": token_text}

                        # Check finish_reason on choice
                        choices = chunk_obj.get("choices") or []
                        if choices and choices[0].get("finish_reason"):
                            finish_reason = choices[0]["finish_reason"]

        except httpx.ConnectTimeout:
            yield {
                "type": "error",
                "error": f"Connection timed out reaching {sanitized_dest}.",
                "code": "connect_timeout",
            }
            return
        except httpx.ReadTimeout:
            yield {
                "type": "error",
                "error": "Upstream response timed out during streaming.",
                "code": "read_timeout",
            }
            return
        except httpx.ConnectError:
            yield {
                "type": "error",
                "error": f"Failed to connect to endpoint at {sanitized_dest}. Is the server running?",
                "code": "connect_error",
            }
            return
        except Exception as ex:
            logger.error("Streaming error for model '%s': %s", request.provider_model_id, str(ex))
            yield {
                "type": "error",
                "error": "An unexpected error occurred during inference streaming.",
                "code": "stream_exception",
            }
            return

        # If provider did not report usage, emit unavailable usage event
        if not usage_reported:
            yield {
                "type": "usage",
                "prompt_tokens": None,
                "completion_tokens": None,
                "total_tokens": None,
                "provenance": TokenProvenance.UNAVAILABLE.value,
                "estimated_cost_usd": None,
            }

        end_time = time.perf_counter()
        total_latency_ms = round((end_time - start_time) * 1000, 2)
        ttft_ms = (
            round((first_token_time - start_time) * 1000, 2)
            if first_token_time is not None
            else None
        )

        yield {
            "type": "done",
            "finish_reason": finish_reason or "stop",
            "latency_ms": total_latency_ms,
            "ttft_ms": ttft_ms,
        }
