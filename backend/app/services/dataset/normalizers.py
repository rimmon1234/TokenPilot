"""Normalizers for converting raw benchmark records into TokenPilot canonical DatasetRecord format."""
import hashlib
import re
from typing import Dict, Any, Optional
from app.schemas.dataset import DatasetRecord, TaskType, EvaluationRole


def extract_gsm8k_final_answer(answer_text: str) -> Optional[str]:
    """
    Evaluator-ready normalization function capable of extracting the final answer
    from the documented GSM8K answer format ('#### <number>').
    Handles negative numbers, decimals, commas, and dollar signs.
    Returns None if missing or malformed.
    """
    if not answer_text or not isinstance(answer_text, str):
        return None

    # Search for the standard '#### <value>' pattern
    match = re.search(r"####\s*([^\n\r]+)", answer_text)
    if not match:
        return None

    raw_val = match.group(1).strip()
    if not raw_val:
        return None

    # Strip currency symbols and commas (e.g. '$1,200' -> '1200', '18.0' -> '18.0')
    cleaned = raw_val.replace("$", "").replace(",", "").strip()
    
    # Strip trailing punctuation if accidentally included (e.g. '18.')
    cleaned = cleaned.rstrip(".")

    if not cleaned:
        return None

    return cleaned


def normalize_gsm8k_record(
    raw: Dict[str, Any],
    dataset_id: str,
    revision: str,
    split: str,
    role: EvaluationRole,
    index: int,
) -> DatasetRecord:
    """
    Normalize a raw GSM8K question-answer record into TokenPilot's canonical schema.
    Raises ValueError on missing required fields or empty content.
    """
    if not isinstance(raw, dict):
        raise ValueError(f"Record at index {index} is not a valid dictionary.")

    question = (raw.get("question") or "").strip()
    if not question:
        raise ValueError(f"GSM8K record at index {index} is missing required 'question' field.")

    raw_answer = (raw.get("answer") or "").strip()
    if not raw_answer:
        raise ValueError(f"GSM8K record at index {index} is missing required 'answer' field.")

    extracted_answer = extract_gsm8k_final_answer(raw_answer)

    # Deterministic record ID and content hash
    stable_key = f"{dataset_id}:{split}:{index}:{question[:60]}"
    rec_hash = hashlib.sha256(stable_key.encode("utf-8")).hexdigest()[:12]
    record_id = f"rec-gsm8k-{split}-{index}-{rec_hash}"

    content_str = f"QUESTION:{question}\nANSWER:{raw_answer}"
    content_hash = hashlib.sha256(content_str.encode("utf-8")).hexdigest()

    return DatasetRecord(
        record_id=record_id,
        dataset_id=dataset_id,
        dataset_revision=revision,
        source_split=split,
        evaluation_role=role,
        task_type=TaskType.MATH_REASONING,
        input_messages=[{"role": "user", "content": question}],
        reference_answer=raw_answer,
        reference_metadata={
            "extracted_answer": extracted_answer,
            "raw_answer": raw_answer,
            "upstream_index": index,
            "answer_format": "gsm8k_delimited_hash",
            "has_extracted_answer": extracted_answer is not None,
        },
        license="MIT",
        source_url="https://huggingface.co/datasets/openai/gsm8k",
        content_hash=content_hash,
    )


def normalize_humaneval_record(
    raw: Dict[str, Any],
    dataset_id: str,
    revision: str,
    split: str,
    role: EvaluationRole,
    index: int,
) -> DatasetRecord:
    """
    Normalize a raw HumanEval coding record into TokenPilot's canonical schema.
    Raises ValueError on missing required fields.
    Code is treated strictly as untrusted and never executed.
    """
    if not isinstance(raw, dict):
        raise ValueError(f"Record at index {index} is not a valid dictionary.")

    task_id = (raw.get("task_id") or "").strip()
    if not task_id:
        raise ValueError(f"HumanEval record at index {index} is missing required 'task_id'.")

    prompt = (raw.get("prompt") or "").strip()
    if not prompt:
        raise ValueError(f"HumanEval record '{task_id}' is missing required 'prompt'.")

    canonical_solution = (raw.get("canonical_solution") or "").strip()
    if not canonical_solution:
        raise ValueError(f"HumanEval record '{task_id}' is missing required 'canonical_solution'.")

    entry_point = (raw.get("entry_point") or "").strip()
    test_code = (raw.get("test") or "").strip()

    # Deterministic record ID based on upstream task_id
    clean_task_id = task_id.replace("/", "_").lower()
    record_id = f"rec-he-{split}-{clean_task_id}"

    content_str = f"TASK_ID:{task_id}\nPROMPT:{prompt}\nSOLUTION:{canonical_solution}\nTEST:{test_code}"
    content_hash = hashlib.sha256(content_str.encode("utf-8")).hexdigest()

    return DatasetRecord(
        record_id=record_id,
        dataset_id=dataset_id,
        dataset_revision=revision,
        source_split=split,
        evaluation_role=role,
        task_type=TaskType.CODE_GENERATION,
        input_messages=[{"role": "user", "content": prompt}],
        reference_answer=canonical_solution,
        reference_metadata={
            "task_id": task_id,
            "entry_point": entry_point,
            "test": test_code,
            "canonical_solution": canonical_solution,
            "execution_policy": "untrusted_isolated_sandbox_required",
            "upstream_index": index,
        },
        license="MIT",
        source_url="https://huggingface.co/datasets/openai/openai_humaneval",
        content_hash=content_hash,
    )
