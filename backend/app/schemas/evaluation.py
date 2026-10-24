"""Schemas for Benchmark Run, Model Configuration, and Benchmark Results."""
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, SecretStr
from app.schemas.models import ExecutionMode
from app.schemas.usage import PricingSnapshot
from app.schemas.dataset import TaskType


class BenchmarkRunStatus(str, Enum):
    """Lifecycle status of a multi-model benchmark evaluation run."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    COMPLETED_WITH_ERRORS = "completed_with_errors"
    FAILED = "failed"
    CANCELLED = "cancelled"


class BenchmarkModelConfig(BaseModel):
    """Configuration snapshot of a workspace model evaluated in a benchmark run."""
    model_id: str = Field(..., description="Workspace model identifier.")
    display_name: str = Field(..., description="Human-readable model name.")
    provider_type: str = Field(..., description="Provider category (ollama, vllm, huggingface, openai).")
    execution_mode: ExecutionMode = Field(..., description="Gateway execution mode.")
    provider_model_id: str = Field(..., description="Underlying runtime model ID (e.g. llama3.2:3b).")
    base_url: Optional[str] = Field(None, description="OpenAI-compatible base URL.")
    huggingface_repo_id: Optional[str] = Field(None, description="Hugging Face repo ID if applicable.")
    input_price_per_million: Optional[float] = Field(None, description="Input price snapshot.")
    output_price_per_million: Optional[float] = Field(None, description="Output price snapshot.")
    pricing_source: Optional[str] = Field(None, description="Pricing origin.")
    pricing_snapshot: Optional[PricingSnapshot] = Field(None, description="Captured pricing snapshot.")
    transient_credential: Optional[SecretStr] = Field(
        None,
        exclude=True,
        description="Transient in-memory API token (strictly excluded from serialization)."
    )


class BenchmarkGenerationSettings(BaseModel):
    """Generation parameters for deterministic benchmark evaluation."""
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(default=1024, ge=1, le=128000)
    top_p: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class BenchmarkRunProgress(BaseModel):
    """Real-time progress telemetry for an active benchmark run."""
    total_items: int = Field(default=0, description="Total evaluations (records × models).")
    completed_items: int = Field(default=0, description="Successfully evaluated items.")
    failed_items: int = Field(default=0, description="Failed evaluation items.")
    current_model_id: Optional[str] = None
    current_record_id: Optional[str] = None


class BenchmarkRunCreate(BaseModel):
    """Request payload to initiate a multi-model benchmark run."""
    dataset_manifest_id: str = Field(..., description="Target dataset manifest identifier.")
    models: List[BenchmarkModelConfig] = Field(..., min_length=1, description="Enabled models to evaluate.")
    subset_size: Optional[int] = Field(None, ge=1, le=1000, description="Subset record limit.")
    seed: int = Field(default=42, description="Fixed random seed for deterministic record sampling.")
    generation_settings: BenchmarkGenerationSettings = Field(default_factory=BenchmarkGenerationSettings)
    concurrency: int = Field(default=1, ge=1, le=4, description="Bounded concurrency (default 1 for safety).")


class BenchmarkRun(BaseModel):
    """Entity representing a benchmark run configuration, lifecycle, and progress."""
    id: str
    dataset_manifest_id: str
    dataset_name: str
    dataset_id: str
    dataset_revision: str
    source_split: str
    task_type: TaskType
    model_ids: List[str]
    model_configs: List[BenchmarkModelConfig] = Field(default_factory=list)
    status: BenchmarkRunStatus = BenchmarkRunStatus.PENDING
    progress: BenchmarkRunProgress = Field(default_factory=BenchmarkRunProgress)
    generation_settings: BenchmarkGenerationSettings = Field(default_factory=BenchmarkGenerationSettings)
    subset_size: Optional[int] = None
    seed: int = 42
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    results_summary: Dict[str, Any] = Field(default_factory=dict)


class BenchmarkResult(BaseModel):
    """Canonical evaluation result for a single (model, benchmark prompt) pair."""
    id: str
    run_id: str
    dataset_manifest_id: str
    dataset_id: str
    dataset_revision: str
    source_split: str
    record_id: str
    content_hash: str
    model_id: str
    provider_model_id: str
    model_display_name: str
    status: str = "success"  # success, failed, cancelled
    prompt_text: str
    reference_answer: str
    reference_metadata: Dict[str, Any] = Field(default_factory=dict)
    output_text: Optional[str] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    token_provenance: str = "unavailable"
    latency_ms: float = 0.0
    ttft_ms: Optional[float] = None
    finish_reason: Optional[str] = None
    pricing_snapshot: Optional[PricingSnapshot] = None
    cost_usd: Optional[float] = None
    error_message: Optional[str] = None
    error_category: Optional[str] = None
    score: Optional[float] = None  # None in M4.2.1; populated in M4.2.2 evaluation
    metric_name: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
