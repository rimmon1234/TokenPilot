"""Schemas for the LLM Gateway and Streaming Chat Completions."""
from enum import Enum
from typing import List, Optional, Literal, Dict, Any, Union
from pydantic import BaseModel, Field, SecretStr
from app.schemas.models import ExecutionMode, ExecutionLocation


class MessageRole(str, Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"


class ChatMessage(BaseModel):
    role: MessageRole
    content: str = Field(..., min_length=1, max_length=100000, description="Text content of the message")


class TokenProvenance(str, Enum):
    PROVIDER_REPORTED = "provider_reported"
    ESTIMATED = "estimated"
    UNAVAILABLE = "unavailable"


class GatewayChatRequest(BaseModel):
    """Client request schema for initiating chat completion via the gateway."""
    # Model configuration attributes
    model_id: Optional[str] = Field(None, description="Workspace model ID reference (from IndexedDB)")
    model_display_name: Optional[str] = Field(None, description="Display name for logging/telemetry")
    provider_type: str = Field(..., description="Provider type e.g. ollama, vllm, huggingface, openai")
    execution_mode: ExecutionMode
    execution_location: Optional[ExecutionLocation] = None
    provider_model_id: str = Field(..., min_length=1, description="Model ID sent to upstream provider")
    base_url: Optional[str] = Field(None, description="Base URL for custom/local endpoints")
    huggingface_repo_id: Optional[str] = Field(None, description="HF Hub repo ID if applicable")
    provider_selection: Optional[str] = Field(None, description="Optional provider preference for HF router")

    # Conversation and parameters
    messages: List[ChatMessage] = Field(..., min_length=1, description="Ordered conversation history")
    temperature: Optional[float] = Field(0.7, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(None, ge=1, le=128000, description="Max completion tokens")
    top_p: Optional[float] = Field(None, ge=0.0, le=1.0)
    stream: bool = Field(True, description="Whether to stream Server-Sent Events")

    # Security & Transient Credentials
    transient_credential: Optional[SecretStr] = Field(
        None,
        description="Transient credential in volatile memory. Never logged or persisted."
    )

    # Pricing details for client telemetry cost calculations
    input_price_per_million: Optional[float] = Field(None, ge=0.0)
    output_price_per_million: Optional[float] = Field(None, ge=0.0)
    pricing_source: Optional[str] = None

    # Telemetry correlation
    request_id: Optional[str] = Field(None, description="Client-generated request correlation ID")


# --- Streaming SSE Events ---

class StreamMetaEvent(BaseModel):
    type: Literal["meta"] = "meta"
    request_id: str
    model_id: Optional[str] = None
    provider_model_id: str
    provider_type: str
    execution_mode: str


class StreamTokenEvent(BaseModel):
    type: Literal["token"] = "token"
    text: str


class StreamUsageEvent(BaseModel):
    type: Literal["usage"] = "usage"
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    provenance: TokenProvenance = TokenProvenance.UNAVAILABLE
    estimated_cost_usd: Optional[float] = None


class StreamDoneEvent(BaseModel):
    type: Literal["done"] = "done"
    finish_reason: Optional[str] = "stop"
    latency_ms: float
    ttft_ms: Optional[float] = None


class StreamErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    error: str
    code: Optional[str] = "generation_error"
