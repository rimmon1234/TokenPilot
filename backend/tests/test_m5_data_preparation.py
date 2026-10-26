"""
Tests for M5 Supervised ML Quality Predictor Data Preparation.
Validates:
- Split discipline (train split vs held-out test split).
- Deterministic prompt-group partitioning without prompt leakage.
- Truthful cost and evaluation target representation in pilot records.
- Secret prevention and data sanitization.
"""

import pytest
from app.schemas.evaluation import BenchmarkResult, EvaluationOutcome, BenchmarkRun
from app.schemas.dataset import TaskType
from app.services.benchmark.m5_collector import (
    M5PilotRecord,
    build_m5_pilot_record,
    partition_m5_records_by_prompt,
)


def make_mock_result(
    record_id: str,
    model_id: str,
    status: str = "success",
    eval_status: EvaluationOutcome = EvaluationOutcome.CORRECT,
    total_cost: float = None,
    provider_api_cost: float = 0.0,
    latency_ms: float = 1200.0,
) -> BenchmarkResult:
    return BenchmarkResult(
        id=f"res-{model_id}-{record_id}",
        run_id="run-m5-pilot-test",
        dataset_manifest_id="ds-gsm8k-train-sub25",
        dataset_id="gsm8k",
        dataset_revision="740312add88f781978c0658806c59bc2815b9866",
        source_split="train",
        record_id=record_id,
        content_hash="mock-hash",
        model_id=model_id,
        provider_model_id=model_id,
        model_display_name=model_id,
        model_source="ollama_library" if "llama" in model_id else "huggingface_hub",
        execution_provider="ollama",
        execution_location="local",
        status=status,
        evaluation_status=eval_status,
        prompt_text="A farmer has 15 cows and buys 10 more. How many cows does he have in total?",
        reference_answer="#### 25",
        output_text="#### 25" if eval_status == EvaluationOutcome.CORRECT else "#### 999",
        latency_ms=latency_ms,
        prompt_tokens=30,
        completion_tokens=15,
        total_tokens=45,
        token_provenance="provider_reported",
        provider_api_cost_usd=provider_api_cost,
        local_compute_cost_usd=None,
        cost_usd=total_cost,
        total_cost_usd=total_cost,
    )


def test_m5_record_builder_integrity_correct_answer():
    """Correct answer should have quality_score=1.0 and is_correct=True."""
    res = make_mock_result("rec-1", "llama3.2:3b", eval_status=EvaluationOutcome.CORRECT)
    record = build_m5_pilot_record(res)
    
    assert record.prompt_id == "rec-1"
    assert record.model_id == "llama3.2:3b"
    assert record.source_split == "train"
    assert record.evaluation_status == "correct"
    assert record.quality_score == 1.0
    assert record.is_correct is True
    assert record.prompt_char_length > 0
    assert record.prompt_word_count > 0
    # Truthful cost: local unpriced compute must NOT be coerced to 0.0!
    assert record.provider_api_cost_usd == 0.0
    assert record.total_cost_usd is None


def test_m5_record_builder_unparseable_never_marked_correct():
    """Unparseable response must NEVER be marked as correct (quality_score=0.0, is_correct=False)."""
    res = make_mock_result("rec-2", "qwen2.5-coder:7b", eval_status=EvaluationOutcome.UNPARSEABLE)
    record = build_m5_pilot_record(res)
    
    assert record.evaluation_status == "unparseable"
    assert record.quality_score == 0.0
    assert record.is_correct is False


def test_m5_record_builder_failed_request_not_reasoning_error():
    """
    Failed inference request (e.g. timeout, connection error) must NOT be treated
    as a mathematical reasoning failure. quality_score and is_correct must be None.
    """
    res = make_mock_result("rec-3", "llama3.2:3b", status="failed", eval_status=EvaluationOutcome.FAILED)
    record = build_m5_pilot_record(res)
    
    assert record.request_status == "failed"
    assert record.evaluation_status == "failed"
    assert record.quality_score is None
    assert record.is_correct is None


def test_m5_prompt_group_partition_zero_leakage():
    """
    Test deterministic Group-K partition by prompt_id.
    Ensures that ALL candidate model records for prompt X reside in the same partition.
    Strictly asserts zero prompt leakage between training and validation sets.
    """
    models = ["llama3.2:3b", "qwen2.5-coder:7b", "gemini-flash"]
    records = []
    
    # Generate records for 25 distinct prompts across 3 models = 75 samples
    for p_idx in range(25):
        prompt_id = f"prompt-{p_idx:03d}"
        for model in models:
            records.append(
                build_m5_pilot_record(
                    make_mock_result(
                        record_id=prompt_id,
                        model_id=model,
                        eval_status=EvaluationOutcome.CORRECT if p_idx % 2 == 0 else EvaluationOutcome.INCORRECT,
                    )
                )
            )

    assert len(records) == 75

    # Partition with 80% train / 20% validation
    train_records, val_records = partition_m5_records_by_prompt(
        records, train_ratio=0.8, seed=42
    )

    train_prompt_ids = set(r.prompt_id for r in train_records)
    val_prompt_ids = set(r.prompt_id for r in val_records)

    # 1. Zero leakage: no prompt in train appears in val
    assert len(train_prompt_ids.intersection(val_prompt_ids)) == 0
    assert len(train_prompt_ids) + len(val_prompt_ids) == 25
    assert len(train_prompt_ids) == 20  # 80% of 25 = 20
    assert len(val_prompt_ids) == 5    # 20% of 25 = 5

    # 2. Total record count matches
    assert len(train_records) == 20 * 3  # 60
    assert len(val_records) == 5 * 3     # 15

    # 3. For every prompt in train, all 3 model records are in train
    for p_id in train_prompt_ids:
        p_models = set(r.model_id for r in train_records if r.prompt_id == p_id)
        assert p_models == set(models)

    # 4. For every prompt in val, all 3 model records are in val
    for p_id in val_prompt_ids:
        p_models = set(r.model_id for r in val_records if r.prompt_id == p_id)
        assert p_models == set(models)


def test_m5_record_rejects_secret_bearing_prompts():
    """Assert that secret-bearing prompts trigger validation errors."""
    with pytest.raises(ValueError, match="Secret-bearing text detected"):
        M5PilotRecord(
            sample_id="test-sec-1",
            prompt_id="p-1",
            record_id="p-1",
            dataset_id="gsm8k",
            dataset_revision="rev1",
            source_split="train",
            evaluation_role="dev_train",
            model_id="m1",
            model_source="ollama_library",
            execution_provider="ollama",
            execution_location="local",
            runtime_model_id="m1",
            prompt_text="Here is my API_KEY=AIzaSyD-1234567890abcdefghijklmnopqrstuvw and prompt",
            prompt_char_length=50,
            prompt_word_count=5,
            reference_answer="4",
            evaluation_status="correct",
            request_status="success",
        )
