"""
M5 Pilot Training Data Preparation and Validation Module.
Provides reproducible data structures, validation rules, and prompt-group partitioning
for training the supervised ML model quality router.
Zero secrets, zero prompt leakage, truthful cost representation.
"""

import hashlib
import random
import re
from typing import Dict, List, Optional, Tuple, Any
from pydantic import BaseModel, Field, field_validator
from app.schemas.evaluation import BenchmarkResult, BenchmarkRun, EvaluationOutcome


class M5PilotRecord(BaseModel):
    """
    Canonical record for ML model quality predictor training and evaluation.
    Represents a single (prompt, candidate_model) evaluation sample.
    """
    sample_id: str = Field(..., description="Unique deterministic sample identifier.")
    prompt_id: str = Field(..., description="Prompt identifier (all model results for this prompt share this ID).")
    record_id: str = Field(..., description="Original dataset record identifier.")
    dataset_id: str = Field(..., description="Upstream dataset identifier (e.g. gsm8k).")
    dataset_revision: str = Field(..., description="Pinned Git commit SHA.")
    source_split: str = Field(..., description="Upstream split name (must be 'train' for M5 dev collection).")
    evaluation_role: str = Field(..., description="Role discipline: dev_train or validation.")
    
    # Model provenance
    model_id: str = Field(..., description="Workspace model identifier.")
    model_source: str = Field(..., description="Origin e.g. huggingface_hub, ollama_library.")
    source_repo_id: Optional[str] = Field(None, description="Original repo identifier.")
    execution_provider: str = Field(..., description="Execution runtime e.g. ollama, openai, gemini.")
    execution_location: str = Field(..., description="local or remote.")
    runtime_model_id: str = Field(..., description="Provider model ID sent to runtime.")
    
    # Prompt / task features
    prompt_text: str = Field(..., description="Input prompt text presented to candidate model.")
    prompt_char_length: int = Field(..., description="Number of characters in prompt.")
    prompt_word_count: int = Field(..., description="Number of words in prompt.")
    
    # Generation parameters
    temperature: float = Field(default=0.0)
    max_tokens: Optional[int] = Field(default=None)
    
    # Output and evaluation
    output_text: Optional[str] = Field(None, description="Model generated response.")
    extracted_answer: Optional[str] = Field(None, description="Extracted numerical answer.")
    reference_answer: str = Field(..., description="Ground truth canonical answer.")
    evaluation_status: str = Field(..., description="Outcome: correct, incorrect, unparseable, failed.")
    quality_score: Optional[float] = Field(
        None,
        description="1.0 for correct, 0.0 for incorrect or unparseable, None for failed requests."
    )
    is_correct: Optional[bool] = Field(
        None,
        description="True for correct, False for incorrect or unparseable, None for failed requests."
    )
    
    # Telemetry
    latency_ms: float = Field(default=0.0)
    ttft_ms: Optional[float] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    token_provenance: str = Field(default="unavailable")
    
    # Cost breakdown & provenance
    provider_api_cost_usd: Optional[float] = None
    local_compute_cost_usd: Optional[float] = None
    total_cost_usd: Optional[float] = Field(
        None,
        description="Total estimated inference cost. Strictly None if compute cost is unconfigured."
    )
    cost_provenance: str = Field(default="unknown")
    
    # Request lifecycle
    request_status: str = Field(..., description="success, failed, or timeout.")
    error_category: Optional[str] = None
    dataset_pilot_label: str = Field(
        default="m5_supervised_pilot_v1",
        description="Explicit experiment tagging."
    )

    @field_validator("prompt_text")
    def validate_no_secrets(cls, v: str) -> str:
        secret_patterns = [
            r"(?i)api[_-]?key",
            r"(?i)bearer\s+[a-zA-Z0-9_\-\.]{15,}",
            r"hf_[a-zA-Z0-9]{20,}",
            r"AIza[0-9A-Za-z-_]{35}",
        ]
        for pat in secret_patterns:
            if re.search(pat, v):
                raise ValueError("Secret-bearing text detected in prompt_text.")
        return v


def build_m5_pilot_record(
    result: BenchmarkResult,
    run: Optional[BenchmarkRun] = None,
) -> M5PilotRecord:
    """
    Transform a BenchmarkResult into a sanitized M5PilotRecord with strict integrity checks.
    Guarantees:
    - Unparseable answers are never scored as correct.
    - Failed requests are not treated as math reasoning errors (quality_score=None).
    - Unknown costs remain None and are never coerced to zero.
    - Prompt length features are extracted deterministically.
    """
    # 1. Quality score and correctness target mapping
    eval_status = str(result.evaluation_status.value if hasattr(result.evaluation_status, "value") else result.evaluation_status)
    
    if result.status != "success" or eval_status == "failed":
        # Failed requests must not be treated as reasoning errors
        quality_score = None
        is_correct = None
        eval_status = "failed"
    elif eval_status == "unparseable":
        # Unparseable answers must never be treated as correct
        quality_score = 0.0
        is_correct = False
    elif eval_status == "correct":
        quality_score = 1.0
        is_correct = True
    elif eval_status == "incorrect":
        quality_score = 0.0
        is_correct = False
    else:
        quality_score = None
        is_correct = None

    # 2. Text feature extraction
    prompt = result.prompt_text or ""
    prompt_char_length = len(prompt)
    prompt_word_count = len(prompt.split())

    # 3. Generation settings snapshot
    temperature = 0.0
    max_tokens = None
    if run and run.generation_settings:
        temperature = run.generation_settings.temperature
        max_tokens = run.generation_settings.max_tokens

    # 4. Deterministic sample ID
    sample_id = f"m5-{result.dataset_id}-{result.record_id}-{result.model_id}"

    return M5PilotRecord(
        sample_id=sample_id,
        prompt_id=result.record_id,
        record_id=result.record_id,
        dataset_id=result.dataset_id,
        dataset_revision=result.dataset_revision,
        source_split=result.source_split,
        evaluation_role="dev_train",
        model_id=result.model_id,
        model_source=result.model_source or "unknown",
        source_repo_id=result.source_repo_id,
        execution_provider=result.execution_provider or "unknown",
        execution_location=result.execution_location or "unknown",
        runtime_model_id=result.provider_model_id,
        prompt_text=prompt,
        prompt_char_length=prompt_char_length,
        prompt_word_count=prompt_word_count,
        temperature=temperature,
        max_tokens=max_tokens,
        output_text=result.output_text,
        extracted_answer=result.extracted_answer,
        reference_answer=result.reference_answer,
        evaluation_status=eval_status,
        quality_score=quality_score,
        is_correct=is_correct,
        latency_ms=result.latency_ms,
        ttft_ms=result.ttft_ms,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
        token_provenance=result.token_provenance,
        provider_api_cost_usd=result.provider_api_cost_usd,
        local_compute_cost_usd=result.local_compute_cost_usd,
        total_cost_usd=result.total_cost_usd if result.total_cost_usd is not None else result.cost_usd,
        cost_provenance=getattr(result, "cost_provenance", "unknown"),
        request_status=result.status,
        error_category=result.error_category,
    )


def partition_m5_records_by_prompt(
    records: List[M5PilotRecord],
    train_ratio: float = 0.8,
    seed: int = 42,
) -> Tuple[List[M5PilotRecord], List[M5PilotRecord]]:
    """
    Deterministic Group-K partition by prompt_id.
    Guarantees that all candidate model records for the same prompt reside in the same partition.
    Strictly prevents prompt leakage between training and validation.
    """
    if not records:
        return [], []

    # 1. Identify all distinct prompt IDs in stable order
    prompt_ids = sorted(list({r.prompt_id for r in records}))
    
    # 2. Deterministic shuffle using pinned seed
    rng = random.Random(seed)
    shuffled_prompts = list(prompt_ids)
    rng.shuffle(shuffled_prompts)

    # 3. Split prompt IDs
    cutoff = max(1, int(len(shuffled_prompts) * train_ratio))
    train_prompts = set(shuffled_prompts[:cutoff])
    val_prompts = set(shuffled_prompts[cutoff:])

    # 4. Group records according to prompt assignment
    train_records = [r for r in records if r.prompt_id in train_prompts]
    val_records = [r for r in records if r.prompt_id in val_prompts]

    # Verify zero overlap
    overlap = set(r.prompt_id for r in train_records).intersection(
        set(r.prompt_id for r in val_records)
    )
    assert len(overlap) == 0, f"Critical prompt leakage detected in M5 partition: {overlap}"

    return train_records, val_records
