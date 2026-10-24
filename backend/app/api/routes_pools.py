"""API routes for default routing pools and configurations."""
from typing import List
from fastapi import APIRouter
from app.schemas.routing import RoutingPoolBase

router = APIRouter(prefix="/pools", tags=["Routing Pools"])

DEFAULT_POOLS = [
    RoutingPoolBase(
        name="Economy",
        description="Cost-optimized routing pool for fast, high-throughput, and lightweight tasks.",
        is_default=True,
    ),
    RoutingPoolBase(
        name="Quality",
        description="Performance-optimized routing pool for complex reasoning, code generation, and high-accuracy queries.",
        is_default=False,
    ),
    RoutingPoolBase(
        name="Local Only",
        description="Zero-egress routing pool containing strictly local runtimes (Ollama, vLLM, LM Studio).",
        is_default=False,
    ),
]


@router.get("/defaults", response_model=List[RoutingPoolBase])
async def get_default_pools():
    """Return default suggested routing pools for new workspaces."""
    return DEFAULT_POOLS
