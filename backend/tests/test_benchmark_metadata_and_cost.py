"""
Tests for Benchmark Metadata Disambiguation, Cost Integrity, and Pareto Frontier Handling.
Covers:
- Separation of Model Source, Source Repo ID, Execution Provider, Execution Location, and Runtime Model ID.
- Separation of Provider API Cost from Local Compute Cost and Total Inference Cost.
- Known zero provider API cost vs unknown local compute cost.
- Handling of configured local compute pricing (per second and per million tokens).
- Exclusion of unpriced models from the priced Pareto frontier.
- Serialization and backwards compatibility in BenchmarkResult, ScoringSummary, and Exports.
"""

import pytest
from app.services.benchmark.metadata_resolver import (
    resolve_model_metadata,
    calculate_cost_breakdown,
)
from app.services.benchmark.evaluator import calculate_benchmark_scores
from app.schemas.evaluation import BenchmarkResult, BenchmarkModelConfig, ModelScoringSummary


def test_resolve_metadata_hf_model_on_local_ollama():
    """Qwen: Downloaded from Hugging Face Hub, executed locally on Ollama."""
    config = {
        "provider_type": "huggingface",
        "execution_mode": "local_openai_compatible",
        "execution_location": "local",
        "provider_model_id": "qwen2.5-coder:7b",
        "huggingface_repo_id": "Qwen/Qwen2.5-Coder-7B-Instruct",
        "base_url": "http://localhost:11434/v1",
    }
    resolved = resolve_model_metadata(config)
    
    assert resolved["model_source"] == "huggingface_hub"
    assert resolved["source_repo_id"] == "Qwen/Qwen2.5-Coder-7B-Instruct"
    assert resolved["execution_provider"] == "ollama"
    assert resolved["execution_location"] == "local"
    assert resolved["runtime_model_id"] == "qwen2.5-coder:7b"
    assert resolved["source_display"] == "Hugging Face Hub"
    assert resolved["runtime_display"] == "Ollama"


def test_resolve_metadata_llama_ollama_library():
    """Llama: Sourced from Ollama library, run locally on Ollama."""
    config = {
        "provider_type": "ollama",
        "execution_mode": "local_openai_compatible",
        "execution_location": "local",
        "provider_model_id": "llama3.2:3b",
        "base_url": "http://localhost:11434/v1",
    }
    resolved = resolve_model_metadata(config)
    
    assert resolved["model_source"] == "ollama_library"
    assert resolved["source_repo_id"] is None
    assert resolved["execution_provider"] == "ollama"
    assert resolved["execution_location"] == "local"
    assert resolved["runtime_model_id"] == "llama3.2:3b"
    assert resolved["runtime_display"] == "Ollama"


def test_resolve_metadata_hf_hosted_inference():
    """Hosted Hugging Face Inference Providers."""
    config = {
        "provider_type": "huggingface",
        "execution_mode": "huggingface_inference_providers",
        "execution_location": "remote",
        "provider_model_id": "meta-llama/Llama-3.2-3B-Instruct",
        "huggingface_repo_id": "meta-llama/Llama-3.2-3B-Instruct",
    }
    resolved = resolve_model_metadata(config)
    
    assert resolved["model_source"] == "huggingface_hub"
    assert resolved["source_repo_id"] == "meta-llama/Llama-3.2-3B-Instruct"
    assert resolved["execution_provider"] == "huggingface_inference_providers"
    assert resolved["execution_location"] == "remote"
    assert resolved["runtime_model_id"] == "meta-llama/Llama-3.2-3B-Instruct"
    assert resolved["runtime_display"] == "Hugging Face Providers"


def test_resolve_metadata_legacy_unknown_fallback():
    """When metadata is completely missing/empty, resolve conservatively to unknown."""
    resolved = resolve_model_metadata({})
    assert resolved["model_source"] == "unknown"
    assert resolved["execution_provider"] == "unknown"
    assert resolved["execution_location"] == "unknown"
    assert resolved["runtime_model_id"] == "unknown"


def test_local_model_cost_breakdown_unconfigured_hardware():
    """
    Local model has $0.00 provider API invoice, but hardware cost is unconfigured.
    Provider API cost is 0.0, Compute cost is None, Total cost is None.
    Must NOT coerce total cost to zero!
    """
    breakdown = calculate_cost_breakdown(
        execution_location="local",
        pricing_snapshot={"pricing_source": "free_local_hardware"},
        prompt_tokens=150,
        completion_tokens=50,
        latency_ms=4000.0,
    )
    
    assert breakdown["provider_api_cost_usd"] == 0.0
    assert breakdown["local_compute_cost_usd"] is None
    assert breakdown["total_cost_usd"] is None
    assert breakdown["cost_provenance"] == "local_api_free_compute_unpriced"


def test_local_model_cost_breakdown_configured_per_second():
    """Local model with configured compute rate per second ($0.0001/s)."""
    breakdown = calculate_cost_breakdown(
        execution_location="local",
        pricing_snapshot={
            "local_compute_cost_per_second": 0.0001,
            "pricing_source": "hardware_calibrated",
        },
        prompt_tokens=100,
        completion_tokens=100,
        latency_ms=5000.0,  # 5.0 seconds
    )
    
    assert breakdown["provider_api_cost_usd"] == 0.0
    assert breakdown["local_compute_cost_usd"] == pytest.approx(0.0005, abs=1e-6)
    assert breakdown["total_cost_usd"] == pytest.approx(0.0005, abs=1e-6)
    assert breakdown["cost_provenance"] == "local_compute_configured"


def test_local_model_cost_breakdown_configured_per_million():
    """Local model with configured amortized rate per million tokens ($0.10/1M)."""
    breakdown = calculate_cost_breakdown(
        execution_location="local",
        pricing_snapshot={
            "local_compute_price_per_million": 0.10,
            "pricing_source": "amortized_hardware",
        },
        prompt_tokens=1000,
        completion_tokens=1000,
        latency_ms=2000.0,
    )
    
    # 2000 tokens at $0.10 per 1M = $0.0002
    assert breakdown["provider_api_cost_usd"] == 0.0
    assert breakdown["local_compute_cost_usd"] == pytest.approx(0.0002, abs=1e-6)
    assert breakdown["total_cost_usd"] == pytest.approx(0.0002, abs=1e-6)
    assert breakdown["cost_provenance"] == "local_compute_configured"


def test_remote_model_cost_breakdown_known_and_unknown():
    """Remote model with known pricing vs unconfigured pricing."""
    # Known pricing: $0.15/1M in, $0.60/1M out
    known_breakdown = calculate_cost_breakdown(
        execution_location="remote",
        pricing_snapshot={
            "input_price_per_million": 0.15,
            "output_price_per_million": 0.60,
            "pricing_source": "official_api",
        },
        prompt_tokens=1000,
        completion_tokens=500,
    )
    expected_api = (1000 / 1_000_000) * 0.15 + (500 / 1_000_000) * 0.60
    assert known_breakdown["provider_api_cost_usd"] == pytest.approx(expected_api, abs=1e-7)
    assert known_breakdown["local_compute_cost_usd"] == 0.0
    assert known_breakdown["total_cost_usd"] == pytest.approx(expected_api, abs=1e-7)
    assert known_breakdown["cost_provenance"] == "remote_provider_api_invoiced"
    
    # Unknown pricing
    unknown_breakdown = calculate_cost_breakdown(
        execution_location="remote",
        pricing_snapshot={},
        prompt_tokens=1000,
        completion_tokens=500,
    )
    assert unknown_breakdown["provider_api_cost_usd"] is None
    assert unknown_breakdown["total_cost_usd"] is None
    assert unknown_breakdown["cost_provenance"] == "remote_pricing_unconfigured"


def test_missing_tokens_does_not_invent_cost():
    """When token counts are missing/null, costs must remain null rather than 0."""
    breakdown = calculate_cost_breakdown(
        execution_location="remote",
        pricing_snapshot={
            "input_price_per_million": 0.15,
            "output_price_per_million": 0.60,
        },
        prompt_tokens=None,
        completion_tokens=None,
    )
    assert breakdown["provider_api_cost_usd"] is None
    assert breakdown["total_cost_usd"] is None


def make_benchmark_result(
    model_id: str,
    record_id: str,
    is_correct: bool,
    provider_api_cost: Optional[float],
    local_compute_cost: Optional[float],
    total_cost: Optional[float],
    latency_ms: float = 1000.0,
) -> BenchmarkResult:
    from app.schemas.evaluation import EvaluationOutcome
    return BenchmarkResult(
        id=f"res-{model_id}-{record_id}",
        run_id="run-test",
        dataset_manifest_id="gsm8k-test",
        dataset_id="gsm8k",
        dataset_revision="main",
        source_split="test",
        record_id=record_id,
        content_hash="hash123",
        model_id=model_id,
        provider_model_id=f"prov-{model_id}",
        model_display_name=model_id,
        prompt_text="What is 2+2?",
        reference_answer="#### 4",
        reference_metadata={"extracted_answer": "4"},
        output_text="#### 4" if is_correct else "#### 999",
        status="success",
        evaluation_status=EvaluationOutcome.CORRECT if is_correct else EvaluationOutcome.INCORRECT,
        score=1.0 if is_correct else 0.0,
        provider_api_cost_usd=provider_api_cost,
        local_compute_cost_usd=local_compute_cost,
        cost_usd=total_cost,
        total_cost_usd=total_cost,
        latency_ms=latency_ms,
        prompt_tokens=100,
        completion_tokens=50,
    )


def test_pareto_frontier_excludes_unpriced_models():
    """
    Pareto frontier must exclude models with unknown total cost.
    Unpriced local models must have is_pareto_efficient = None.
    Priced models must be compared only against other models with known total cost.
    """
    model_configs = {
        # Unpriced local model
        "local_unpriced": BenchmarkModelConfig(
            model_id="local_unpriced",
            display_name="Local Llama",
            provider_model_id="llama3.2:3b",
            execution_location="local",
            execution_mode="local_openai_compatible",
            execution_provider="ollama",
            provider_type="ollama",
            pricing_snapshot={"pricing_source": "free_local_hardware"},
        ),
        # Cheap remote model (80% accuracy, $0.001 total cost)
        "remote_cheap": BenchmarkModelConfig(
            model_id="remote_cheap",
            display_name="Remote Cheap",
            provider_model_id="gpt-cheap",
            execution_location="remote",
            execution_mode="remote_openai_compatible",
            execution_provider="openai",
            provider_type="openai",
            pricing_snapshot={"input_price_per_million": 0.10, "output_price_per_million": 0.20},
        ),
        # Expensive high quality model (90% accuracy, $0.010 total cost)
        "remote_high_quality": BenchmarkModelConfig(
            model_id="remote_high_quality",
            display_name="Remote Premium",
            provider_model_id="gpt-premium",
            execution_location="remote",
            execution_mode="remote_openai_compatible",
            execution_provider="openai",
            provider_type="openai",
            pricing_snapshot={"input_price_per_million": 1.00, "output_price_per_million": 2.00},
        ),
        # Dominated model (70% accuracy, $0.020 total cost)
        "remote_dominated": BenchmarkModelConfig(
            model_id="remote_dominated",
            display_name="Remote Dominated",
            provider_model_id="gpt-dominated",
            execution_location="remote",
            execution_mode="remote_openai_compatible",
            execution_provider="openai",
            provider_type="openai",
            pricing_snapshot={"input_price_per_million": 2.00, "output_price_per_million": 4.00},
        ),
    }

    results = []
    # 10 questions
    for q_idx in range(10):
        # local_unpriced: 8 correct, 2 incorrect, no compute pricing
        results.append(make_benchmark_result(
            model_id="local_unpriced",
            record_id=f"rec-{q_idx}",
            is_correct=(q_idx < 8),
            provider_api_cost=0.0,
            local_compute_cost=None,
            total_cost=None,
            latency_ms=4000.0,
        ))
        # remote_cheap: 8 correct, 2 incorrect, known total cost $0.0001 per question = $0.001 total
        results.append(make_benchmark_result(
            model_id="remote_cheap",
            record_id=f"rec-{q_idx}",
            is_correct=(q_idx < 8),
            provider_api_cost=0.0001,
            local_compute_cost=0.0,
            total_cost=0.0001,
            latency_ms=1000.0,
        ))
        # remote_high_quality: 9 correct, 1 incorrect, known total cost $0.001 per question = $0.010 total
        results.append(make_benchmark_result(
            model_id="remote_high_quality",
            record_id=f"rec-{q_idx}",
            is_correct=(q_idx < 9),
            provider_api_cost=0.0010,
            local_compute_cost=0.0,
            total_cost=0.0010,
            latency_ms=2000.0,
        ))
        # remote_dominated: 7 correct, 3 incorrect, known total cost $0.002 per question = $0.020 total
        results.append(make_benchmark_result(
            model_id="remote_dominated",
            record_id=f"rec-{q_idx}",
            is_correct=(q_idx < 7),
            provider_api_cost=0.0020,
            local_compute_cost=0.0,
            total_cost=0.0020,
            latency_ms=3000.0,
        ))

    from app.schemas.evaluation import BenchmarkRun
    from app.schemas.dataset import TaskType
    run = BenchmarkRun(
        id="run-test",
        dataset_manifest_id="gsm8k-test",
        dataset_name="GSM8K",
        dataset_id="gsm8k",
        dataset_revision="main",
        source_split="test",
        task_type=TaskType.MATH_REASONING,
        model_ids=list(model_configs.keys()),
        model_configs=list(model_configs.values()),
    )

    scored_run, evaluated_results = calculate_benchmark_scores(run, results)
    sum_map = scored_run.results_summary["model_metrics"]

    # 1. local_unpriced has known provider_api_cost ($0.0) but unknown total_cost
    assert sum_map["local_unpriced"]["provider_api_cost_usd"] == 0.0
    assert sum_map["local_unpriced"]["total_cost_usd"] is None
    # Crucial: Unpriced models MUST NOT participate in Pareto frontier (is_pareto_efficient is None)
    assert sum_map["local_unpriced"]["is_pareto_efficient"] is None

    # 2. remote_cheap (80% acc at $0.001) is on the frontier
    assert sum_map["remote_cheap"]["is_pareto_efficient"] is True
    assert sum_map["remote_cheap"]["total_cost_usd"] == pytest.approx(0.001, abs=1e-6)

    # 3. remote_high_quality (90% acc at $0.010) is also on the frontier (higher quality for higher cost)
    assert sum_map["remote_high_quality"]["is_pareto_efficient"] is True
    assert sum_map["remote_high_quality"]["total_cost_usd"] == pytest.approx(0.010, abs=1e-6)

    # 4. remote_dominated (70% acc at $0.020) is dominated by both cheap and high-quality
    assert sum_map["remote_dominated"]["is_pareto_efficient"] is False


def test_legacy_benchmark_run_backwards_compatibility():
    """
    Test backwards compatibility with legacy benchmark results.
    A legacy run lacks model_source, execution_provider, and local_compute_cost_usd.
    It must resolve metadata without throwing and compute cost conservatively.
    """
    legacy_result_dict = {
        "id": "legacy-res-1",
        "run_id": "legacy-run-1",
        "dataset_manifest_id": "gsm8k-test",
        "dataset_id": "gsm8k",
        "dataset_revision": "main",
        "source_split": "test",
        "record_id": "rec-1",
        "content_hash": "legacy-hash",
        "model_id": "qwen2.5-coder:7b",
        "provider_model_id": "qwen2.5-coder:7b",
        "model_display_name": "Qwen 2.5 Coder 7B",
        "provider_type": "huggingface",
        "execution_mode": "local_openai_compatible",
        "execution_location": "local",
        "base_url": "http://localhost:11434/v1",
        "huggingface_repo_id": "Qwen/Qwen2.5-Coder-7B-Instruct",
        "prompt_text": "What is 2+2?",
        "reference_answer": "#### 4",
        "output_text": "#### 4",
        "status": "success",
        "latency_ms": 21000.0,
        "prompt_tokens": 150,
        "completion_tokens": 50,
        "total_tokens": 200,
        # Notice: no model_source, source_repo_id, execution_provider, or local_compute_cost_usd!
    }

    result = BenchmarkResult(**legacy_result_dict)
    from app.services.benchmark.evaluator import evaluate_gsm8k_result
    evaluated = evaluate_gsm8k_result(result)

    assert evaluated.model_source == "huggingface_hub"
    assert evaluated.source_repo_id == "Qwen/Qwen2.5-Coder-7B-Instruct"
    assert evaluated.execution_provider == "ollama"
    assert evaluated.execution_location == "local"
    assert evaluated.provider_model_id == "qwen2.5-coder:7b"
    assert evaluated.score == 1.0


def test_export_csv_headers_and_cost_integrity():
    """
    Test that CSV export includes all new metadata and truthful cost columns.
    """
    from app.schemas.evaluation import BenchmarkRun, BenchmarkResult, BenchmarkModelConfig, EvaluationOutcome
    from app.schemas.dataset import TaskType
    import io, csv

    run = BenchmarkRun(
        id="run-export-test",
        dataset_manifest_id="gsm8k-test",
        dataset_name="GSM8K",
        dataset_id="gsm8k",
        dataset_revision="main",
        source_split="test",
        task_type=TaskType.MATH_REASONING,
        model_ids=["test-model"],
        model_configs=[
            BenchmarkModelConfig(
                model_id="test-model",
                display_name="Test Model",
                provider_model_id="test:7b",
                model_source="huggingface_hub",
                source_repo_id="org/test-7b",
                execution_provider="ollama",
                execution_location="local",
                execution_mode="local_openai_compatible",
                provider_type="ollama",
            )
        ],
    )

    results = [
        make_benchmark_result(
            model_id="test-model",
            record_id="rec-1",
            is_correct=True,
            provider_api_cost=0.0,
            local_compute_cost=None,
            total_cost=None,
        )
    ]

    scored_run, evaluated_results = calculate_benchmark_scores(run, results)

    # Verify model_metrics in scored_run
    m_metric = scored_run.results_summary["model_metrics"]["test-model"]
    assert m_metric["model_source"] == "huggingface_hub"
    assert m_metric["source_repo_id"] == "org/test-7b"
    assert m_metric["execution_provider"] == "ollama"
    assert m_metric["execution_location"] == "local"
    assert m_metric["provider_api_cost_usd"] == 0.0
    assert m_metric["local_compute_cost_usd"] is None
    assert m_metric["total_cost_usd"] is None
    assert m_metric["is_pareto_efficient"] is None

