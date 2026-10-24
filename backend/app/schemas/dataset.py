"""Schemas for Benchmark Dataset Registry, Canonical Records, and Import Pipeline."""
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class TaskType(str, Enum):
    """Task category for benchmark datasets."""
    MATH_REASONING = "math_reasoning"
    CODE_GENERATION = "code_generation"


class EvaluationRole(str, Enum):
    """Explicit dataset roles for evaluation and future ML router training."""
    DEV_TRAIN = "dev_train"
    VALIDATION = "validation"
    HELD_OUT_TEST = "held_out_test"


class DatasetValidationStatus(str, Enum):
    """Validation and verification state of an imported dataset."""
    VERIFIED = "verified"
    UNVERIFIED = "unverified"
    FAILED = "failed"


class DatasetRecord(BaseModel):
    """Canonical, normalized representation of an individual benchmark prompt record."""
    record_id: str = Field(..., description="Stable, deterministic record identifier.")
    dataset_id: str = Field(..., description="Upstream dataset identifier (e.g. gsm8k, humaneval).")
    dataset_revision: str = Field(..., description="Resolved Git commit SHA from Hugging Face Hub.")
    source_split: str = Field(..., description="Upstream source split (e.g. train, test).")
    evaluation_role: EvaluationRole = Field(..., description="Designated role for training or evaluation.")
    task_type: TaskType = Field(..., description="Task category for evaluation metric selection.")
    input_messages: List[Dict[str, str]] = Field(
        ...,
        description="Standard chat message sequence presented to the evaluated model."
    )
    reference_answer: str = Field(..., description="Preserved upstream reference ground truth.")
    reference_metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Task-specific evaluation metadata (e.g. extracted numeric answer, unit tests)."
    )
    license: str = Field(..., description="License identifier recorded from dataset card.")
    source_url: str = Field(..., description="Upstream dataset repository URL.")
    content_hash: str = Field(..., description="SHA-256 fingerprint of the prompt and reference.")


class DatasetTemplate(BaseModel):
    """Pre-registered template metadata for supported benchmark datasets."""
    id: str
    name: str
    description: str
    task_type: TaskType
    hf_repo_id: str
    default_config: Optional[str] = None
    available_splits: List[str]
    allowed_roles_per_split: Dict[str, List[EvaluationRole]]
    license: str
    license_verified: bool
    pinned_revision: str
    recommended_subsets: List[int] = Field(default_factory=lambda: [5, 10, 25, 50, 100])
    sample_records: List[Dict[str, Any]] = Field(default_factory=list)


class DatasetImportRequest(BaseModel):
    """Parameters required to initiate a reproducible dataset import."""
    dataset_id: str = Field(..., description="Template ID: 'gsm8k' or 'humaneval'.")
    split: str = Field(..., description="Target split: 'train' or 'test'.")
    revision: Optional[str] = Field(None, description="Optional commit SHA override.")
    subset_size: Optional[int] = Field(None, ge=1, le=1000, description="Subset limit for quick evaluations.")
    seed: int = Field(default=42, description="Fixed random seed for reproducible sampling.")
    evaluation_role: EvaluationRole = Field(..., description="Role discipline (held_out_test, dev_train, validation).")


class DatasetManifest(BaseModel):
    """Metadata manifest of a locally imported and validated benchmark dataset."""
    manifest_id: str
    dataset_id: str
    dataset_name: str
    task_type: TaskType
    hf_repo_id: str
    source_url: str
    source_revision: str
    license: str
    license_verified: bool
    source_split: str
    evaluation_role: EvaluationRole
    total_upstream_records: Optional[int] = None
    imported_record_count: int
    subset_size: Optional[int] = None
    sampling_seed: Optional[int] = None
    content_fingerprint: str
    imported_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    validation_status: DatasetValidationStatus = DatasetValidationStatus.VERIFIED
    storage_path: str
    status_detail: Optional[str] = None
    is_benchmarked: bool = False
