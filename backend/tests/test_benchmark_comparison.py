"""Tests for Milestone M4.2.3 — Model Comparison, Pareto Frontier, and Benchmark Export."""
import csv
import io
import json
import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from app.main import app
from app.schemas.evaluation import (
    BenchmarkRun,
    BenchmarkResult,
    BenchmarkModelConfig,
    BenchmarkGenerationSettings,
    BenchmarkRunProgress,
    BenchmarkRunStatus,
    EvaluationOutcome,
    ModelScoringSummary,
)
from app.schemas.dataset import TaskType
from app.schemas.usage import PricingSnapshot
from app.services.benchmark import (
    calculate_benchmark_scores,
    calculate_pareto_frontier,
    benchmark_storage,
    benchmark_runner,
)


@pytest.fixture
def api_client():
    return TestClient(app)


def test_pareto_frontier_calculation():
    """Verify Pareto dominance logic: lower cost and higher quality dominate."""
    # Model A: Cost $0.001, Quality 0.90 (Pareto efficient - highest quality)
    # Model B: Cost $0.0002, Quality 0.70 (Pareto efficient - lowest cost)
    # Model C: Cost $0.002, Quality 0.70 (Dominated by A and B)
    # Model D: Cost None (local/unknown), Quality 0.85 (Excluded from frontier)
    model_summaries = {
        "mod-a": ModelScoringSummary(
            model_id="mod-a",
            display_name="Model A",
            scorable_accuracy=0.90,
            cost_per_question_usd=0.001,
        ),
        "mod-b": ModelScoringSummary(
            model_id="mod-b",
            display_name="Model B",
            scorable_accuracy=0.70,
            cost_per_question_usd=0.0002,
        ),
        "mod-c": ModelScoringSummary(
            model_id="mod-c",
            display_name="Model C",
            scorable_accuracy=0.70,
            cost_per_question_usd=0.002,
        ),
        "mod-d": ModelScoringSummary(
            model_id="mod-d",
            display_name="Model D",
            scorable_accuracy=0.85,
            cost_per_question_usd=None,
        ),
    }

    pareto_map = calculate_pareto_frontier(model_summaries)
    assert pareto_map["mod-a"] is True
    assert pareto_map["mod-b"] is True
    assert pareto_map["mod-c"] is False  # Dominated
    assert pareto_map["mod-d"] is None  # Unknown cost


def test_multi_model_comparison_metrics_and_latencies():
    """Verify per-model aggregation: latency mean/median, tokens, costs, and provenance."""
    run = BenchmarkRun(
        id="run-compare-1",
        dataset_manifest_id="ds-test",
        dataset_name="GSM8K",
        dataset_id="gsm8k",
        dataset_revision="rev1",
        source_split="test",
        task_type=TaskType.MATH_REASONING,
        model_ids=["model-alpha", "model-beta"],
        model_configs=[
            BenchmarkModelConfig(
                model_id="model-alpha",
                display_name="Alpha 7B",
                provider_type="ollama",
                execution_mode="local_openai_compatible",
                provider_model_id="alpha:7b",
                pricing_source="free_local_hardware",
            ),
            BenchmarkModelConfig(
                model_id="model-beta",
                display_name="Beta Cloud",
                provider_type="openai",
                execution_mode="remote_openai_compatible",
                provider_model_id="beta-cloud",
                pricing_source="verified_catalog",
            ),
        ],
        status=BenchmarkRunStatus.COMPLETED,
    )

    results = [
        # Alpha result 1 (correct, latency 100ms)
        BenchmarkResult(
            id="r1",
            run_id="run-compare-1",
            dataset_manifest_id="ds-test",
            dataset_id="gsm8k",
            dataset_revision="rev1",
            source_split="test",
            record_id="rec-1",
            content_hash="h1",
            model_id="model-alpha",
            provider_model_id="alpha:7b",
            model_display_name="Alpha 7B",
            status="success",
            prompt_text="What is 5 + 7?",
            reference_answer="#### 12",
            reference_metadata={"extracted_answer": "12"},
            output_text="The answer is 12.\n#### 12",
            latency_ms=100.0,
            ttft_ms=30.0,
            prompt_tokens=10,
            completion_tokens=5,
            total_tokens=15,
            token_provenance="provider_reported",
            cost_usd=None,  # local unknown cost
        ),
        # Alpha result 2 (incorrect, latency 300ms)
        BenchmarkResult(
            id="r2",
            run_id="run-compare-1",
            dataset_manifest_id="ds-test",
            dataset_id="gsm8k",
            dataset_revision="rev1",
            source_split="test",
            record_id="rec-2",
            content_hash="h2",
            model_id="model-alpha",
            provider_model_id="alpha:7b",
            model_display_name="Alpha 7B",
            status="success",
            prompt_text="What is 3 * 4?",
            reference_answer="#### 12",
            reference_metadata={"extracted_answer": "12"},
            output_text="The answer is 15.\n#### 15",
            latency_ms=300.0,
            ttft_ms=50.0,
            prompt_tokens=10,
            completion_tokens=5,
            total_tokens=15,
            token_provenance="provider_reported",
            cost_usd=None,
        ),
        # Beta result 1 (correct, latency 500ms, known cost $0.0005)
        BenchmarkResult(
            id="r3",
            run_id="run-compare-1",
            dataset_manifest_id="ds-test",
            dataset_id="gsm8k",
            dataset_revision="rev1",
            source_split="test",
            record_id="rec-1",
            content_hash="h1",
            model_id="model-beta",
            provider_model_id="beta-cloud",
            model_display_name="Beta Cloud",
            status="success",
            prompt_text="What is 5 + 7?",
            reference_answer="#### 12",
            reference_metadata={"extracted_answer": "12"},
            output_text="5 + 7 = 12.\n#### 12",
            latency_ms=500.0,
            ttft_ms=120.0,
            prompt_tokens=10,
            completion_tokens=6,
            total_tokens=16,
            token_provenance="provider_reported",
            cost_usd=0.0005,
        ),
    ]

    scored_run, evaluated_results = calculate_benchmark_scores(run, results)

    metrics = scored_run.results_summary["model_metrics"]
    alpha = metrics["model-alpha"]
    beta = metrics["model-beta"]

    # Alpha checks
    assert alpha["attempted_questions"] == 2
    assert alpha["correct_answers"] == 1
    assert alpha["incorrect_answers"] == 1
    assert alpha["scorable_accuracy"] == 0.5
    assert alpha["avg_latency_ms"] == 200.0  # (100 + 300) / 2
    assert alpha["median_latency_ms"] == 200.0  # median(100, 300)
    assert alpha["avg_ttft_ms"] == 40.0
    assert alpha["total_tokens"] == 30
    assert alpha["token_provenance"] == "provider_reported"
    assert alpha["total_cost_usd"] is None
    assert alpha["unknown_cost_count"] == 2
    assert alpha["is_pareto_efficient"] is None  # Unknown cost excluded from frontier

    # Beta checks
    assert beta["attempted_questions"] == 1
    assert beta["correct_answers"] == 1
    assert beta["scorable_accuracy"] == 1.0
    assert beta["avg_latency_ms"] == 500.0
    assert beta["median_latency_ms"] == 500.0
    assert beta["total_cost_usd"] == 0.0005
    assert beta["cost_per_question_usd"] == 0.0005
    assert beta["unknown_cost_count"] == 0
    assert beta["is_pareto_efficient"] is True


def test_export_benchmark_run_json(api_client, tmp_path):
    """Test JSON export endpoint contains metadata, summary, and results without secrets."""
    run = BenchmarkRun(
        id="run-exp-json",
        dataset_manifest_id="ds-gsm8k",
        dataset_name="GSM8K",
        dataset_id="gsm8k",
        dataset_revision="abc1234",
        source_split="test",
        task_type=TaskType.MATH_REASONING,
        model_ids=["m1"],
        model_configs=[
            BenchmarkModelConfig(
                model_id="m1",
                display_name="Model One",
                provider_type="ollama",
                execution_mode="local_openai_compatible",
                provider_model_id="llama3.2:3b",
            )
        ],
        status=BenchmarkRunStatus.COMPLETED,
        results_summary={
            "total_attempted": 1,
            "total_correct": 1,
            "scorable_accuracy": 1.0,
            "model_metrics": {
                "m1": {
                    "display_name": "Model One",
                    "attempted_questions": 1,
                    "correct_answers": 1,
                    "scorable_accuracy": 1.0,
                }
            },
        },
    )
    result = BenchmarkResult(
        id="res-1",
        run_id="run-exp-json",
        dataset_manifest_id="ds-gsm8k",
        dataset_id="gsm8k",
        dataset_revision="abc1234",
        source_split="test",
        record_id="rec-1",
        content_hash="h1",
        model_id="m1",
        provider_model_id="llama3.2:3b",
        model_display_name="Model One",
        status="success",
        evaluation_status=EvaluationOutcome.CORRECT,
        score=1.0,
        prompt_text="What is 10 + 20?",
        reference_answer="30",
        output_text="The answer is 30.\n#### 30",
        latency_ms=250.0,
    )

    benchmark_storage.save_run(run)
    benchmark_storage.save_results_atomic(run.id, [result])
    benchmark_runner._active_runs[run.id] = run

    res = api_client.get(f"/api/benchmarks/runs/{run.id}/export?format=json")
    assert res.status_code == 200
    assert "attachment; filename=" in res.headers.get("Content-Disposition", "")
    data = res.json()

    assert data["report_type"] == "tokenpilot_benchmark_report"
    assert data["run_metadata"]["run_id"] == "run-exp-json"
    assert data["run_metadata"]["dataset_id"] == "gsm8k"
    assert len(data["model_configs"]) == 1
    assert data["model_configs"][0]["model_id"] == "m1"
    # Verify no secret fields present
    assert "transient_credential" not in str(data)
    assert len(data["results"]) == 1
    assert data["results"][0]["score"] == 1.0


def test_export_benchmark_run_csv(api_client):
    """Test CSV export endpoint formatting, section headers, and field escaping."""
    run_id = "run-exp-csv"
    run = BenchmarkRun(
        id=run_id,
        dataset_manifest_id="ds-gsm8k",
        dataset_name="GSM8K",
        dataset_id="gsm8k",
        dataset_revision="abc1234",
        source_split="test",
        task_type=TaskType.MATH_REASONING,
        model_ids=["m1"],
        model_configs=[
            BenchmarkModelConfig(
                model_id="m1",
                display_name="Model One, Pro",  # Includes comma to test escaping
                provider_type="ollama",
                execution_mode="local_openai_compatible",
                provider_model_id="llama3.2:3b",
            )
        ],
        status=BenchmarkRunStatus.COMPLETED,
        results_summary={
            "model_metrics": {
                "m1": {
                    "display_name": "Model One, Pro",
                    "attempted_questions": 1,
                    "correct_answers": 1,
                    "scorable_accuracy": 1.0,
                }
            }
        },
    )
    result = BenchmarkResult(
        id="res-csv-1",
        run_id=run_id,
        dataset_manifest_id="ds-gsm8k",
        dataset_id="gsm8k",
        dataset_revision="abc1234",
        source_split="test",
        record_id="rec-1",
        content_hash="h1",
        model_id="m1",
        provider_model_id="llama3.2:3b",
        model_display_name="Model One, Pro",
        status="success",
        evaluation_status=EvaluationOutcome.CORRECT,
        score=1.0,
        prompt_text="Line 1\nLine 2 with, commas and \"quotes\"",
        reference_answer="42",
        output_text="Result: 42\n#### 42",
        latency_ms=180.5,
    )

    benchmark_storage.save_run(run)
    benchmark_storage.save_results_atomic(run.id, [result])
    benchmark_runner._active_runs[run.id] = run

    res = api_client.get(f"/api/benchmarks/runs/{run_id}/export?format=csv")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert f'filename="benchmark_report_{run_id}.csv"' in res.headers["content-disposition"]

    # Parse CSV to confirm valid syntax and proper escaping
    reader = csv.reader(io.StringIO(res.text))
    rows = list(reader)
    assert len(rows) > 5

    # Check that model name with comma was parsed as a single column
    model_row = next((r for r in rows if len(r) > 1 and r[0] == "m1"), None)
    assert model_row is not None
    assert model_row[1] == "Model One, Pro"

    # Confirm secrets never exported
    assert "transient_credential" not in res.text


def test_export_benchmark_run_not_found(api_client):
    res = api_client.get("/api/benchmarks/runs/nonexistent-run-id/export?format=json")
    assert res.status_code == 404
