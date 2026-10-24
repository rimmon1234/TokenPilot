"""Schemas for Benchmark and Evaluation entities."""
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class BenchmarkResultBase(BaseModel):
    model_id: str
    prompt_id: str
    score: float = Field(..., ge=0.0, le=1.0)
    metric_name: str
    latency_ms: float
    cost_usd: float
    output_text: Optional[str] = None


class BenchmarkResult(BenchmarkResultBase):
    id: str
    run_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class BenchmarkRunBase(BaseModel):
    dataset_name: str
    dataset_version: str = "v1"
    model_ids: List[str]
    status: str = "pending"  # pending, running, completed, failed


class BenchmarkRun(BenchmarkRunBase):
    id: str
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None
    results_summary: Dict[str, Any] = Field(default_factory=dict)
