"""API routes for Hugging Face Hub discovery."""
from fastapi import APIRouter, Query
from app.schemas.models import HFSearchResponse
from app.services.hf_discovery import search_hf_models

router = APIRouter(prefix="/hf", tags=["Hugging Face Discovery"])


@router.get("/search", response_model=HFSearchResponse)
async def search_models(
    query: str = Query("", description="Keyword, model name, or full repo ID"),
    task: str = Query("text-generation", description="Hugging Face pipeline task filter"),
    limit: int = Query(20, ge=1, le=50, description="Max results to return"),
    force_refresh: bool = Query(False, description="Bypass cache if true"),
):
    """
    Search Hugging Face Hub for open language models.
    Returns verified metadata including license, gated status, parameter hints, and provider readiness.
    """
    return await search_hf_models(
        query=query,
        task=task,
        limit=limit,
        use_cache=not force_refresh,
    )
