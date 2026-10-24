"""Unit tests for schema validation and domain entities."""
import pytest
from pydantic import ValidationError
from app.schemas.models import (
    WorkspaceModelCreate,
    WorkspaceModel,
    ExecutionMode,
    ExecutionLocation,
    SourceType,
    GatedStatus,
    EvaluationStatus,
    ModelCapabilities,
)
from app.schemas.routing import (
    RoutingPoolCreate,
    PoolMembershipCreate,
    RoutingPolicyCreate,
    RoutingStrategy,
)
from app.schemas.usage import UsageEventCreate, PricingSnapshot


def test_valid_workspace_model_creation():
    """Verify that a valid workspace model creates successfully with defaults."""
    model = WorkspaceModelCreate(
        display_name="Local Llama 3.2",
        source_type=SourceType.CUSTOM,
        provider_type="ollama",
        execution_mode=ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
        execution_location=ExecutionLocation.LOCAL,
        provider_model_id="llama3.2:3b",
        base_url="http://localhost:11434/v1",
        license="llama3.2",
        gated_status=GatedStatus.NONE,
        context_window=8192,
        input_price_per_million=0.0,
        output_price_per_million=0.0,
        pricing_source="free_local_hardware",
        assigned_pool_ids=["pool-1", "pool-2"],
    )
    assert model.display_name == "Local Llama 3.2"
    assert model.execution_location == ExecutionLocation.LOCAL
    assert model.capabilities.supports_streaming is True
    assert model.capabilities.supports_tools is False
    assert len(model.assigned_pool_ids) == 2


def test_missing_metadata_defaults_to_unknown():
    """Verify that missing license and gated status default to unknown rather than invented claims."""
    model = WorkspaceModelCreate(
        display_name="Custom Remote Model",
        source_type=SourceType.CUSTOM,
        provider_type="openai_compatible",
        execution_mode=ExecutionMode.REMOTE_OPENAI_COMPATIBLE,
        execution_location=ExecutionLocation.REMOTE,
        provider_model_id="custom-v1",
    )
    assert model.license == "unknown"
    assert model.gated_status == GatedStatus.UNKNOWN
    assert model.evaluation_status == EvaluationStatus.UNBENCHMARKED
    assert model.pricing_source == "unknown"


def test_negative_prices_rejected():
    """Verify negative input/output token pricing raises ValidationError."""
    with pytest.raises(ValidationError):
        WorkspaceModelCreate(
            display_name="Invalid Model",
            source_type=SourceType.CUSTOM,
            provider_type="ollama",
            execution_mode=ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
            execution_location=ExecutionLocation.LOCAL,
            provider_model_id="test",
            input_price_per_million=-1.0,
        )


def test_context_window_minimum_constraint():
    """Context window must be at least 512 tokens."""
    with pytest.raises(ValidationError):
        WorkspaceModelCreate(
            display_name="Invalid Context",
            source_type=SourceType.CUSTOM,
            provider_type="ollama",
            execution_mode=ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
            execution_location=ExecutionLocation.LOCAL,
            provider_model_id="test",
            context_window=256,
        )


def test_pool_creation_and_membership():
    """Verify pool and membership schemas."""
    pool = RoutingPoolCreate(
        name="Production Grade",
        description="High reliability models",
    )
    assert pool.name == "Production Grade"
    assert pool.is_default is False

    membership = PoolMembershipCreate(
        pool_id="pool-123",
        model_id="model-456",
        priority=80,
        is_fallback=True,
    )
    assert membership.priority == 80
    assert membership.is_fallback is True


def test_priority_range_validation():
    """Membership priority must be between 1 and 100."""
    with pytest.raises(ValidationError):
        PoolMembershipCreate(
            pool_id="p1",
            model_id="m1",
            priority=101,
        )
    with pytest.raises(ValidationError):
        PoolMembershipCreate(
            pool_id="p1",
            model_id="m1",
            priority=0,
        )


def test_usage_event_creation():
    """Verify UsageEvent schema captures pricing snapshot and metrics without secrets."""
    event = UsageEventCreate(
        workspace_model_id="model-uuid",
        model_display_name_snapshot="Qwen 2.5 Coder 7B",
        routing_pool_id="pool-coding",
        prompt_tokens=500,
        completion_tokens=150,
        total_tokens=650,
        pricing_snapshot=PricingSnapshot(
            input_price_per_million=0.15,
            output_price_per_million=0.20,
            pricing_source="provider_averages",
        ),
        estimated_cost_usd=(500 * 0.15 + 150 * 0.20) / 1_000_000,
        latency_ms=420.5,
        success=True,
        routed_by="ml_router",
    )
    assert event.total_tokens == 650
    assert event.estimated_cost_usd > 0
    assert event.routed_by == "ml_router"
