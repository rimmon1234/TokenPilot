"""API endpoint integration tests."""
import pytest
from starlette.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_check_endpoint():
    """Verify health check returns healthy status."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "TokenPilot" in data["service"]


def test_list_model_templates():
    """Verify curated model templates return with verified properties."""
    response = client.get("/api/models/templates")
    assert response.status_code == 200
    templates = response.json()
    assert len(templates) >= 4
    
    ids = [t["id"] for t in templates]
    assert "hf-qwen-2.5-coder-7b-instruct" in ids
    assert "local-ollama-llama-3.2-3b" in ids
    
    # Check that prices are non-negative and licenses exist
    for tmpl in templates:
        assert tmpl["input_price_per_million"] >= 0.0
        assert tmpl["output_price_per_million"] >= 0.0
        assert tmpl["license"] != ""
        assert tmpl["execution_mode"] in [
            "huggingface_inference_providers",
            "huggingface_inference_endpoint",
            "huggingface_local_transformers",
            "local_openai_compatible",
            "remote_openai_compatible",
        ]


def test_validate_model_endpoint_success():
    """Verify validating a correct model configuration payload."""
    payload = {
        "display_name": "My Ollama",
        "source_type": "custom",
        "provider_type": "ollama",
        "execution_mode": "local_openai_compatible",
        "execution_location": "local",
        "provider_model_id": "mistral:latest",
        "base_url": "http://localhost:11434/v1",
        "license": "apache-2.0",
        "context_window": 8192,
        "input_price_per_million": 0.0,
        "output_price_per_million": 0.0,
        "pricing_source": "free_local",
        "assigned_pool_ids": ["pool-1"],
    }
    response = client.post("/api/models/validate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True


def test_validate_model_endpoint_failure():
    """Verify invalid payloads return 422 Unprocessable Entity."""
    payload = {
        "display_name": "Bad Model",
        "context_window": 100,  # below minimum 512
    }
    response = client.post("/api/models/validate", json=payload)
    assert response.status_code == 422


def test_default_pools_endpoint():
    """Verify default routing pools endpoint."""
    response = client.get("/api/pools/defaults")
    assert response.status_code == 200
    pools = response.json()
    names = [p["name"] for p in pools]
    assert "Economy" in names
    assert "Quality" in names
