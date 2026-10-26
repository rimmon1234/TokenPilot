"""Unit tests for BenchmarkRunner engine, lifecycle, telemetry, and cancellation."""
import asyncio
import json
import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch, AsyncMock
import pytest
from app.schemas.models import ExecutionMode
from app.schemas.dataset import TaskType, EvaluationRole, DatasetManifest
from app.schemas.evaluation import (
    BenchmarkRunCreate,
    BenchmarkModelConfig,
    BenchmarkGenerationSettings,
    BenchmarkRunStatus,
)
from app.services.dataset.storage import DatasetStorageManager
from app.services.benchmark.storage import BenchmarkStorageManager
from app.services.benchmark.engine import BenchmarkRunner
from app.services.gateway.runner import InternalInferenceResult

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def temp_dirs():
    temp_datasets = tempfile.mkdtemp()
    temp_benchmarks = tempfile.mkdtemp()
    ds_storage = DatasetStorageManager(storage_dir=temp_datasets)
    bm_storage = BenchmarkStorageManager(storage_dir=temp_benchmarks)
    runner = BenchmarkRunner(storage=bm_storage, dataset_store=ds_storage)

    # Populate a deterministic GSM8K dataset manifest and records
    with open(FIXTURES_DIR / "gsm8k_fixture.json", "r", encoding="utf-8") as f:
        raw_rows = json.load(f)

    from app.services.dataset.normalizers import normalize_gsm8k_record
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
        manifest_id="ds-gsm8k-test-held_out_test-sub3-test12",
        dataset_id="gsm8k",
        dataset_name="GSM8K (Test Set)",
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
        content_fingerprint="test_fp_12345",
        storage_path="",
    )
    ds_storage.save_dataset(manifest, records)

    yield {
        "runner": runner,
        "bm_storage": bm_storage,
        "ds_storage": ds_storage,
        "manifest_id": manifest.manifest_id,
    }

    shutil.rmtree(temp_datasets, ignore_errors=True)
    shutil.rmtree(temp_benchmarks, ignore_errors=True)


@pytest.mark.asyncio
async def test_sequential_multi_model_benchmark_execution(temp_dirs):
    runner: BenchmarkRunner = temp_dirs["runner"]
    manifest_id = temp_dirs["manifest_id"]

    models = [
        BenchmarkModelConfig(
            model_id="m1-ollama",
            display_name="Ollama Llama 3.2",
            provider_type="ollama",
            execution_mode=ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
            provider_model_id="llama3.2:3b",
            base_url="http://localhost:11434/v1",
            input_price_per_million=0.0,
            output_price_per_million=0.0,
            pricing_source="local_hardware",
        ),
        BenchmarkModelConfig(
            model_id="m2-qwen",
            display_name="Qwen 2.5 Coder 7B",
            provider_type="huggingface",
            execution_mode=ExecutionMode.HUGGINGFACE_INFERENCE_PROVIDERS,
            provider_model_id="Qwen/Qwen2.5-Coder-7B-Instruct",
            input_price_per_million=0.15,
            output_price_per_million=0.20,
            pricing_source="hf_catalog",
        ),
    ]

    req = BenchmarkRunCreate(
        dataset_manifest_id=manifest_id,
        models=models,
        subset_size=2,  # 2 questions × 2 models = 4 total evaluations
        seed=42,
        generation_settings=BenchmarkGenerationSettings(temperature=0.0, max_tokens=256),
    )

    # Mock internal inference to return deterministic successful answers
    mock_inference = AsyncMock(
        return_value=InternalInferenceResult(
            success=True,
            output_text="To solve this, we compute 9 * 2 = 18. #### 18",
            prompt_tokens=40,
            completion_tokens=20,
            total_tokens=60,
            token_provenance="provider_reported",
            latency_ms=150.0,
            ttft_ms=35.0,
            finish_reason="stop",
        )
    )

    with patch("app.services.benchmark.engine.execute_internal_inference", mock_inference):
        run = runner.start_benchmark_run(req)
        assert run.status in (BenchmarkRunStatus.PENDING, BenchmarkRunStatus.RUNNING)
        assert run.progress.total_items == 4

        # Wait briefly for background execution loop to complete
        await asyncio.sleep(0.1)

        completed_run = runner.get_run(run.id)
        assert completed_run is not None
        assert completed_run.status == BenchmarkRunStatus.COMPLETED
        assert completed_run.progress.completed_items == 4
        assert completed_run.progress.failed_items == 0

        # Verify results in storage
        results = runner.storage.get_results(run.id, limit=10, offset=0)
        assert len(results) == 4

        # Check telemetry and attribution
        m1_res = [r for r in results if r.model_id == "m1-ollama"]
        m2_res = [r for r in results if r.model_id == "m2-qwen"]
        assert len(m1_res) == 2
        assert len(m2_res) == 2

        # Check truthful cost calculation: m1 has $0.00 API cost but unknown total cost; m2 has 0.00001
        assert m1_res[0].provider_api_cost_usd == 0.0
        assert m1_res[0].local_compute_cost_usd is None
        assert m1_res[0].cost_usd is None  # Truthful: local model without compute price is unpriced
        assert m2_res[0].provider_api_cost_usd == pytest.approx(0.00001)
        assert m2_res[0].cost_usd == pytest.approx(0.00001)
        assert m1_res[0].latency_ms == 150.0
        assert m1_res[0].score is None


@pytest.mark.asyncio
async def test_benchmark_run_handles_model_failures_resiliently(temp_dirs):
    runner: BenchmarkRunner = temp_dirs["runner"]
    manifest_id = temp_dirs["manifest_id"]

    models = [
        BenchmarkModelConfig(
            model_id="m1-failing",
            display_name="Failing Model",
            provider_type="ollama",
            execution_mode=ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
            provider_model_id="nonexistent-model",
            base_url="http://localhost:11434/v1",
        ),
        BenchmarkModelConfig(
            model_id="m2-working",
            display_name="Working Model",
            provider_type="ollama",
            execution_mode=ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
            provider_model_id="llama3.2:3b",
            base_url="http://localhost:11434/v1",
        ),
    ]

    req = BenchmarkRunCreate(
        dataset_manifest_id=manifest_id,
        models=models,
        subset_size=1,  # 1 question × 2 models = 2 evaluations
    )

    async def side_effect(chat_req, credential=None):
        if chat_req.model_id == "m1-failing":
            return InternalInferenceResult(
                success=False,
                error_message="Model 'nonexistent-model' not found (HTTP 404).",
                error_category="not_found_error",
                latency_ms=45.0,
            )
        return InternalInferenceResult(
            success=True,
            output_text="4",
            prompt_tokens=10,
            completion_tokens=2,
            total_tokens=12,
            latency_ms=80.0,
        )

    with patch("app.services.benchmark.engine.execute_internal_inference", side_effect):
        run = runner.start_benchmark_run(req)
        await asyncio.sleep(0.1)

        completed_run = runner.get_run(run.id)
        assert completed_run.status == BenchmarkRunStatus.COMPLETED_WITH_ERRORS
        assert completed_run.progress.completed_items == 1
        assert completed_run.progress.failed_items == 1

        results = runner.storage.get_results(run.id)
        failed_res = next(r for r in results if r.model_id == "m1-failing")
        assert failed_res.status == "failed"
        assert "404" in failed_res.error_message


@pytest.mark.asyncio
async def test_benchmark_cancellation(temp_dirs):
    runner: BenchmarkRunner = temp_dirs["runner"]
    manifest_id = temp_dirs["manifest_id"]

    models = [
        BenchmarkModelConfig(
            model_id="m1",
            display_name="Slow Model",
            provider_type="ollama",
            execution_mode=ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
            provider_model_id="llama3.2:3b",
            base_url="http://localhost:11434/v1",
        )
    ]

    req = BenchmarkRunCreate(
        dataset_manifest_id=manifest_id,
        models=models,
        subset_size=3,
    )

    # Delay each mock inference call so cancellation triggers during run
    async def delayed_inference(*args, **kwargs):
        await asyncio.sleep(0.05)
        return InternalInferenceResult(success=True, output_text="ans")

    with patch("app.services.benchmark.engine.execute_internal_inference", delayed_inference):
        run = runner.start_benchmark_run(req)
        await asyncio.sleep(0.01)
        # Cancel active run
        cancelled = runner.cancel_run(run.id)
        assert cancelled is True

        await asyncio.sleep(0.1)
        final_run = runner.get_run(run.id)
        assert final_run.status == BenchmarkRunStatus.CANCELLED


def test_validation_rejects_humaneval_code_execution(temp_dirs):
    runner: BenchmarkRunner = temp_dirs["runner"]
    ds_storage = temp_dirs["ds_storage"]

    # Register a HumanEval dataset
    he_manifest = DatasetManifest(
        manifest_id="ds-humaneval-test-123",
        dataset_id="humaneval",
        dataset_name="HumanEval",
        task_type=TaskType.CODE_GENERATION,
        hf_repo_id="openai/openai_humaneval",
        source_url="https://hf.co/humaneval",
        source_revision="rev",
        license="MIT",
        license_verified=True,
        source_split="test",
        evaluation_role=EvaluationRole.HELD_OUT_TEST,
        imported_record_count=1,
        content_fingerprint="fp",
        storage_path="",
    )
    ds_storage.save_dataset(he_manifest, [])

    req = BenchmarkRunCreate(
        dataset_manifest_id="ds-humaneval-test-123",
        models=[
            BenchmarkModelConfig(
                model_id="m1",
                display_name="Model",
                provider_type="ollama",
                execution_mode=ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
                provider_model_id="llama3.2:3b",
                base_url="http://localhost:11434/v1",
            )
        ],
    )

    with pytest.raises(ValueError, match="HumanEval code execution requires an isolated execution sandbox"):
        runner.validate_run_request(req)


def test_validation_rejects_duplicate_models(temp_dirs):
    runner: BenchmarkRunner = temp_dirs["runner"]
    manifest_id = temp_dirs["manifest_id"]

    req = BenchmarkRunCreate(
        dataset_manifest_id=manifest_id,
        models=[
            BenchmarkModelConfig(
                model_id="same-id",
                display_name="Model 1",
                provider_type="ollama",
                execution_mode=ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
                provider_model_id="llama3.2:3b",
                base_url="http://localhost:11434/v1",
            ),
            BenchmarkModelConfig(
                model_id="same-id",
                display_name="Model 2",
                provider_type="ollama",
                execution_mode=ExecutionMode.LOCAL_OPENAI_COMPATIBLE,
                provider_model_id="llama3.2:3b",
                base_url="http://localhost:11434/v1",
            ),
        ],
    )

    with pytest.raises(ValueError, match="Duplicate model IDs detected"):
        runner.validate_run_request(req)


def test_validation_rejects_ssrf_urls(temp_dirs):
    runner: BenchmarkRunner = temp_dirs["runner"]
    manifest_id = temp_dirs["manifest_id"]

    req = BenchmarkRunCreate(
        dataset_manifest_id=manifest_id,
        models=[
            BenchmarkModelConfig(
                model_id="m1",
                display_name="Malicious Model",
                provider_type="openai",
                execution_mode=ExecutionMode.REMOTE_OPENAI_COMPATIBLE,
                provider_model_id="gpt-4o",
                base_url="http://169.254.169.254/latest/meta-data",  # Cloud metadata SSRF blocked!
            )
        ],
    )

    with pytest.raises(ValueError, match="Invalid base_url"):
        runner.validate_run_request(req)


def test_credentials_never_serialized(temp_dirs):
    models = [
        BenchmarkModelConfig(
            model_id="m1-hf",
            display_name="HF Model",
            provider_type="huggingface",
            execution_mode=ExecutionMode.HUGGINGFACE_INFERENCE_PROVIDERS,
            provider_model_id="Qwen/Qwen2.5-Coder-7B-Instruct",
            transient_credential="hf_super_secret_token_12345",  # SecretStr excluded
        )
    ]

    # Verify model_dump_json excludes credential
    cfg_json = models[0].model_dump_json()
    assert "hf_super_secret_token_12345" not in cfg_json
    assert "transient_credential" not in cfg_json
