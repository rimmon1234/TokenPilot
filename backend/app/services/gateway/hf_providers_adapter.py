"""Hugging Face Inference Providers streaming adapter using the OpenAI-compatible router."""
import logging
import time
from typing import AsyncGenerator, Dict, Any, Tuple, Optional
import httpx
from app.schemas.gateway import GatewayChatRequest, TokenProvenance
from app.services.gateway.base import BaseProviderAdapter
from app.services.gateway.utils import calculate_estimated_cost, iterate_sse_events

logger = logging.getLogger(__name__)

HF_ROUTER_BASE = "https://router.huggingface.co/v1"
HF_CHAT_COMPLETIONS_URL = f"{HF_ROUTER_BASE}/chat/completions"


class HFInferenceProvidersAdapter(BaseProviderAdapter):
    """Adapter for Hugging Face Inference Providers via router.huggingface.co."""

    def supports_streaming(self, request: GatewayChatRequest) -> bool:
        return True

    def validate_configuration(
        self, request: GatewayChatRequest, allow_local_network: bool = True
    ) -> Tuple[bool, Optional[str]]:
        # Hugging Face hosted inference requires an API token
        cred = request.transient_credential.get_secret_value() if request.transient_credential else None
        if not cred or not cred.strip():
            return False, "A Hugging Face User Access Token (read or write) is required for hosted inference providers."

        model_id = (request.provider_model_id or request.huggingface_repo_id or "").strip()
        if not model_id:
            return False, "Model repository ID (e.g. Qwen/Qwen2.5-Coder-7B-Instruct) is required."

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
        target_model = (request.provider_model_id or request.huggingface_repo_id or "").strip()

        headers_dict = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "Authorization": f"Bearer {credential.strip() if credential else ''}",
        }
        if request.provider_selection and request.provider_selection.strip():
            headers_dict["X-HF-Provider"] = request.provider_selection.strip()

        headers = httpx.Headers(headers_dict, encoding="utf-8")

        payload: Dict[str, Any] = {
            "model": target_model,
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

        logger.info("Opening Hugging Face Inference stream for model '%s'", target_model)
        timeout = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", HF_CHAT_COMPLETIONS_URL, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        error_body = await response.aread()
                        sanitized_msg = f"Hugging Face Router returned HTTP {response.status_code}."
                        if response.status_code == 401:
                            sanitized_msg = "Invalid Hugging Face token. Please check your credential."
                        elif response.status_code == 402:
                            detail_msg = None
                            try:
                                import json
                                parsed_err = json.loads(error_body.decode("utf-8", errors="replace"))
                                if isinstance(parsed_err, dict):
                                    if "error" in parsed_err and isinstance(parsed_err["error"], str):
                                        detail_msg = parsed_err["error"]
                                    elif "message" in parsed_err and isinstance(parsed_err["message"], str):
                                        detail_msg = parsed_err["message"]
                            except Exception:
                                pass

                            if detail_msg:
                                sanitized_msg = f"Payment Required (HTTP 402): {detail_msg}"
                            else:
                                sanitized_msg = (
                                    "Hugging Face Router returned HTTP 402 (Payment Required). "
                                    "Your Hugging Face account has exhausted its free monthly inference credits, "
                                    "or the selected model/provider requires an active payment method or PRO subscription."
                                )
                        elif response.status_code == 403:
                            sanitized_msg = (
                                f"Access forbidden to '{target_model}'. The model may be gated (e.g. Llama) "
                                "and requires license acceptance on Hugging Face."
                            )
                        elif response.status_code == 404:
                            sanitized_msg = (
                                f"Model '{target_model}' is not available on Hugging Face Inference Providers. "
                                "It may not have an active hosted provider."
                            )
                        elif response.status_code == 422:
                            sanitized_msg = f"Hugging Face rejected parameters for '{target_model}' (HTTP 422)."
                        elif response.status_code == 429:
                            sanitized_msg = "Hugging Face rate limit exceeded. Please wait a moment before retrying."

                        yield {
                            "type": "error",
                            "error": sanitized_msg,
                            "code": f"hf_http_{response.status_code}",
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
                "error": "Connection timed out reaching Hugging Face Inference Providers.",
                "code": "connect_timeout",
            }
            return
        except httpx.ReadTimeout:
            yield {
                "type": "error",
                "error": "Hugging Face inference request timed out during response streaming.",
                "code": "read_timeout",
            }
            return
        except httpx.ConnectError:
            yield {
                "type": "error",
                "error": "Unable to connect to router.huggingface.co. Please check network connectivity.",
                "code": "connect_error",
            }
            return
        except Exception as ex:
            logger.error("HF Inference error for '%s': %s", target_model, str(ex))
            yield {
                "type": "error",
                "error": "An error occurred while streaming from Hugging Face Inference Providers.",
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
