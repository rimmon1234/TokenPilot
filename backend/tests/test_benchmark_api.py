"""Integration tests for Benchmark API endpoints."""
import json
from pathlib import Path
from unittest.mock import patch, AsyncMock
import pytest
from starlette.testclient import TestClient
from app.main import app
from app.schemas.dataset import DatasetManifest, TaskType, EvaluationRole
from app.services.dataset.storage import dataset_storage
from app.services.dataset.normalizers import normalize_gsm8k_record
from app.services.gateway.runner import InternalInferenceResult

client = TestClient(app)
FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def setup_dataset_and_cleanup():
    # Setup test dataset manifest and records
    with open(FIXTURES_DIR / "gsm8k_fixture.json", "r", encoding="utf-8") as f:
        raw_rows = json.load(f)

    records = [
        normalize_gsm8k_record(
            raw=row,
            dataset_id="gsm8k",
            revision="740312add88f781978c0658806c59bc2815b9866",
            split="test",
            role=EvaluationRole.HELD_OUT_TEST,
            index=i,
        )
        for i, row in enumerate(raw_rows)
    ]

    manifest = DatasetManifest(
        manifest_id="ds-test-benchmark-gsm8k",
        dataset_id="gsm8k",
        dataset_name="GSM8K API Test",
        task_type=TaskType.MATH_REASONING,
        hf_repo_id="openai/gsm8k",
        source_url="https://huggingface.co/datasets/openai/gsm8k",
        source_revision="740312add88f781978c0658806c59bc2815b9866",
        license="MIT",
        license_verified=True,
        source_split="test",
        evaluation_role=EvaluationRole.HELD_OUT_TEST,
        total_upstream_records=len(records),
        imported_record_count=len(records),
        content_fingerprint="test_fp_api",
        storage_path="",
    )
    dataset_storage.save_dataset(manifest, records)

    yield manifest

    # Cleanup dataset
    dataset_storage.delete_dataset(manifest.manifest_id)


def test_create_and_query_benchmark_run():
    mock_inference = AsyncMock(
        return_value=InternalInferenceResult(
            success=True,
            output_text="18",
            prompt_tokens=25,
            completion_tokens=5,
            total_tokens=30,
            latency_ms=110.0,
        )
    )

    payload = {
        "dataset_manifest_id": "ds-test-benchmark-gsm8k",
        "models": [
            {
                "model_id": "ollama-test-1",
                "display_name": "Llama 3.2 3B",
                "provider_type": "ollama",
                "execution_mode": "local_openai_compatible",
                "provider_model_id": "llama3.2:3b",
                "base_url": "http://localhost:11434/v1",
                "input_price_per_million": 0.0,
                "output_price_per_million": 0.0,
            }
        ],
        "subset_size": 1,
        "seed": 42,
    }

    with patch("app.services.benchmark.engine.execute_internal_inference", mock_inference):
        res = client.post("/api/benchmarks/runs", json=payload)
        assert res.status_code == 201
        run_data = res.json()
        assert run_data["id"].startswith("run-")
        assert run_data["dataset_name"] == "GSM8K API Test"
        assert run_data["progress"]["total_items"] == 1
        run_id = run_data["id"]

        # Query run by ID
        get_res = client.get(f"/api/benchmarks/runs/{run_id}")
        assert get_res.status_code == 200
        assert get_res.json()["id"] == run_id

        # List runs
        list_res = client.get("/api/benchmarks/runs")
        assert list_res.status_code == 200
        run_ids = [r["id"] for r in list_res.json()]
        assert run_id in run_ids

        # Get results
        results_res = client.get(f"/api/benchmarks/runs/{run_id}/results?limit=10&offset=0")
        assert results_res.status_code == 200


def test_create_benchmark_run_missing_manifest():
    payload = {
        "dataset_manifest_id": "ds-nonexistent-123",
        "models": [
            {
                "model_id": "m1",
                "display_name": "M",
                "provider_type": "ollama",
                "execution_mode": "local_openai_compatible",
                "provider_model_id": "llama3.2:3b",
                "base_url": "http://localhost:11434/v1",
            }
        ],
    }
    res = client.post("/api/benchmarks/runs", json=payload)
    assert res.status_code == 422
    assert "not found" in res.json()["detail"]


def test_get_nonexistent_run():
    res = client.get("/api/benchmarks/runs/run-nonexistent")
    assert res.status_code == 404


def test_cancel_nonexistent_run():
    res = client.post("/api/benchmarks/runs/run-nonexistent/cancel")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_score_benchmark_run_success():
    # Record 2 sampled by seed 42 has reference answer 70000
    mock_inference = AsyncMock(
        return_value=InternalInferenceResult(
            success=True,
            output_text="After calculating, the final answer is 70,000.",
            prompt_tokens=25,
            completion_tokens=10,
            total_tokens=35,
            latency_ms=150.0,
        )
    )

    payload = {
        "dataset_manifest_id": "ds-test-benchmark-gsm8k",
        "models": [
            {
                "model_id": "ollama-test-score",
                "display_name": "Llama 3.2 3B",
                "provider_type": "ollama",
                "execution_mode": "local_openai_compatible",
                "provider_model_id": "llama3.2:3b",
                "base_url": "http://localhost:11434/v1",
            }
        ],
        "subset_size": 1,
        "seed": 42,
    }

    with patch("app.services.benchmark.engine.execute_internal_inference", mock_inference):
        res = client.post("/api/benchmarks/runs", json=payload)
        assert res.status_code == 201
        run_id = res.json()["id"]

        from app.services.benchmark import benchmark_runner
        await benchmark_runner.wait_for_run(run_id)

    # Call score endpoint (outside patch, verifying scoring never calls inference)
    score_res = client.post(f"/api/benchmarks/runs/{run_id}/score")
    assert score_res.status_code == 200
    scored_data = score_res.json()
    assert scored_data["results_summary"]["evaluation_metric"] == "exact_match"
    assert scored_data["results_summary"]["total_correct"] == 1
    assert scored_data["results_summary"]["scorable_accuracy"] == 1.0

    # Query updated results
    results_res = client.get(f"/api/benchmarks/runs/{run_id}/results")
    assert results_res.status_code == 200
    res_list = results_res.json()
    assert len(res_list) == 1
    assert res_list[0]["evaluation_status"] == "correct"
    assert res_list[0]["score"] == 1.0
    assert res_list[0]["extracted_answer"] == "70000"


def test_score_benchmark_run_404():
    res = client.post("/api/benchmarks/runs/run-not-found-xyz/score")
    assert res.status_code == 404


def test_score_benchmark_run_unsupported_task():
    from app.services.benchmark.storage import benchmark_storage
    from app.schemas.evaluation import BenchmarkRun, BenchmarkRunStatus

    run = BenchmarkRun(
        id="run-humaneval-dummy",
        dataset_manifest_id="ds-he",
        dataset_name="HumanEval",
        dataset_id="humaneval",
        dataset_revision="rev",
        source_split="test",
        task_type=TaskType.CODE_GENERATION,
        model_ids=["m1"],
        status=BenchmarkRunStatus.COMPLETED,
    )
    benchmark_storage.save_run(run)

    try:
        res = client.post(f"/api/benchmarks/runs/{run.id}/score")
        assert res.status_code == 422
        assert "not compatible with GSM8K" in res.json()["detail"]
    finally:
        benchmark_storage.delete_run(run.id)
