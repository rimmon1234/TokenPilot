"""Model connection testing and diagnostics service."""
import logging
import time
from typing import Dict, Any, Optional, Tuple
from urllib.parse import urlparse, quote
import httpx

from app.config import settings
from app.core.network_validator import validate_outbound_url, sanitize_url_for_display
from app.schemas.models import (
    ConnectionTestRequest,
    ConnectionTestResult,
    ConnectionTestStatus,
    ExecutionMode,
)

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 7.0
MAX_RESPONSE_BYTES = 262144  # 256 KB


def _sanitize_model_id(model_id: str) -> str:
    """Sanitize model identifier for safe diagnostic display."""
    if not model_id:
        return "unknown"
    return str(model_id).strip().split("\n")[0][:100]


async def test_model_connection(request: ConnectionTestRequest) -> ConnectionTestResult:
    """
    Execute connection testing and diagnostics for a model configuration.
    Strictly redacts credentials from logs and response details.
    """
    start_time = time.perf_counter()
    sanitized_id = _sanitize_model_id(request.provider_model_id)

    # Route by execution mode
    if request.execution_mode in (
        ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
        ExecutionMode.REMOTE_OPENAI_COMPATIBLE,
    ):
        return await _test_openai_compatible(request, sanitized_id, start_time)

    elif request.execution_mode == ExecutionMode.HUGGINGFACE_INFERENCE_PROVIDERS:
        return await _test_hf_inference_provider(request, sanitized_id, start_time)

    elif request.execution_mode == ExecutionMode.HUGGINGFACE_INFERENCE_ENDPOINT:
        return await _test_hf_inference_endpoint(request, sanitized_id, start_time)

    elif request.execution_mode == ExecutionMode.HUGGINGFACE_LOCAL_TRANSFORMERS:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        return ConnectionTestResult(
            status=ConnectionTestStatus.UNSUPPORTED,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=None,
            auth_status="not_required",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message=(
                "Local Transformers execution adapter will run via direct Python runtime in a future milestone. "
                "Use Local OpenAI-Compatible mode (Ollama / vLLM / LM Studio) for active endpoint testing."
            ),
            retryable=False,
        )

    else:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        return ConnectionTestResult(
            status=ConnectionTestStatus.CONFIGURATION_ERROR,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=False,
            auth_status="untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message=f"Unsupported execution mode '{request.execution_mode.value}'.",
            retryable=False,
        )


async def _test_openai_compatible(
    request: ConnectionTestRequest,
    sanitized_id: str,
    start_time: float,
) -> ConnectionTestResult:
    """Test connection to local or remote OpenAI-compatible server (Ollama, vLLM, LM Studio, etc.)."""
    raw_base_url = (request.base_url or "").strip()
    if not raw_base_url:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        return ConnectionTestResult(
            status=ConnectionTestStatus.CONFIGURATION_ERROR,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=False,
            auth_status="untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message="Missing base URL. An endpoint URL (e.g. http://localhost:11434/v1) is required for OpenAI-compatible models.",
            retryable=False,
        )

    # SSRF & URL validation
    is_valid, sanitized_url, err_msg = validate_outbound_url(
        raw_base_url,
        allow_local_network=settings.allow_local_network_tests,
    )
    if not is_valid:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        return ConnectionTestResult(
            status=ConnectionTestStatus.CONFIGURATION_ERROR,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=False,
            auth_status="untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message=f"Endpoint URL rejected by security policy: {err_msg}",
            retryable=False,
        )

    # Determine probe URL
    base_clean = raw_base_url.rstrip("/")
    if base_clean.endswith("/v1"):
        probe_url = f"{base_clean}/models"
    else:
        probe_url = f"{base_clean}/v1/models"

    headers_dict = {"User-Agent": "TokenPilot-Diagnostics/0.1.0"}
    has_token = False
    if request.transient_credential and request.transient_credential.get_secret_value():
        headers_dict["Authorization"] = f"Bearer {request.transient_credential.get_secret_value()}"
        has_token = True
    headers = httpx.Headers(headers_dict, encoding="utf-8")

    try:
        async with httpx.AsyncClient(
            timeout=TIMEOUT_SECONDS,
            follow_redirects=False,  # Prevent unsafe redirect hops
        ) as client:
            resp = await client.get(probe_url, headers=headers)
            latency = round((time.perf_counter() - start_time) * 1000, 2)

            # If /v1/models returned 404, fallback to /models
            if resp.status_code == 404 and not base_clean.endswith("/v1"):
                fallback_probe = f"{base_clean}/models"
                is_val2, _, _ = validate_outbound_url(fallback_probe, allow_local_network=settings.allow_local_network_tests)
                if is_val2:
                    resp_fallback = await client.get(fallback_probe, headers=headers)
                    if resp_fallback.status_code != 404:
                        resp = resp_fallback

            # Case: 200 OK
            if resp.status_code == 200:
                auth_stat = "valid" if has_token else ("not_required" if request.execution_mode == ExecutionMode.LOCAL_OPENAI_COMPATIBLE else "untested")
                
                # Check model listing if JSON structure is present
                found_model = False
                total_models_found = 0
                try:
                    data = resp.json()
                    model_list = []
                    if isinstance(data, dict):
                        model_list = data.get("data") or data.get("models") or []
                    elif isinstance(data, list):
                        model_list = data

                    if isinstance(model_list, list):
                        total_models_found = len(model_list)
                        req_target = request.provider_model_id.lower()
                        for m in model_list:
                            mid = (m.get("id") or m.get("name") or "") if isinstance(m, dict) else str(m)
                            mid_clean = mid.lower()
                            if mid_clean == req_target or mid_clean.split(":")[0] == req_target.split(":")[0]:
                                found_model = True
                                break
                except Exception:
                    pass

                if found_model:
                    msg = (
                        f"Endpoint is reachable and authenticated. Confirmed model '{sanitized_id}' "
                        f"in runtime model catalog ({latency}ms). Inference capability ready for gateway calls."
                    )
                elif total_models_found > 0:
                    msg = (
                        f"Endpoint is reachable and authenticated ({latency}ms), but model '{sanitized_id}' was not "
                        f"found among {total_models_found} listed models. Verify the exact model tag on the server."
                    )
                else:
                    msg = f"Endpoint is reachable and responded with HTTP 200 ({latency}ms)."

                return ConnectionTestResult(
                    status=ConnectionTestStatus.CONNECTED,
                    provider_type=request.provider_type,
                    sanitized_model_id=sanitized_id,
                    endpoint_reachable=True,
                    auth_status=auth_stat,
                    inference_verified=False,  # Non-generative check only
                    latency_ms=latency,
                    diagnostic_message=msg,
                    retryable=False,
                    safe_details={"models_listed": total_models_found, "model_matched": found_model},
                )

            # Case: 401 / 403 Authentication failure
            elif resp.status_code in (401, 403):
                return ConnectionTestResult(
                    status=ConnectionTestStatus.AUTHENTICATION_FAILED,
                    provider_type=request.provider_type,
                    sanitized_model_id=sanitized_id,
                    endpoint_reachable=True,
                    auth_status="invalid",
                    inference_verified=False,
                    latency_ms=latency,
                    diagnostic_message=f"Endpoint is reachable, but rejected authentication (HTTP {resp.status_code}). Provide a valid API key or token.",
                    retryable=True,
                )

            # Case: 404 Route not found
            elif resp.status_code == 404:
                return ConnectionTestResult(
                    status=ConnectionTestStatus.INCONCLUSIVE,
                    provider_type=request.provider_type,
                    sanitized_model_id=sanitized_id,
                    endpoint_reachable=True,
                    auth_status="untested",
                    inference_verified=False,
                    latency_ms=latency,
                    diagnostic_message="Endpoint is reachable, but responded with HTTP 404 (route not found). Server does not expose a standard /models or /v1/models route.",
                    retryable=False,
                )

            # Case: 429 Rate limit
            elif resp.status_code == 429:
                return ConnectionTestResult(
                    status=ConnectionTestStatus.UNREACHABLE,
                    provider_type=request.provider_type,
                    sanitized_model_id=sanitized_id,
                    endpoint_reachable=True,
                    auth_status="valid" if has_token else "untested",
                    inference_verified=False,
                    latency_ms=latency,
                    diagnostic_message="Upstream endpoint rate limit exceeded (HTTP 429). Please retry after a short delay.",
                    retryable=True,
                )

            # Other HTTP statuses
            else:
                return ConnectionTestResult(
                    status=ConnectionTestStatus.UNREACHABLE,
                    provider_type=request.provider_type,
                    sanitized_model_id=sanitized_id,
                    endpoint_reachable=True,
                    auth_status="untested",
                    inference_verified=False,
                    latency_ms=latency,
                    diagnostic_message=f"Endpoint responded with unexpected HTTP {resp.status_code}.",
                    retryable=True,
                )

    except httpx.TimeoutException:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        safe_url = sanitize_url_for_display(raw_base_url)
        return ConnectionTestResult(
            status=ConnectionTestStatus.UNREACHABLE,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=False,
            auth_status="untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message=f"Connection timed out after {TIMEOUT_SECONDS}s reaching {safe_url}. Verify server is running and accessible.",
            retryable=True,
        )

    except (httpx.ConnectError, httpx.NetworkError) as exc:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        safe_url = sanitize_url_for_display(raw_base_url)
        return ConnectionTestResult(
            status=ConnectionTestStatus.UNREACHABLE,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=False,
            auth_status="untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message=f"Could not connect to {safe_url}. Ensure the service is started and listening on the designated port.",
            retryable=True,
        )

    except (UnicodeEncodeError, UnicodeDecodeError, UnicodeError) as exc:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        safe_url = sanitize_url_for_display(raw_base_url)
        return ConnectionTestResult(
            status=ConnectionTestStatus.CONFIGURATION_ERROR,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=None,
            auth_status="untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message=f"Character encoding error in endpoint configuration: {type(exc).__name__}",
            retryable=False,
        )

    except Exception as exc:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        logger.warning(f"Unexpected connection test error: {type(exc).__name__}")
        return ConnectionTestResult(
            status=ConnectionTestStatus.UNREACHABLE,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=False,
            auth_status="untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message=f"Connection attempt failed ({type(exc).__name__}). Check network settings and retry.",
            retryable=True,
        )


async def _test_hf_inference_provider(
    request: ConnectionTestRequest,
    sanitized_id: str,
    start_time: float,
) -> ConnectionTestResult:
    """Validate Hugging Face Hub token authentication and provider model readiness."""
    repo_id = (request.huggingface_repo_id or request.provider_model_id).strip()
    if not repo_id:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        return ConnectionTestResult(
            status=ConnectionTestStatus.CONFIGURATION_ERROR,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=False,
            auth_status="untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message="Missing Hugging Face repository identifier (e.g. meta-llama/Llama-3.1-8B-Instruct).",
            retryable=False,
        )

    # Check token from transient request or environment
    token = None
    if request.transient_credential and request.transient_credential.get_secret_value():
        token = request.transient_credential.get_secret_value()
    elif settings.hf_token:
        token = settings.hf_token

    headers_dict = {"User-Agent": "TokenPilot-Diagnostics/0.1.0"}
    if token:
        headers_dict["Authorization"] = f"Bearer {token}"
    headers = httpx.Headers(headers_dict, encoding="utf-8")

    auth_valid = False
    user_name = None

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            # 1. If token is provided, validate credential via whoami
            if token:
                auth_resp = await client.get("https://huggingface.co/api/whoami-v2", headers=headers)
                latency_auth = round((time.perf_counter() - start_time) * 1000, 2)
                if auth_resp.status_code in (401, 403):
                    return ConnectionTestResult(
                        status=ConnectionTestStatus.AUTHENTICATION_FAILED,
                        provider_type=request.provider_type,
                        sanitized_model_id=sanitized_id,
                        endpoint_reachable=True,
                        auth_status="invalid",
                        inference_verified=False,
                        latency_ms=latency_auth,
                        diagnostic_message="Hugging Face token validation failed (HTTP 401/403). The provided token is invalid or expired.",
                        retryable=True,
                    )
                elif auth_resp.status_code == 200:
                    auth_valid = True
                    try:
                        whoami_data = auth_resp.json()
                        user_name = whoami_data.get("name")
                    except Exception:
                        pass
                elif auth_resp.status_code == 429:
                    return ConnectionTestResult(
                        status=ConnectionTestStatus.UNREACHABLE,
                        provider_type=request.provider_type,
                        sanitized_model_id=sanitized_id,
                        endpoint_reachable=True,
                        auth_status="untested",
                        inference_verified=False,
                        latency_ms=latency_auth,
                        diagnostic_message="Hugging Face API rate limit reached. Please retry in a few moments.",
                        retryable=True,
                    )

            # 2. Check repository metadata and provider availability on Hub
            safe_repo_id = quote(repo_id, safe="/@")
            repo_url = f"https://huggingface.co/api/models/{safe_repo_id}"
            model_resp = await client.get(repo_url, headers=headers)
            latency = round((time.perf_counter() - start_time) * 1000, 2)

            if model_resp.status_code == 404:
                return ConnectionTestResult(
                    status=ConnectionTestStatus.CONFIGURATION_ERROR,
                    provider_type=request.provider_type,
                    sanitized_model_id=sanitized_id,
                    endpoint_reachable=True,
                    auth_status="valid" if auth_valid else "untested",
                    inference_verified=False,
                    latency_ms=latency,
                    diagnostic_message=f"Model repository '{repo_id}' was not found on the Hugging Face Hub.",
                    retryable=False,
                )

            if model_resp.status_code in (401, 403):
                return ConnectionTestResult(
                    status=ConnectionTestStatus.AUTHENTICATION_FAILED if token else ConnectionTestStatus.INCONCLUSIVE,
                    provider_type=request.provider_type,
                    sanitized_model_id=sanitized_id,
                    endpoint_reachable=True,
                    auth_status="invalid" if (token and not auth_valid) else ("valid" if auth_valid else "untested"),
                    inference_verified=False,
                    latency_ms=latency,
                    diagnostic_message=f"Model repository '{repo_id}' is gated or private. A Hugging Face token with granted repository permissions is required.",
                    retryable=True,
                )

            if model_resp.status_code == 200:
                data = model_resp.json()
                is_gated = bool(data.get("gated"))
                inf_status = data.get("inference")
                is_serverless = inf_status in ("warm", "cold", True)

                # Collect provider hints
                raw_tags = data.get("tags")
                tags = raw_tags if isinstance(raw_tags, list) else []
                supported_providers = [
                    t.split("provider:", 1)[1] for t in tags if isinstance(t, str) and t.startswith("provider:")
                ]

                if not token:
                    return ConnectionTestResult(
                        status=ConnectionTestStatus.INCONCLUSIVE,
                        provider_type=request.provider_type,
                        sanitized_model_id=sanitized_id,
                        endpoint_reachable=True,
                        auth_status="untested",
                        inference_verified=False,
                        latency_ms=latency,
                        diagnostic_message=(
                            f"Model '{repo_id}' exists on Hugging Face Hub, but no user token was provided. "
                            "A Hugging Face user token is required to authenticate hosted inference provider calls."
                        ),
                        retryable=True,
                        safe_details={"gated": is_gated, "inference_ready": is_serverless},
                    )

                status_msg = (
                    f"Hugging Face credentials verified (user: {user_name or 'authenticated'}). "
                    f"Repository '{repo_id}' verified on Hub."
                )
                if is_serverless:
                    status_msg += " Serverless inference provider availability is confirmed."
                elif supported_providers:
                    status_msg += f" Supported inference partners: {', '.join(supported_providers[:3])}."
                else:
                    status_msg += " Model is available; provider execution readiness will be confirmed upon first generation call."

                return ConnectionTestResult(
                    status=ConnectionTestStatus.CONNECTED,
                    provider_type=request.provider_type,
                    sanitized_model_id=sanitized_id,
                    endpoint_reachable=True,
                    auth_status="valid",
                    inference_verified=False,  # Distinguish metadata verification from generative inference
                    latency_ms=latency,
                    diagnostic_message=status_msg,
                    retryable=False,
                    safe_details={
                        "gated": is_gated,
                        "inference_provider_ready": is_serverless or bool(supported_providers),
                    },
                )

            return ConnectionTestResult(
                status=ConnectionTestStatus.INCONCLUSIVE,
                provider_type=request.provider_type,
                sanitized_model_id=sanitized_id,
                endpoint_reachable=True,
                auth_status="valid" if auth_valid else "untested",
                inference_verified=False,
                latency_ms=latency,
                diagnostic_message=f"Hugging Face Hub API returned unexpected status {model_resp.status_code}. Hub search failed, but inference endpoints remain reachable.",
                retryable=True,
            )

    except httpx.TimeoutException:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        return ConnectionTestResult(
            status=ConnectionTestStatus.INCONCLUSIVE if auth_valid else ConnectionTestStatus.UNREACHABLE,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=True if auth_valid else False,
            auth_status="valid" if auth_valid else "untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message=(
                "Hugging Face model metadata query timed out. Inference endpoint reachability could not be confirmed."
                if auth_valid else
                "Connection timed out while contacting Hugging Face Hub."
            ),
            retryable=True,
        )

    except (UnicodeEncodeError, UnicodeDecodeError, UnicodeError) as exc:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        return ConnectionTestResult(
            status=ConnectionTestStatus.CONFIGURATION_ERROR,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=True if auth_valid else None,
            auth_status="valid" if auth_valid else "untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message=f"Configuration encoding error: {type(exc).__name__}",
            retryable=False,
        )

    except Exception as exc:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        return ConnectionTestResult(
            status=ConnectionTestStatus.INCONCLUSIVE if auth_valid else ConnectionTestStatus.UNREACHABLE,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=True if auth_valid else False,
            auth_status="valid" if auth_valid else "untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message=f"Hugging Face Hub query failed: {type(exc).__name__}",
            retryable=True,
        )


async def _test_hf_inference_endpoint(
    request: ConnectionTestRequest,
    sanitized_id: str,
    start_time: float,
) -> ConnectionTestResult:
    """Validate a deployed private Hugging Face Inference Endpoint."""
    raw_url = (request.base_url or "").strip()
    if not raw_url:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        return ConnectionTestResult(
            status=ConnectionTestStatus.CONFIGURATION_ERROR,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=False,
            auth_status="untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message="Base URL is required for Hugging Face Dedicated Inference Endpoints.",
            retryable=False,
        )

    # Guard against confusing a Hub repository URL with a deployed endpoint
    try:
        parsed = urlparse(raw_url)
        if parsed.hostname and parsed.hostname.lower() in ("huggingface.co", "www.huggingface.co"):
            latency = round((time.perf_counter() - start_time) * 1000, 2)
            return ConnectionTestResult(
                status=ConnectionTestStatus.CONFIGURATION_ERROR,
                provider_type=request.provider_type,
                sanitized_model_id=sanitized_id,
                endpoint_reachable=False,
                auth_status="untested",
                inference_verified=False,
                latency_ms=latency,
                diagnostic_message=(
                    "The configured URL is a Hugging Face Hub repository URL (huggingface.co), not a deployed "
                    "Inference Endpoint. Dedicated endpoints typically look like: https://[name].[region].endpoints.huggingface.cloud"
                ),
                retryable=False,
            )
    except Exception:
        pass

    # SSRF & URL validation
    is_valid, sanitized_url, err_msg = validate_outbound_url(
        raw_url,
        allow_local_network=settings.allow_local_network_tests,
    )
    if not is_valid:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        return ConnectionTestResult(
            status=ConnectionTestStatus.CONFIGURATION_ERROR,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=False,
            auth_status="untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message=f"Endpoint URL rejected by security policy: {err_msg}",
            retryable=False,
        )

    token = None
    if request.transient_credential and request.transient_credential.get_secret_value():
        token = request.transient_credential.get_secret_value()
    elif settings.hf_token:
        token = settings.hf_token

    headers_dict = {"User-Agent": "TokenPilot-Diagnostics/0.1.0"}
    if token:
        headers_dict["Authorization"] = f"Bearer {token}"
    headers = httpx.Headers(headers_dict, encoding="utf-8")

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=False) as client:
            # Probe endpoint root or /health
            resp = await client.get(raw_url.rstrip("/") + "/health", headers=headers)
            latency = round((time.perf_counter() - start_time) * 1000, 2)

            if resp.status_code == 404:
                # Some endpoints only respond on root
                resp = await client.get(raw_url, headers=headers)
                latency = round((time.perf_counter() - start_time) * 1000, 2)

            if resp.status_code == 200:
                return ConnectionTestResult(
                    status=ConnectionTestStatus.CONNECTED,
                    provider_type=request.provider_type,
                    sanitized_model_id=sanitized_id,
                    endpoint_reachable=True,
                    auth_status="valid" if token else "not_required",
                    inference_verified=False,
                    latency_ms=latency,
                    diagnostic_message=f"Hugging Face Dedicated Endpoint is reachable and active ({latency}ms).",
                    retryable=False,
                )

            elif resp.status_code in (401, 403):
                return ConnectionTestResult(
                    status=ConnectionTestStatus.AUTHENTICATION_FAILED,
                    provider_type=request.provider_type,
                    sanitized_model_id=sanitized_id,
                    endpoint_reachable=True,
                    auth_status="invalid",
                    inference_verified=False,
                    latency_ms=latency,
                    diagnostic_message="Dedicated Endpoint reached, but authentication was rejected (HTTP 401/403). Check HF Token.",
                    retryable=True,
                )

            elif resp.status_code == 503:
                return ConnectionTestResult(
                    status=ConnectionTestStatus.INCONCLUSIVE,
                    provider_type=request.provider_type,
                    sanitized_model_id=sanitized_id,
                    endpoint_reachable=True,
                    auth_status="valid" if token else "untested",
                    inference_verified=False,
                    latency_ms=latency,
                    diagnostic_message="Dedicated Endpoint is reachable, but currently paused or initializing (HTTP 503).",
                    retryable=True,
                )

            else:
                return ConnectionTestResult(
                    status=ConnectionTestStatus.UNREACHABLE,
                    provider_type=request.provider_type,
                    sanitized_model_id=sanitized_id,
                    endpoint_reachable=True,
                    auth_status="untested",
                    inference_verified=False,
                    latency_ms=latency,
                    diagnostic_message=f"Dedicated Endpoint responded with HTTP {resp.status_code}.",
                    retryable=True,
                )

    except httpx.TimeoutException:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        safe_url = sanitize_url_for_display(raw_url)
        return ConnectionTestResult(
            status=ConnectionTestStatus.UNREACHABLE,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=False,
            auth_status="untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message=f"Connection timed out reaching {safe_url}.",
            retryable=True,
        )

    except (UnicodeEncodeError, UnicodeDecodeError, UnicodeError) as exc:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        safe_url = sanitize_url_for_display(raw_url)
        return ConnectionTestResult(
            status=ConnectionTestStatus.CONFIGURATION_ERROR,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=None,
            auth_status="untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message=f"Character encoding error in endpoint configuration: {type(exc).__name__}",
            retryable=False,
        )

    except Exception as exc:
        latency = round((time.perf_counter() - start_time) * 1000, 2)
        safe_url = sanitize_url_for_display(raw_url)
        return ConnectionTestResult(
            status=ConnectionTestStatus.UNREACHABLE,
            provider_type=request.provider_type,
            sanitized_model_id=sanitized_id,
            endpoint_reachable=False,
            auth_status="untested",
            inference_verified=False,
            latency_ms=latency,
            diagnostic_message=f"Could not connect to {safe_url}: {type(exc).__name__}",
            retryable=True,
        )
