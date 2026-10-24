"""Hugging Face Dedicated Inference Endpoints chat streaming adapter."""
import logging
import time
from typing import AsyncGenerator, Dict, Any, Tuple, Optional
import httpx
from app.core.network_validator import validate_outbound_url, sanitize_url_for_display
from app.schemas.gateway import GatewayChatRequest, TokenProvenance
from app.services.gateway.base import BaseProviderAdapter
from app.services.gateway.utils import calculate_estimated_cost, iterate_sse_events

logger = logging.getLogger(__name__)


def build_hf_endpoint_chat_url(base_url: str) -> str:
    clean = base_url.rstrip("/")
    if clean.endswith("/chat/completions"):
        return clean
    if clean.endswith("/v1"):
        return f"{clean}/chat/completions"
    return f"{clean}/v1/chat/completions"


class HFInferenceEndpointsAdapter(BaseProviderAdapter):
    """Adapter for customer-deployed Hugging Face Dedicated Inference Endpoints."""

    def supports_streaming(self, request: GatewayChatRequest) -> bool:
        return True

    def validate_configuration(
        self, request: GatewayChatRequest, allow_local_network: bool = True
    ) -> Tuple[bool, Optional[str]]:
        if not request.base_url or not request.base_url.strip():
            return False, "Endpoint URL is required for Hugging Face Dedicated Inference Endpoints."

        lower_url = request.base_url.lower()
        if "huggingface.co/" in lower_url and "endpoints.huggingface.cloud" not in lower_url:
            return False, (
                "The configured URL appears to be a Hugging Face Hub model page, not a deployed Inference Endpoint. "
                "Dedicated endpoints typically end with '.endpoints.huggingface.cloud'."
            )

        is_valid, sanitized_url, err = validate_outbound_url(
            request.base_url, allow_local_network=allow_local_network
        )
        if not is_valid:
            return False, f"Invalid or disallowed endpoint URL: {err}"

        cred = request.transient_credential.get_secret_value() if request.transient_credential else None
        if not cred or not cred.strip():
            return False, "A Hugging Face token is required to authenticate against dedicated inference endpoints."

        if not request.messages:
            return False, "At least one message is required."

        return True, None

    def normalize_chunk(self, provider_chunk: Dict[str, Any]) -> Optional[str]:
        choices = provider_chunk.get("choices") or []
        if not choices:
            return None
        delta = choices[0].get("delta") or {}
        return delta.get("content")

    def normalize_usage(self, provider_usage: Dict[str, Any]) -> Optional[Dict[str, Any]]:
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
        target_url = build_hf_endpoint_chat_url(request.base_url or "")
        sanitized_dest = sanitize_url_for_display(target_url)

        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "Authorization": f"Bearer {credential.strip() if credential else ''}",
        }

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

        logger.info("Opening Dedicated Endpoint stream to %s", sanitized_dest)
        timeout = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", target_url, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        error_body = await response.aread()
                        sanitized_msg = f"Dedicated endpoint returned HTTP {response.status_code}."
                        if response.status_code == 401:
                            sanitized_msg = "Dedicated endpoint authentication failed (HTTP 401). Please check your token."
                        elif response.status_code == 404:
                            sanitized_msg = (
                                f"Route not found on dedicated endpoint (HTTP 404). "
                                "Confirm that the container image supports OpenAI-compatible /v1/chat/completions (e.g. TGI or vLLM)."
                            )
                        elif response.status_code == 429:
                            sanitized_msg = "Dedicated endpoint rate limit or concurrency limit reached."

                        yield {
                            "type": "error",
                            "error": sanitized_msg,
                            "code": f"endpoint_http_{response.status_code}",
                        }
                        return

                    async for chunk_obj in iterate_sse_events(response.aiter_text()):
                        if chunk_obj.get("type") == "done":
                            finish_reason = chunk_obj.get("finish_reason") or finish_reason
                            continue

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

                        token_text = self.normalize_chunk(chunk_obj)
                        if token_text:
                            if first_token_time is None:
                                first_token_time = time.perf_counter()
                            yield {"type": "token", "text": token_text}

                        choices = chunk_obj.get("choices") or []
                        if choices and choices[0].get("finish_reason"):
                            finish_reason = choices[0]["finish_reason"]

        except httpx.ConnectTimeout:
            yield {
                "type": "error",
                "error": f"Connection timed out reaching dedicated endpoint at {sanitized_dest}.",
                "code": "connect_timeout",
            }
            return
        except httpx.ReadTimeout:
            yield {
                "type": "error",
                "error": "Dedicated endpoint timed out during response streaming.",
                "code": "read_timeout",
            }
            return
        except httpx.ConnectError:
            yield {
                "type": "error",
                "error": f"Failed to connect to dedicated endpoint at {sanitized_dest}.",
                "code": "connect_error",
            }
            return
        except Exception as ex:
            logger.error("Dedicated endpoint streaming error: %s", str(ex))
            yield {
                "type": "error",
                "error": "An error occurred while streaming from the dedicated endpoint.",
                "code": "stream_exception",
            }
            return

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
