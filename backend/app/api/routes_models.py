"""API routes for Model Templates and Configuration Validation."""
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, status
from app.schemas.models import (
    ModelTemplate,
    WorkspaceModelCreate,
    WorkspaceModel,
)
from app.services.catalog import get_curated_templates

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
