"""Tests for GSM8K deterministic evaluation and scoring service (Milestone M4.2.2)."""
import pytest
from unittest.mock import patch, MagicMock
from app.schemas.evaluation import (
    BenchmarkRun,
    BenchmarkResult,
    BenchmarkModelConfig,
    BenchmarkGenerationSettings,
    BenchmarkRunProgress,
    BenchmarkRunStatus,
    EvaluationOutcome,
)
from app.schemas.dataset import TaskType
from app.schemas.usage import PricingSnapshot
from app.services.benchmark.evaluator import (
    clean_candidate_number,
    extract_gsm8k_model_answer,
    compare_gsm8k_answers,
    evaluate_gsm8k_result,
    calculate_benchmark_scores,
)
from app.services.benchmark.storage import BenchmarkStorageManager


def test_clean_candidate_number():
    assert clean_candidate_number("42") == "42"
    assert clean_candidate_number("  42  ") == "42"
    assert clean_candidate_number("$42") == "42"
    assert clean_candidate_number("$1,200.50") == "1200.50"
    assert clean_candidate_number("-15") == "-15"
    assert clean_candidate_number("-$10,000") == "-10000"
    assert clean_candidate_number("−$10,000") == "-10000"  # unicode minus
    assert clean_candidate_number("**42**") == "42"
    assert clean_candidate_number("42.") == "42"
    assert clean_candidate_number("abc") is None
    assert clean_candidate_number("") is None
    assert clean_candidate_number(None) is None


def test_extract_gsm8k_model_answer_explicit_markers():
    # Canonical ####
    ans, method = extract_gsm8k_model_answer("Step by step reasoning...\n#### 42")
    assert ans == "42"
    assert method == "gsm8k_hash"

    # With currency and comma
    ans, _ = extract_gsm8k_model_answer("Calculation complete.\n#### $1,250.00")
    assert ans == "1250.00"

    # LaTeX boxed
    ans, method = extract_gsm8k_model_answer("Therefore, \\boxed{3.14} is the answer.")
    assert ans == "3.14"
    assert method == "latex_boxed"

    # The final answer is
    ans, method = extract_gsm8k_model_answer("After multiplying, the final answer is 18.")
    assert ans == "18"
    assert method == "final_answer_phrase"

    ans, _ = extract_gsm8k_model_answer("Final Answer: $540")
    assert ans == "540"

    # Answer:
    ans, method = extract_gsm8k_model_answer("Reasoning...\nAnswer: 20")
    assert ans == "20"
    assert method == "answer_phrase"


def test_extract_gsm8k_model_answer_concluding_sentences():
    # Real output from llama3.2:3b
    text1 = "9 eggs * $2/egg = $18 \n\nSo, Janet makes $18 every day at the farmers' market."
    ans, method = extract_gsm8k_model_answer(text1)
    assert ans == "18"
    assert method == "concluding_statement"

    text2 = "180 meters/session x 3 sessions/week = 540 meters/week\n\nTherefore, James runs a total of 540 meters a week."
    ans, _ = extract_gsm8k_model_answer(text2)
    assert ans == "540"

    text3 = "Total cost = $40 + $24 = $64\n\nKylar needs to pay $64 for 16 glasses."
    ans, _ = extract_gsm8k_model_answer(text3)
    assert ans == "64"


def test_extract_gsm8k_model_answer_avoids_guessing_intermediate_numbers():
    # Ambiguous intermediate calculations without conclusion marker
    text = "She had 10 apples. She gave 3 to Bob, leaving 7. Then she found 5 more."
    ans, method = extract_gsm8k_model_answer(text)
    # Must NOT blindly return 10 or 5 or 7
    assert ans is None
    assert method is None


def test_extract_gsm8k_model_answer_empty_or_text_only():
    assert extract_gsm8k_model_answer("")[0] is None
    assert extract_gsm8k_model_answer("   \n  ")[0] is None
    assert extract_gsm8k_model_answer("I cannot solve this problem.")[0] is None


def test_compare_gsm8k_answers():
    assert compare_gsm8k_answers("18", "18") is True
    assert compare_gsm8k_answers("18.0", "18") is True
    assert compare_gsm8k_answers("18", "18.00") is True
    assert compare_gsm8k_answers("1,000", "1000") is True
    assert compare_gsm8k_answers("-10", "-10.0") is True
    assert compare_gsm8k_answers("18", "19") is False
    assert compare_gsm8k_answers(None, "18") is False
    assert compare_gsm8k_answers("18", None) is False


def test_evaluate_gsm8k_result_correct_and_incorrect():
    ref_meta = {"extracted_answer": "18", "raw_answer": "#### 18"}

    # Correct response
    res_correct = BenchmarkResult(
        id="res-1",
        run_id="run-1",
        dataset_manifest_id="ds-1",
        dataset_id="gsm8k",
        dataset_revision="rev1",
        source_split="test",
        record_id="rec-1",
        content_hash="hash1",
        model_id="mod-1",
        provider_model_id="llama3.2:3b",
        model_display_name="Llama 3.2 3B",
        status="success",
        prompt_text="Janet's ducks...",
        reference_answer="#### 18",
        reference_metadata=ref_meta,
        output_text="So, Janet makes $18 every day.",
        prompt_tokens=50,
        completion_tokens=60,
        total_tokens=110,
        latency_ms=1200.0,
        cost_usd=0.0001,
        pricing_snapshot=PricingSnapshot(input_price_per_million=1.0, output_price_per_million=2.0),
    )
    evaluated = evaluate_gsm8k_result(res_correct)
    assert evaluated.evaluation_status == EvaluationOutcome.CORRECT
    assert evaluated.score == 1.0
    assert evaluated.extracted_answer == "18"
    assert evaluated.evaluation_details["exact_match"] is True
    # Telemetry must remain unchanged
    assert evaluated.prompt_tokens == 50
    assert evaluated.completion_tokens == 60
    assert evaluated.latency_ms == 1200.0
    assert evaluated.cost_usd == 0.0001

    # Incorrect response
    res_incorrect = res_correct.model_copy(update={"output_text": "The final answer is 25."})
    evaluated_inc = evaluate_gsm8k_result(res_incorrect)
    assert evaluated_inc.evaluation_status == EvaluationOutcome.INCORRECT
    assert evaluated_inc.score == 0.0
    assert evaluated_inc.extracted_answer == "25"


def test_evaluate_gsm8k_result_unparseable_and_failed():
    ref_meta = {"extracted_answer": "18"}

    # Unparseable response (no answer marker, intermediate numbers)
    res_unparseable = BenchmarkResult(
        id="res-2",
        run_id="run-1",
        dataset_manifest_id="ds-1",
        dataset_id="gsm8k",
        dataset_revision="rev1",
        source_split="test",
        record_id="rec-2",
        content_hash="hash2",
        model_id="mod-1",
        provider_model_id="llama3.2:3b",
        model_display_name="Llama 3.2 3B",
        status="success",
        prompt_text="Question",
        reference_answer="#### 18",
        reference_metadata=ref_meta,
        output_text="16 - 3 is 13, and 13 - 4 is 9. Maybe 9 is nice.",
    )
    evaluated_unp = evaluate_gsm8k_result(res_unparseable)
    assert evaluated_unp.evaluation_status == EvaluationOutcome.UNPARSEABLE
    assert evaluated_unp.score == 0.0
    assert evaluated_unp.extracted_answer is None

    # Failed inference (timeout/network error)
    res_failed = BenchmarkResult(
        id="res-3",
        run_id="run-1",
        dataset_manifest_id="ds-1",
        dataset_id="gsm8k",
        dataset_revision="rev1",
        source_split="test",
        record_id="rec-3",
        content_hash="hash3",
        model_id="mod-1",
        provider_model_id="llama3.2:3b",
        model_display_name="Llama 3.2 3B",
        status="failed",
        error_category="timeout",
        error_message="Gateway timeout",
        prompt_text="Question",
        reference_answer="#### 18",
        reference_metadata=ref_meta,
        output_text=None,
    )
    evaluated_fail = evaluate_gsm8k_result(res_failed)
    # Must NOT count as incorrect; score must be None
    assert evaluated_fail.evaluation_status == EvaluationOutcome.FAILED
    assert evaluated_fail.score is None


def test_calculate_benchmark_scores_and_zero_denominators():
    model_cfg = BenchmarkModelConfig(
        model_id="mod-1",
        display_name="Llama 3.2 3B",
        provider_type="ollama",
        execution_mode="local_openai_compatible",
        provider_model_id="llama3.2:3b",
    )
    run = BenchmarkRun(
        id="run-test-metrics",
        dataset_manifest_id="ds-1",
        dataset_name="GSM8K",
        dataset_id="gsm8k",
        dataset_revision="rev1",
        source_split="test",
        task_type=TaskType.MATH_REASONING,
        model_ids=["mod-1"],
        model_configs=[model_cfg],
        status=BenchmarkRunStatus.COMPLETED,
        progress=BenchmarkRunProgress(total_items=3, completed_items=2, failed_items=1),
    )

    # 1 correct, 1 incorrect, 1 failed
    results = [
        BenchmarkResult(
            id="r1",
            run_id=run.id,
            dataset_manifest_id="ds-1",
            dataset_id="gsm8k",
            dataset_revision="rev1",
            source_split="test",
            record_id="rec-1",
            content_hash="h1",
            model_id="mod-1",
            provider_model_id="llama3.2:3b",
            model_display_name="Llama 3.2 3B",
            status="success",
            prompt_text="Q1",
            reference_answer="#### 10",
            reference_metadata={"extracted_answer": "10"},
            output_text="#### 10",
        ),
        BenchmarkResult(
            id="r2",
            run_id=run.id,
            dataset_manifest_id="ds-1",
            dataset_id="gsm8k",
            dataset_revision="rev1",
            source_split="test",
            record_id="rec-2",
            content_hash="h2",
            model_id="mod-1",
            provider_model_id="llama3.2:3b",
            model_display_name="Llama 3.2 3B",
            status="success",
            prompt_text="Q2",
            reference_answer="#### 20",
            reference_metadata={"extracted_answer": "20"},
            output_text="#### 99",
        ),
        BenchmarkResult(
            id="r3",
            run_id=run.id,
            dataset_manifest_id="ds-1",
            dataset_id="gsm8k",
            dataset_revision="rev1",
            source_split="test",
            record_id="rec-3",
            content_hash="h3",
            model_id="mod-1",
            provider_model_id="llama3.2:3b",
            model_display_name="Llama 3.2 3B",
            status="failed",
            error_message="timeout",
            prompt_text="Q3",
            reference_answer="#### 30",
            reference_metadata={"extracted_answer": "30"},
        ),
    ]

    updated_run, evaluated_results = calculate_benchmark_scores(run, results)
    summary = updated_run.results_summary
    assert summary["total_attempted"] == 3
    assert summary["total_correct"] == 1
    assert summary["total_incorrect"] == 1
    assert summary["total_failed"] == 1
    # Scorable accuracy = 1 / (1 + 1) = 0.5
    assert summary["scorable_accuracy"] == 0.5
    # End to end accuracy = 1 / 3 = 0.3333
    assert summary["end_to_end_accuracy"] == 0.3333

    m_metric = summary["model_metrics"]["mod-1"]
    assert m_metric["correct_answers"] == 1
    assert m_metric["incorrect_answers"] == 1
    assert m_metric["failed_requests"] == 1
    assert m_metric["scorable_accuracy"] == 0.5
    assert m_metric["end_to_end_accuracy"] == 0.3333


def test_zero_denominator_metrics_return_none():
    model_cfg = BenchmarkModelConfig(
        model_id="mod-1",
        display_name="Llama 3.2 3B",
        provider_type="ollama",
        execution_mode="local_openai_compatible",
        provider_model_id="llama3.2:3b",
    )
    run = BenchmarkRun(
        id="run-zero-den",
        dataset_manifest_id="ds-1",
        dataset_name="GSM8K",
        dataset_id="gsm8k",
        dataset_revision="rev1",
        source_split="test",
        task_type=TaskType.MATH_REASONING,
        model_ids=["mod-1"],
        model_configs=[model_cfg],
        status=BenchmarkRunStatus.FAILED,
    )
    # Only 1 failed request, 0 scorable answers
    results = [
        BenchmarkResult(
            id="r-fail",
            run_id=run.id,
            dataset_manifest_id="ds-1",
            dataset_id="gsm8k",
            dataset_revision="rev1",
            source_split="test",
            record_id="rec-1",
            content_hash="h1",
            model_id="mod-1",
            provider_model_id="llama3.2:3b",
            model_display_name="Llama 3.2 3B",
            status="failed",
            error_message="timeout",
            prompt_text="Q1",
            reference_answer="#### 10",
            reference_metadata={"extracted_answer": "10"},
        )
    ]
    updated_run, _ = calculate_benchmark_scores(run, results)
    summary = updated_run.results_summary
    # Scorable accuracy has zero denominator (0 correct + 0 incorrect) -> must be None!
    assert summary["scorable_accuracy"] is None
    # End-to-end accuracy is 0 / 1 = 0.0
    assert summary["end_to_end_accuracy"] == 0.0


def test_repeated_scoring_and_atomic_persistence(tmp_path):
    storage = BenchmarkStorageManager(storage_dir=str(tmp_path))
    model_cfg = BenchmarkModelConfig(
        model_id="mod-1",
        display_name="Llama 3.2 3B",
        provider_type="ollama",
        execution_mode="local_openai_compatible",
        provider_model_id="llama3.2:3b",
    )
    run = BenchmarkRun(
        id="run-repeat",
        dataset_manifest_id="ds-1",
        dataset_name="GSM8K",
        dataset_id="gsm8k",
        dataset_revision="rev1",
        source_split="test",
        task_type=TaskType.MATH_REASONING,
        model_ids=["mod-1"],
        model_configs=[model_cfg],
        status=BenchmarkRunStatus.COMPLETED,
    )
    results = [
        BenchmarkResult(
            id="res-1",
            run_id=run.id,
            dataset_manifest_id="ds-1",
            dataset_id="gsm8k",
            dataset_revision="rev1",
            source_split="test",
            record_id="rec-1",
            content_hash="h1",
            model_id="mod-1",
            provider_model_id="llama3.2:3b",
            model_display_name="Llama 3.2 3B",
            status="success",
            prompt_text="Q1",
            reference_answer="#### 42",
            reference_metadata={"extracted_answer": "42"},
            output_text="#### 42",
        )
    ]
    storage.save_run(run, results)

    # First scoring pass
    run_loaded = storage.get_run(run.id)
    results_loaded = storage.get_all_results(run.id)
    scored_run_1, scored_res_1 = calculate_benchmark_scores(run_loaded, results_loaded)
    storage.save_results_atomic(run.id, scored_res_1)
    storage.save_run(scored_run_1)

    assert scored_run_1.results_summary["total_correct"] == 1
    assert scored_res_1[0].evaluation_status == EvaluationOutcome.CORRECT

    # Second repeated scoring pass
    run_loaded_2 = storage.get_run(run.id)
    results_loaded_2 = storage.get_all_results(run.id)
    # Count of results must remain exactly 1 (no duplicate rows)
    assert len(results_loaded_2) == 1

    scored_run_2, scored_res_2 = calculate_benchmark_scores(run_loaded_2, results_loaded_2)
    storage.save_results_atomic(run.id, scored_res_2)
    storage.save_run(scored_run_2)

    assert scored_run_2.results_summary["total_correct"] == 1
    assert len(storage.get_all_results(run.id)) == 1


def test_scoring_never_calls_inference_provider():
    """Verify that scoring is strictly deterministic in-process and never invokes gateway adapters."""
    with patch("app.services.gateway.runner.execute_internal_inference") as mock_runner:
        model_cfg = BenchmarkModelConfig(
            model_id="mod-1",
            display_name="Llama 3.2 3B",
            provider_type="ollama",
            execution_mode="local_openai_compatible",
            provider_model_id="llama3.2:3b",
        )
        run = BenchmarkRun(
            id="run-no-inference",
            dataset_manifest_id="ds-1",
            dataset_name="GSM8K",
            dataset_id="gsm8k",
            dataset_revision="rev1",
            source_split="test",
            task_type=TaskType.MATH_REASONING,
            model_ids=["mod-1"],
            model_configs=[model_cfg],
            status=BenchmarkRunStatus.COMPLETED,
        )
        results = [
            BenchmarkResult(
                id="r1",
                run_id=run.id,
                dataset_manifest_id="ds-1",
                dataset_id="gsm8k",
                dataset_revision="rev1",
                source_split="test",
                record_id="rec-1",
                content_hash="h1",
                model_id="mod-1",
                provider_model_id="llama3.2:3b",
                model_display_name="Llama 3.2 3B",
                status="success",
                prompt_text="Q1",
                reference_answer="#### 5",
                reference_metadata={"extracted_answer": "5"},
                output_text="The answer is 5.",
            )
        ]
        calculate_benchmark_scores(run, results)
        # Mock must have 0 calls
        assert mock_runner.call_count == 0
