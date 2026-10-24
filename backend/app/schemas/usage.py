"""Schemas for UsageEvents and Auditing."""
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field


class TokenProvenance(str, Enum):
    PROVIDER_REPORTED = "provider_reported"
    ESTIMATED = "estimated"
    UNAVAILABLE = "unavailable"


class CostStatus(str, Enum):
    KNOWN = "known"
    UNKNOWN = "unknown"


class RequestStatus(str, Enum):
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"


class PricingSnapshot(BaseModel):
    input_price_per_million: Optional[float] = None
    output_price_per_million: Optional[float] = None
    pricing_source: str = "unknown"
    is_free_tier: Optional[bool] = False


class UsageEventBase(BaseModel):
    request_id: Optional[str] = None
    conversation_id: Optional[str] = None
    workspace_model_id: str
    model_display_name_snapshot: str
    provider_type: Optional[str] = None
    provider_model_id: Optional[str] = None
    execution_location: Optional[str] = "remote"
    execution_mode: Optional[str] = None
    routing_pool_id: Optional[str] = None
    prompt_tokens: Optional[int] = Field(0, ge=0)
    completion_tokens: Optional[int] = Field(0, ge=0)
    total_tokens: Optional[int] = Field(0, ge=0)
    token_provenance: TokenProvenance = TokenProvenance.PROVIDER_REPORTED
    pricing_snapshot: PricingSnapshot
    pricing_provenance: Optional[str] = "configured"
    cost_status: CostStatus = CostStatus.KNOWN
    estimated_cost_usd: Optional[float] = Field(0.0, ge=0.0)
    latency_ms: float = Field(0.0, ge=0.0)
    time_to_first_token_ms: Optional[float] = None
    finish_reason: Optional[str] = "stop"
    success: bool = True
    status: RequestStatus = RequestStatus.SUCCESS
    error_message: Optional[str] = None
    error_category: Optional[str] = None
    routed_by: str = Field("direct", description="direct, ml_router, fallback, cost_rule")


class UsageEventCreate(UsageEventBase):
    id: Optional[str] = None


class UsageEvent(UsageEventBase):
    id: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

