"""Schemas for Routing Pools, Memberships, and Policies."""
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field


class RoutingStrategy(str, Enum):
    COST_OPTIMIZED = "cost_optimized"
    QUALITY_OPTIMIZED = "quality_optimized"
    ML_PREDICTED = "ml_predicted"
    ROUND_ROBIN = "round_robin"
    MANUAL_PRIORITY = "manual_priority"


class RoutingPoolBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    is_default: bool = False


class RoutingPoolCreate(RoutingPoolBase):
    id: Optional[str] = None


class RoutingPoolUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    is_default: Optional[bool] = None


class RoutingPool(RoutingPoolBase):
    id: str
    model_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PoolMembershipBase(BaseModel):
    pool_id: str
    model_id: str
    priority: int = Field(50, ge=1, le=100)
    is_fallback: bool = False


class PoolMembershipCreate(PoolMembershipBase):
    id: Optional[str] = None


class PoolMembership(PoolMembershipBase):
    id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RoutingPolicyBase(BaseModel):
    pool_id: str
    name: str = "Default Pool Policy"
    routing_strategy: RoutingStrategy = RoutingStrategy.COST_OPTIMIZED
    min_quality_threshold: Optional[float] = Field(None, ge=0.0, le=1.0)
    max_cost_per_million_input: Optional[float] = Field(None, ge=0.0)
    max_cost_per_million_output: Optional[float] = Field(None, ge=0.0)
    max_acceptable_latency_ms: Optional[int] = Field(None, ge=10)
    allowed_locations: List[str] = Field(default_factory=lambda: ["local", "remote"])
    fallback_model_id: Optional[str] = None
    retry_on_failure: bool = True
    max_retries: int = Field(2, ge=0, le=5)


class RoutingPolicyCreate(RoutingPolicyBase):
    id: Optional[str] = None


class RoutingPolicy(RoutingPolicyBase):
    id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
