"""Model configuration and Hugging Face discovery schemas."""
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, HttpUrl, field_validator


class ExecutionMode(str, Enum):
    HUGGINGFACE_INFERENCE_PROVIDERS = "huggingface_inference_providers"
    HUGGINGFACE_INFERENCE_ENDPOINT = "huggingface_inference_endpoint"
    HUGGINGFACE_LOCAL_TRANSFORMERS = "huggingface_local_transformers"
    LOCAL_OPENAI_COMPATIBLE = "local_openai_compatible"
    REMOTE_OPENAI_COMPATIBLE = "remote_openai_compatible"


class ExecutionLocation(str, Enum):
    LOCAL = "local"
    REMOTE = "remote"


class SourceType(str, Enum):
    HUGGINGFACE_HUB = "huggingface_hub"
    CUSTOM = "custom"


class GatedStatus(str, Enum):
    NONE = "none"
    AUTO = "auto"
    MANUAL = "manual"
    UNKNOWN = "unknown"


class EvaluationStatus(str, Enum):
    UNBENCHMARKED = "unbenchmarked"
    BENCHMARKING = "benchmarking"
    BENCHMARKED = "benchmarked"


class ModelCapabilities(BaseModel):
    supports_tools: bool = False
    supports_vision: bool = False
    supports_streaming: bool = True
    supports_json_mode: bool = False


class ModelTemplate(BaseModel):
    """A suggested or curated model template maintained by the catalog."""
    id: str = Field(..., description="Unique template identifier, e.g. hf-qwen-2.5-coder-7b")
    display_name: str
    description: Optional[str] = None
    source_type: SourceType = SourceType.HUGGINGFACE_HUB
    provider_type: str = Field(..., description="e.g. huggingface, ollama, vllm, groq, openai")
    execution_mode: ExecutionMode
    execution_location: ExecutionLocation
    provider_model_id: str
    huggingface_repo_id: Optional[str] = None
    base_url: Optional[str] = None
    license: str = Field("unknown", description="Verified license identifier or unknown")
    gated_status: GatedStatus = GatedStatus.UNKNOWN
    capabilities: ModelCapabilities = Field(default_factory=ModelCapabilities)
    context_window: int = Field(8192, ge=512)
    quantization: Optional[str] = None
    input_price_per_million: float = Field(0.0, ge=0.0)
    output_price_per_million: float = Field(0.0, ge=0.0)
    pricing_source: str = Field("unknown", description="e.g. official_docs, free_local, estimated")
    default_pool_hint: Optional[str] = Field("Economy", description="Suggested initial routing pool")


class WorkspaceModelBase(BaseModel):
    display_name: str
    source_type: SourceType
    provider_type: str
    execution_mode: ExecutionMode
    execution_location: ExecutionLocation
    provider_model_id: str
    huggingface_repo_id: Optional[str] = None
    base_url: Optional[str] = None
    license: str = "unknown"
    gated_status: GatedStatus = GatedStatus.UNKNOWN
    capabilities: ModelCapabilities = Field(default_factory=ModelCapabilities)
    context_window: int = Field(8192, ge=512)
    quantization: Optional[str] = None
    input_price_per_million: float = Field(0.0, ge=0.0)
    output_price_per_million: float = Field(0.0, ge=0.0)
    pricing_source: str = "unknown"
    pricing_verified_at: Optional[datetime] = None
    enabled: bool = True
    evaluation_status: EvaluationStatus = EvaluationStatus.UNBENCHMARKED
    assigned_pool_ids: List[str] = Field(default_factory=list, description="IDs of pools model belongs to")


class WorkspaceModelCreate(WorkspaceModelBase):
    id: Optional[str] = None  # Frontend can generate UUID or backend will assign


class WorkspaceModelUpdate(BaseModel):
    display_name: Optional[str] = None
    execution_mode: Optional[ExecutionMode] = None
    execution_location: Optional[ExecutionLocation] = None
    provider_model_id: Optional[str] = None
    base_url: Optional[str] = None
    license: Optional[str] = None
    gated_status: Optional[GatedStatus] = None
    capabilities: Optional[ModelCapabilities] = None
    context_window: Optional[int] = Field(None, ge=512)
    quantization: Optional[str] = None
    input_price_per_million: Optional[float] = Field(None, ge=0.0)
    output_price_per_million: Optional[float] = Field(None, ge=0.0)
    pricing_source: Optional[str] = None
    enabled: Optional[bool] = None
    evaluation_status: Optional[EvaluationStatus] = None
    assigned_pool_ids: Optional[List[str]] = None


class WorkspaceModel(WorkspaceModelBase):
    id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class HuggingFaceDiscoveredModel(BaseModel):
    """Model representation discovered via Hugging Face Hub API."""
    repo_id: str
    name: str
    author: Optional[str] = None
    likes: int = 0
    downloads: int = 0
    license: str = "unknown"
    is_license_verified: bool = False
    gated_status: GatedStatus = GatedStatus.UNKNOWN
    is_chat_verified: bool = False
    is_inference_provider_available: bool = False
    context_window: Optional[int] = None
    parameters_raw: Optional[str] = None
    quantization: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    model_card_url: str
    supported_providers: List[str] = Field(default_factory=list)
    suggested_execution_mode: ExecutionMode = ExecutionMode.HUGGINGFACE_INFERENCE_PROVIDERS
    suggested_location: ExecutionLocation = ExecutionLocation.REMOTE


class HFSearchResponse(BaseModel):
    query: str
    total_found: int
    models: List[HuggingFaceDiscoveredModel]
    cached: bool = False
    error: Optional[str] = None
