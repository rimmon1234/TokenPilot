"""TokenPilot FastAPI application entrypoint."""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api import hf_router, models_router, pools_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("tokenpilot")

app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description="Intelligent ML-powered LLM gateway that optimizes inference costs while preserving quality.",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins if settings.cors_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routers
app.include_router(hf_router, prefix="/api")
app.include_router(models_router, prefix="/api")
app.include_router(pools_router, prefix="/api")


@app.get("/api/health", tags=["Health"])
async def health_check():
    """Health status check."""
    return {
        "status": "healthy",
        "service": settings.app_name,
        "version": settings.version,
        "environment": settings.environment,
    }
