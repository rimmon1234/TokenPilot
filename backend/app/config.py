"""TokenPilot backend configuration."""
import os
from typing import List
from pydantic import BaseModel

class Settings(BaseModel):
    app_name: str = "TokenPilot Gateway"
    version: str = "0.1.0"
    environment: str = os.getenv("ENVIRONMENT", "development")
    cors_origins: List[str] = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000"
        ).split(",")
        if origin.strip()
    ]
    hf_token: str | None = os.getenv("HF_TOKEN")
    hf_api_timeout_seconds: float = float(os.getenv("HF_TIMEOUT", "15.0"))
    allow_local_network_tests: bool = os.getenv(
        "ALLOW_LOCAL_NETWORK_TESTS",
        "true" if os.getenv("ENVIRONMENT", "development") == "development" else "false"
    ).lower() in ("true", "1", "yes")

settings = Settings()

