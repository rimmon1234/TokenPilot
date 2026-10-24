"""API routes for Model Templates and Configuration Validation."""
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, status
from app.schemas.models import (
    ModelTemplate,
    WorkspaceModelCreate,
    WorkspaceModel,
    ConnectionTestRequest,
    ConnectionTestResult,
)
from app.services.catalog import get_curated_templates
from app.services.connection_tester import test_model_connection

router = APIRouter(prefix="/models", tags=["Models & Templates"])


@router.get("/templates", response_model=List[ModelTemplate])
async def list_model_templates():
    """
    List recommended, verified model templates across Hugging Face and local runtimes.
    """
    return get_curated_templates()


@router.post("/validate", response_model=Dict[str, Any])
async def validate_model_configuration(model_data: WorkspaceModelCreate):
    """
    Validate a proposed model configuration against Pydantic schema rules.
    Verifies price values, context window limits, execution modes, and locations.
    """
    # If validation passes through Pydantic dependency injection:
    return {
        "valid": True,
        "message": "Configuration satisfies TokenPilot schema standards.",
        "model_id": model_data.provider_model_id,
        "execution_mode": model_data.execution_mode.value,
        "execution_location": model_data.execution_location.value,
    }


@router.post("/test-connection", response_model=ConnectionTestResult)
async def test_connection(request: ConnectionTestRequest):
    """
    Test endpoint reachability, credentials, and inference readiness for a configured model.
    Credentials are held in volatile request memory only and are never persisted or logged.
    """
    return await test_model_connection(request)

