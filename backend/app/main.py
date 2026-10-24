"""TokenPilot FastAPI application entrypoint."""
import logging
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api import (
    hf_router,
    models_router,
    pools_router,
    gateway_router,
    datasets_router,
    benchmarks_router,
)



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


def _format_validation_error(exc: RequestValidationError) -> str:
    """Format Pydantic validation errors into safe, actionable diagnostic messages."""
    errors = exc.errors()
    for err in errors:
        loc = err.get("loc", [])
        raw_msg = str(err.get("msg", "")).strip()

        # Clean up Pydantic's "Value error, " prefix if present
        if raw_msg.startswith("Value error, "):
            raw_msg = raw_msg[len("Value error, "):].strip()

        # Specific field translations
        if "provider_model_id" in loc or "provider_model_id" in raw_msg:
            return "Configuration error: provider_model_id is missing. Open Model Studio and configure the selected model."
        if "base_url" in loc or "base_url" in raw_msg:
            return "Configuration error: base_url is required for this execution mode. Open Model Studio and configure the selected model."
        if "messages" in loc or "message content" in raw_msg.lower():
            if "content" in loc or "empty" in raw_msg.lower():
                return "Configuration error: message content cannot be empty."
            return "Configuration error: at least one message is required."

        # If a custom message was raised in a validator, preserve its guidance
        if raw_msg and not raw_msg.startswith("String should have at least") and not raw_msg.startswith("Field required"):
            if not raw_msg.lower().startswith("configuration error"):
                return f"Configuration error: {raw_msg}"
            return raw_msg

        field_path = ".".join(str(x) for x in loc if x != "body")
        return f"Configuration error: {field_path or 'field'} is missing or invalid. Open Model Studio and configure the selected model."

    return "Configuration error: Invalid request parameters."


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    formatted_msg = _format_validation_error(exc)
    return JSONResponse(
        status_code=422,
        content={"detail": formatted_msg},
    )


# API Routers
app.include_router(hf_router, prefix="/api")
app.include_router(models_router, prefix="/api")
app.include_router(pools_router, prefix="/api")
app.include_router(gateway_router, prefix="/api")
app.include_router(datasets_router, prefix="/api")
app.include_router(benchmarks_router, prefix="/api")




@app.get("/api/health", tags=["Health"])
async def health_check():
    """Health status check."""
    return {
        "status": "healthy",
        "service": settings.app_name,
        "version": settings.version,
        "environment": settings.environment,
    }
