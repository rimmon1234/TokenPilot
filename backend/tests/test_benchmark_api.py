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


def test_cancel_active_run_success():
    from app.schemas.evaluation import BenchmarkRun, BenchmarkRunProgress, BenchmarkRunStatus, BenchmarkGenerationSettings
    from datetime import datetime, timezone
    from app.services.benchmark import benchmark_runner, benchmark_storage

    fake_run = BenchmarkRun(
        id="run-test-cancel-api",
        dataset_manifest_id="ds-test-benchmark-gsm8k",
        dataset_name="GSM8K",
        dataset_id="gsm8k",
        dataset_revision="main",
        source_split="test",
        task_type="math_reasoning",
        model_ids=["test-m1"],
        model_configs=[],
        status=BenchmarkRunStatus.RUNNING,
        progress=BenchmarkRunProgress(total_items=5),
        generation_settings=BenchmarkGenerationSettings(),
        started_at=datetime.now(timezone.utc),
    )
    benchmark_storage.save_run(fake_run)
    benchmark_runner._active_runs[fake_run.id] = fake_run

    res = client.post(f"/api/benchmarks/runs/{fake_run.id}/cancel")
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == fake_run.id
    assert data["status"] == "cancelled"

    # Verify idempotent cancel
    res_retry = client.post(f"/api/benchmarks/runs/{fake_run.id}/cancel")
    assert res_retry.status_code == 200
    assert res_retry.json()["status"] == "cancelled"

    # Clean up
    benchmark_storage.delete_run(fake_run.id)
    benchmark_runner._active_runs.pop(fake_run.id, None)


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


def test_create_benchmark_run_with_custom_name():
    """Verify custom name is accepted and trimmed."""
    mock_inference = AsyncMock(
        return_value=InternalInferenceResult(
            success=True,
            output_text="The answer is 42.",
            latency_ms=10.0,
            prompt_tokens=5,
            completion_tokens=5,
            total_tokens=10,
        )
    )
    payload = {
        "display_name": "  Qwen vs Llama — Math Pilot  ",
        "dataset_manifest_id": "ds-test-benchmark-gsm8k",
        "models": [
            {
                "model_id": "m-name-test",
                "display_name": "Model Name Test",
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
        data = res.json()
        assert data["display_name"] == "Qwen vs Llama — Math Pilot"
        run_id = data["id"]

    get_res = client.get(f"/api/benchmarks/runs/{run_id}")
    assert get_res.status_code == 200
    assert get_res.json()["display_name"] == "Qwen vs Llama — Math Pilot"


def test_create_benchmark_run_without_name_generates_default():
    """Verify omitting display_name generates a default short dataset alias and timestamp."""
    mock_inference = AsyncMock(
        return_value=InternalInferenceResult(
            success=True,
            output_text="The answer is 42.",
            latency_ms=10.0,
            prompt_tokens=5,
            completion_tokens=5,
            total_tokens=10,
        )
    )
    payload = {
        "dataset_manifest_id": "ds-test-benchmark-gsm8k",
        "models": [
            {
                "model_id": "m-default-test",
                "display_name": "Model Default Test",
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
        data = res.json()
        assert data["display_name"] is not None
        assert data["display_name"].startswith("GSM8K · ")


def test_create_benchmark_run_invalid_names():
    """Verify validation rejects empty strings, whitespace-only, and strings > 80 chars."""
    base_payload = {
        "dataset_manifest_id": "ds-test-benchmark-gsm8k",
        "models": [
            {
                "model_id": "m-val-test",
                "display_name": "Model Val Test",
                "provider_type": "ollama",
                "execution_mode": "local_openai_compatible",
                "provider_model_id": "llama3.2:3b",
                "base_url": "http://localhost:11434/v1",
            }
        ],
        "subset_size": 1,
        "seed": 42,
    }

    # Empty string
    res = client.post("/api/benchmarks/runs", json={**base_payload, "display_name": ""})
    assert res.status_code == 422

    # Whitespace only
    res = client.post("/api/benchmarks/runs", json={**base_payload, "display_name": "    "})
    assert res.status_code == 422

    # Exceeding 80 characters
    long_name = "A" * 81
    res = client.post("/api/benchmarks/runs", json={**base_payload, "display_name": long_name})
    assert res.status_code == 422


def test_rename_benchmark_run():
    """Verify PATCH /api/benchmarks/runs/{run_id} updates only display_name and persists."""
    from app.services.benchmark.storage import benchmark_storage
    from app.schemas.evaluation import BenchmarkRun, BenchmarkRunStatus, BenchmarkResult

    run_id = "run-test-rename-target"
    run = BenchmarkRun(
        id=run_id,
        display_name="Initial Benchmark Name",
        dataset_manifest_id="ds-test-benchmark-gsm8k",
        dataset_name="GSM8K API Test",
        dataset_id="gsm8k",
        dataset_revision="rev-test",
        source_split="test",
        task_type=TaskType.MATH_REASONING,
        model_ids=["m1"],
        status=BenchmarkRunStatus.COMPLETED,
        results_summary={"total_correct": 5},
    )
    result = BenchmarkResult(
        id=f"res-{run_id}-m1-rec1",
        run_id=run_id,
        dataset_manifest_id="ds-test-benchmark-gsm8k",
        dataset_id="gsm8k",
        dataset_revision="rev-test",
        source_split="test",
        record_id="rec1",
        content_hash="h1",
        model_id="m1",
        provider_model_id="m1",
        model_display_name="Model 1",
        prompt_text="What is 1+1?",
        reference_answer="2",
        output_text="2",
        score=1.0,
    )
    benchmark_storage.save_run(run, results=[result])

    try:
        # 1. Rename run with whitespace trimming
        rename_res = client.patch(
            f"/api/benchmarks/runs/{run_id}",
            json={"display_name": "  Renamed Benchmark Round 2  "},
        )
        assert rename_res.status_code == 200
        data = rename_res.json()
        assert data["display_name"] == "Renamed Benchmark Round 2"
        assert data["id"] == run_id
        # Results summary and metadata intact
        assert data["results_summary"]["total_correct"] == 5

        # 2. Verify persistence on reload
        loaded = client.get(f"/api/benchmarks/runs/{run_id}").json()
        assert loaded["display_name"] == "Renamed Benchmark Round 2"

        # 3. Verify results JSONL is intact and uncorrupted
        res_list = client.get(f"/api/benchmarks/runs/{run_id}/results").json()
        assert len(res_list) == 1
        assert res_list[0]["score"] == 1.0
    finally:
        benchmark_storage.delete_run(run_id)


def test_rename_benchmark_run_validation_and_404():
    """Verify validation errors and 404 for rename endpoint."""
    # 404 for nonexistent run
    res = client.patch("/api/benchmarks/runs/run-nonexistent", json={"display_name": "New Name"})
    assert res.status_code == 404

    # Validation errors on empty or too long name
    res = client.patch("/api/benchmarks/runs/run-nonexistent", json={"display_name": "   "})
    assert res.status_code == 422

    res = client.patch("/api/benchmarks/runs/run-nonexistent", json={"display_name": "X" * 81})
    assert res.status_code == 422


def test_legacy_benchmark_run_without_display_name():
    """Verify legacy .run.json files without display_name load cleanly and can be renamed."""
    from app.services.benchmark.storage import benchmark_storage
    from app.schemas.evaluation import BenchmarkRun, BenchmarkRunStatus

    run_id = "run-legacy-no-name"
    # Construct without display_name
    run = BenchmarkRun(
        id=run_id,
        display_name=None,
        dataset_manifest_id="ds-test-benchmark-gsm8k",
        dataset_name="GSM8K API Test",
        dataset_id="gsm8k",
        dataset_revision="rev-test",
        source_split="test",
        task_type=TaskType.MATH_REASONING,
        model_ids=["m1"],
        status=BenchmarkRunStatus.COMPLETED,
    )
    benchmark_storage.save_run(run)

    try:
        # Load legacy run
        res = client.get(f"/api/benchmarks/runs/{run_id}")
        assert res.status_code == 200
        assert res.json()["display_name"] is None

        # Rename legacy run
        patch_res = client.patch(f"/api/benchmarks/runs/{run_id}", json={"display_name": "Recovered Legacy Name"})
        assert patch_res.status_code == 200
        assert patch_res.json()["display_name"] == "Recovered Legacy Name"
    finally:
        benchmark_storage.delete_run(run_id)


def test_benchmark_exports_include_display_name():
    """Verify JSON and CSV exports include the custom benchmark display name."""
    from app.services.benchmark.storage import benchmark_storage
    from app.schemas.evaluation import BenchmarkRun, BenchmarkRunStatus, BenchmarkResult

    run_id = "run-export-name-test"
    run = BenchmarkRun(
        id=run_id,
        display_name="Export Name Verification Run",
        dataset_manifest_id="ds-test-benchmark-gsm8k",
        dataset_name="GSM8K API Test",
        dataset_id="gsm8k",
        dataset_revision="rev-test",
        source_split="test",
        task_type=TaskType.MATH_REASONING,
        model_ids=["m1"],
        status=BenchmarkRunStatus.COMPLETED,
    )
    result = BenchmarkResult(
        id=f"res-{run_id}-m1-rec1",
        run_id=run_id,
        dataset_manifest_id="ds-test-benchmark-gsm8k",
        dataset_id="gsm8k",
        dataset_revision="rev-test",
        source_split="test",
        record_id="rec1",
        content_hash="h1",
        model_id="m1",
        provider_model_id="m1",
        model_display_name="Model 1",
        prompt_text="What is 2+2?",
        reference_answer="4",
        output_text="4",
        score=1.0,
    )
    benchmark_storage.save_run(run, results=[result])

    try:
        # 1. CSV export
        csv_res = client.get(f"/api/benchmarks/runs/{run_id}/export?format=csv")
        assert csv_res.status_code == 200
        assert "# Benchmark Name,Export Name Verification Run" in csv_res.text

        # 2. JSON export
        json_res = client.get(f"/api/benchmarks/runs/{run_id}/export?format=json")
        assert json_res.status_code == 200
        export_data = json_res.json()
        assert export_data["run_metadata"]["display_name"] == "Export Name Verification Run"
    finally:
        benchmark_storage.delete_run(run_id)

