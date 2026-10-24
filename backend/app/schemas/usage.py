"""Schemas for UsageEvents and Auditing."""
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field


class PricingSnapshot(BaseModel):
    input_price_per_million: float
    output_price_per_million: float
    pricing_source: str = "unknown"


class UsageEventBase(BaseModel):
    workspace_model_id: str
    model_display_name_snapshot: str
    routing_pool_id: Optional[str] = None
    prompt_tokens: int = Field(0, ge=0)
    completion_tokens: int = Field(0, ge=0)
    total_tokens: int = Field(0, ge=0)
    pricing_snapshot: PricingSnapshot
    estimated_cost_usd: float = Field(0.0, ge=0.0)
    latency_ms: float = Field(0.0, ge=0.0)
    time_to_first_token_ms: Optional[float] = None
    success: bool = True
    error_message: Optional[str] = None
    routed_by: str = Field("direct", description="direct, ml_router, fallback, cost_rule")


class UsageEventCreate(UsageEventBase):
    id: Optional[str] = None


class UsageEvent(UsageEventBase):
    id: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
