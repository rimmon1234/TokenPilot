"""
M5 Pilot Training Data Preparation and Validation Module.
Provides reproducible data structures, validation rules, and prompt-group partitioning
for training the supervised ML model quality router.
Zero secrets, zero prompt leakage, truthful cost representation.
"""

import hashlib
import json
import logging
import os
import random
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Any
from pydantic import BaseModel, Field, field_validator
from app.config import settings
from app.schemas.evaluation import BenchmarkResult, BenchmarkRun, EvaluationOutcome
from app.services.benchmark.storage import benchmark_storage

logger = logging.getLogger(__name__)


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
    evaluation_role: str = Field(default="dev_train", description="Role discipline: dev_train or validation.")
    
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

    @field_validator("prompt_text", "output_text", "extracted_answer", "reference_answer", mode="before")
    @classmethod
    def validate_no_secrets(cls, v: Optional[str]) -> Optional[str]:
        if not v or not isinstance(v, str):
            return v
        secret_patterns = [
            r"(?i)api[_-]?key",
            r"(?i)bearer\s+[a-zA-Z0-9_\-\.]{15,}",
            r"hf_[a-zA-Z0-9]{20,}",
            r"AIza[0-9A-Za-z-_]{35}",
            r"sk-[a-zA-Z0-9]{20,}",
            r"(?i)authorization\s*:\s*bearer",
        ]
        for pat in secret_patterns:
            if re.search(pat, v):
                raise ValueError(f"Secret-bearing text detected: matches {pat}")
        return v

    @field_validator("source_split")
    @classmethod
    def validate_train_split_only(cls, v: str) -> str:
        if v.lower() == "test":
            raise ValueError(
                "Upstream 'test' split is strictly prohibited for M5 training/development. "
                "The test split is permanently reserved as a held-out evaluation benchmark."
            )
        return v

    @field_validator("evaluation_role")
    @classmethod
    def validate_evaluation_role(cls, v: str) -> str:
        valid_roles = {"dev_train", "validation"}
        if v not in valid_roles:
            raise ValueError(f"Invalid evaluation_role '{v}'. Must be one of {valid_roles}.")
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
    - Cost provenance is faithfully mapped from pricing snapshot or result.
    - Prompt length features are extracted deterministically.
    - Upstream test split is rejected.
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

    # 4. Cost provenance extraction
    cost_provenance = "unknown"
    if result.pricing_snapshot and getattr(result.pricing_snapshot, "pricing_source", None):
        cost_provenance = result.pricing_snapshot.pricing_source
    elif getattr(result, "cost_provenance", None):
        cost_provenance = getattr(result, "cost_provenance")

    # 5. Deterministic sample ID
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
        cost_provenance=cost_provenance,
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
    Assigns evaluation_role="dev_train" to training records and "validation" to validation records.
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

    # 4. Group records according to prompt assignment and set evaluation roles
    train_records = [
        r.model_copy(update={"evaluation_role": "dev_train"})
        for r in records if r.prompt_id in train_prompts
    ]
    val_records = [
        r.model_copy(update={"evaluation_role": "validation"})
        for r in records if r.prompt_id in val_prompts
    ]

    # Verify zero overlap
    overlap = set(r.prompt_id for r in train_records).intersection(
        set(r.prompt_id for r in val_records)
    )
    assert len(overlap) == 0, f"Critical prompt leakage detected in M5 partition: {overlap}"

    return train_records, val_records


class M5PilotManifest(BaseModel):
    """Metadata manifest documenting an M5 development pilot dataset artifact."""
    manifest_id: str = Field(..., description="Unique manifest identifier.")
    dataset_pilot_label: str = Field(default="m5_supervised_pilot_v1")
    run_id: str = Field(..., description="Source benchmark run ID.")
    upstream_dataset_id: str = Field(..., description="Dataset ID (e.g. gsm8k).")
    upstream_dataset_revision: str = Field(..., description="Pinned commit SHA.")
    source_split: str = Field(..., description="Source split (train).")
    evaluation_role: str = Field(default="dev_train")
    evaluator_version: str = Field(default="gsm8k_exact_match_v2")
    created_at: str = Field(..., description="ISO 8601 creation timestamp.")
    seed: int = Field(default=42, description="Sampling and partition seed.")
    train_ratio: float = Field(default=0.8, description="Train partition ratio.")
    total_source_results: int = Field(..., description="Count of raw source results.")
    total_unique_prompts: int = Field(..., description="Count of unique question prompts.")
    eligible_records: int = Field(..., description="Records eligible for M5 training.")
    excluded_records: int = Field(default=0, description="Records excluded from dataset.")
    exclusion_reasons: Dict[str, int] = Field(default_factory=dict)
    train_partition_size: int = Field(..., description="Count of records in train partition.")
    val_partition_size: int = Field(..., description="Count of records in validation partition.")
    train_prompt_count: int = Field(..., description="Unique prompt count in train partition.")
    val_prompt_count: int = Field(..., description="Unique prompt count in validation partition.")
    zero_prompt_overlap_verified: bool = Field(True, description="Strict confirmation of zero prompt leakage.")
    models_evaluated: List[str] = Field(default_factory=list)
    model_observations: Dict[str, int] = Field(default_factory=dict)
    model_outcomes: Dict[str, Dict[str, int]] = Field(default_factory=dict)
    token_usage_stats: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    cost_stats: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    files: Dict[str, Dict[str, Any]] = Field(default_factory=dict)


def export_m5_pilot_dataset(
    records: List[M5PilotRecord],
    train_records: List[M5PilotRecord],
    val_records: List[M5PilotRecord],
    output_dir: str,
    run: BenchmarkRun,
    seed: int = 42,
    train_ratio: float = 0.8,
    excluded_count: int = 0,
    exclusion_reasons: Optional[Dict[str, int]] = None,
) -> Tuple[M5PilotManifest, Dict[str, str]]:
    """
    Save validated M5 pilot dataset artifacts and metadata manifest to local storage.
    Files generated:
    - train.jsonl
    - val.jsonl
    - m5_pilot_all.jsonl
    - m5_pilot_manifest.json
    Calculates SHA256 checksums and record counts for each file.
    """
    os.makedirs(output_dir, exist_ok=True)
    
    file_map = {
        "train.jsonl": train_records,
        "val.jsonl": val_records,
        "m5_pilot_all.jsonl": records,
    }
    
    saved_files: Dict[str, str] = {}
    file_meta: Dict[str, Dict[str, Any]] = {}
    
    for fname, rec_list in file_map.items():
        fpath = os.path.join(output_dir, fname)
        hasher = hashlib.sha256()
        with open(fpath, "w", encoding="utf-8") as f:
            for r in rec_list:
                line = r.model_dump_json() + "\n"
                f.write(line)
                hasher.update(line.encode("utf-8"))
        size_bytes = os.path.getsize(fpath)
        sha256_hash = hasher.hexdigest()
        saved_files[fname] = fpath
        file_meta[fname] = {
            "record_count": len(rec_list),
            "size_bytes": size_bytes,
            "sha256": sha256_hash,
            "path": fpath,
        }

    # Aggregate statistics per model
    model_obs: Dict[str, int] = {}
    model_outcomes: Dict[str, Dict[str, int]] = {}
    token_stats: Dict[str, Dict[str, Any]] = {}
    cost_stats: Dict[str, Dict[str, Any]] = {}
    
    for r in records:
        m = r.model_id
        model_obs[m] = model_obs.get(m, 0) + 1
        model_outcomes.setdefault(m, {}).setdefault(r.evaluation_status, 0)
        model_outcomes[m][r.evaluation_status] += 1
        
        t_stat = token_stats.setdefault(m, {
            "missing_tokens_count": 0,
            "total_tokens": 0,
            "token_provenances": [],
        })
        if r.total_tokens is None:
            t_stat["missing_tokens_count"] += 1
        else:
            t_stat["total_tokens"] += r.total_tokens
        if r.token_provenance not in t_stat["token_provenances"]:
            t_stat["token_provenances"].append(r.token_provenance)

        c_stat = cost_stats.setdefault(m, {
            "unknown_cost_count": 0,
            "total_cost_usd": None,
            "cost_provenance": r.cost_provenance,
        })
        if r.total_cost_usd is None:
            c_stat["unknown_cost_count"] += 1
        else:
            c_stat["total_cost_usd"] = (c_stat["total_cost_usd"] or 0.0) + r.total_cost_usd

    unique_prompts = sorted(list({r.prompt_id for r in records}))
    train_prompts = set(r.prompt_id for r in train_records)
    val_prompts = set(r.prompt_id for r in val_records)

    manifest_id = f"manifest-m5-pilot-{run.id}"
    manifest = M5PilotManifest(
        manifest_id=manifest_id,
        dataset_pilot_label="m5_supervised_pilot_v1",
        run_id=run.id,
        upstream_dataset_id=run.dataset_id,
        upstream_dataset_revision=run.dataset_revision,
        source_split=run.source_split,
        evaluation_role="dev_train",
        evaluator_version="gsm8k_exact_match_v2",
        created_at=datetime.now(timezone.utc).isoformat(),
        seed=seed,
        train_ratio=train_ratio,
        total_source_results=len(records) + excluded_count,
        total_unique_prompts=len(unique_prompts),
        eligible_records=len(records),
        excluded_records=excluded_count,
        exclusion_reasons=exclusion_reasons or {},
        train_partition_size=len(train_records),
        val_partition_size=len(val_records),
        train_prompt_count=len(train_prompts),
        val_prompt_count=len(val_prompts),
        zero_prompt_overlap_verified=len(train_prompts.intersection(val_prompts)) == 0,
        models_evaluated=run.model_ids,
        model_observations=model_obs,
        model_outcomes=model_outcomes,
        token_usage_stats=token_stats,
        cost_stats=cost_stats,
        files=file_meta,
    )

    manifest_path = os.path.join(output_dir, "m5_pilot_manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        f.write(manifest.model_dump_json(indent=2))
    saved_files["m5_pilot_manifest.json"] = manifest_path

    return manifest, saved_files


def prepare_m5_pilot_dataset(
    run_id: str,
    output_dir: Optional[str] = None,
    train_ratio: float = 0.8,
    seed: int = 42,
) -> Tuple[M5PilotManifest, List[M5PilotRecord], List[M5PilotRecord]]:
    """
    End-to-end pipeline:
    1. Load benchmark run and canonical results from storage.
    2. Validate run eligibility and source split isolation.
    3. Construct and validate M5PilotRecords (excluding secrets, mapping outcomes).
    4. Deterministically partition by prompt_id (seed=42, 80/20 train/val).
    5. Save JSONL artifacts and manifest to local storage directory.
    6. Return validated manifest and partition records.
    """
    dest_dir = output_dir or settings.m5_pilot_storage_dir

    run = benchmark_storage.get_run(run_id)
    if not run:
        raise ValueError(f"Benchmark run '{run_id}' not found.")

    if run.source_split.lower() == "test":
        raise ValueError(
            "Benchmark run uses the upstream 'test' split. "
            "The test split is permanently held out and prohibited for M5 dataset preparation."
        )

    results = benchmark_storage.get_all_results(run_id)
    if not results:
        raise ValueError(f"No results found for benchmark run '{run_id}'.")

    eligible_records: List[M5PilotRecord] = []
    excluded_count = 0
    exclusion_reasons: Dict[str, int] = {}

    for res in results:
        try:
            record = build_m5_pilot_record(res, run)
            eligible_records.append(record)
        except Exception as err:
            excluded_count += 1
            reason = str(err)
            exclusion_reasons[reason] = exclusion_reasons.get(reason, 0) + 1
            logger.warning("Excluded benchmark result %s from M5 dataset: %s", res.id, err)

    if not eligible_records:
        raise ValueError(f"All {len(results)} results were excluded during M5 preparation: {exclusion_reasons}")

    train_recs, val_recs = partition_m5_records_by_prompt(
        eligible_records,
        train_ratio=train_ratio,
        seed=seed,
    )

    manifest, _ = export_m5_pilot_dataset(
        records=eligible_records,
        train_records=train_recs,
        val_records=val_recs,
        output_dir=dest_dir,
        run=run,
        seed=seed,
        train_ratio=train_ratio,
        excluded_count=excluded_count,
        exclusion_reasons=exclusion_reasons,
    )

    return manifest, train_recs, val_recs
