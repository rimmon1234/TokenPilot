"""GSM8K deterministic numerical answer evaluation service for TokenPilot (Milestone M4.2.2 & M4.2.3)."""
import re
import statistics
from decimal import Decimal, InvalidOperation
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Any
from app.schemas.evaluation import (
    BenchmarkRun,
    BenchmarkResult,
    EvaluationOutcome,
    ModelScoringSummary,
    BenchmarkRunScoringSummary,
)
from app.services.dataset.normalizers import extract_gsm8k_final_answer


def clean_candidate_number(raw: str) -> Optional[str]:
    """
    Sanitize and extract a clean decimal number from a candidate substring.
    Handles negative numbers, decimal points, comma separators, and currency signs.
    Returns normalized number string or None if unparseable.
    """
    if not raw or not isinstance(raw, str):
        return None

    # Strip markdown bold/italics/code formatting
    cleaned = re.sub(r"[*_~`]", "", raw).strip()
    # Replace unicode minus and dashes
    cleaned = cleaned.replace("−", "-").replace("–", "-").replace("—", "-")
    # Remove currency signs and leading/trailing whitespace
    cleaned = re.sub(r"[\$€£¥]", "", cleaned).strip()

    # Match numeric pattern: optional sign, digits with optional comma separators, optional decimal
    match = re.search(r"[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?", cleaned)
    if not match:
        return None

    num_str = match.group(0).replace(",", "").strip()

    # Validate that it can be parsed as a valid Decimal
    try:
        Decimal(num_str)
        return num_str
    except (InvalidOperation, ValueError):
        return None


def extract_gsm8k_model_answer(response_text: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Deterministic extraction of GSM8K final answer from assistant output text.
    Prefers explicitly marked answers and avoids blindly guessing first or last numbers
    when intermediate calculations are present.

    Returns:
        Tuple of (cleaned_number_str, extraction_method) or (None, None) if unparseable.
    """
    if not response_text or not isinstance(response_text, str):
        return None, None

    text = response_text.strip()
    if not text:
        return None, None

    # Priority 1: Canonical GSM8K delimiter '#### <number>'
    match = re.search(r"####\s*([^\n\r]+)", text)
    if match:
        val = clean_candidate_number(match.group(1))
        if val is not None:
            return val, "gsm8k_hash"

    # Priority 2: LaTeX boxed representation: '\boxed{<number>}'
    match = re.search(r"\\boxed\{([^}]+)\}", text)
    if match:
        val = clean_candidate_number(match.group(1))
        if val is not None:
            return val, "latex_boxed"

    # Priority 3: Explicit final answer statements
    final_patterns = [
        r"(?i)(?:the\s+)?final\s+answer\s+(?:is|equals|=|:)\s*:?\s*([^\n\r.]+)",
        r"(?i)final\s+answer\s*:\s*([^\n\r.]+)",
    ]
    for pat in final_patterns:
        match = re.search(pat, text)
        if match:
            val = clean_candidate_number(match.group(1))
            if val is not None:
                return val, "final_answer_phrase"

    # Priority 4: Explicit answer statements at beginning of line or clause
    ans_patterns = [
        r"(?i)(?:^|\n|\.\s+)(?:so\s*,?\s*the|therefore\s*,?\s*the|thus\s*,?\s*the|hence\s*,?\s*the|in\s+conclusion\s*,?\s*the)?\s*answer\s*(?:is|equals|=|:)\s*:?\s*([^\n\r.]+)",
    ]
    for pat in ans_patterns:
        match = re.search(pat, text)
        if match:
            val = clean_candidate_number(match.group(1))
            if val is not None:
                return val, "answer_phrase"

    # Priority 5: Concluding sentences with explicit conclusion verbs and target amount
    # Handles natural LLM completions (e.g. Llama 3.2, Qwen):
    # - "So, Janet makes $18 every day at the farmers' market."
    # - "It takes 3 bolts in total to make the robe."
    # - "Josh made a profit of $70,000."
    # - "Eliza's earnings for this week are $460."
    # - "Therefore, it takes Carla 120 minutes (or 2 hours) to download the file."
    # - "So, Toulouse, Charleston, and Seattle have a total of 260 sheep together."
    # - "John is 215 miles away from home at the end of the 4 hours."
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    terminal_candidates = []
    if lines:
        terminal_candidates.append(lines[-1])
        if len(lines) >= 2:
            terminal_candidates.append(" ".join(lines[-2:]))

    concluding_patterns = [
        # Topic noun + verb + amount (e.g. Eliza's earnings for this week are $460, Josh made a profit of $70,000)
        r"(?i)(?:earnings|profit|total(?:\s+cost|\s+distance|\s+amount|\s+number|\s+time)?|cost|price|distance|amount|remainder)\s*[^.\n]*?\b(?:is|are|was|were|=|equals|came to|of)\s+([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)",
        # Concluding verb with amount: "made a profit of $70,000", "Janet makes $18", "needs to pay $64"
        r"(?i)\b(?:needs?\s+to\s+pay|spent|spends|paid|cost|costs)\s+([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)",
        r"(?i)\b(?:makes?|made|earns?|earned|received?|gets?|got|sells?|sold|leaves?|left)\s+(?:a\s+profit\s+of\s+|an\s+earnings?\s+of\s+|a\s+total\s+of\s+|only\s+)?([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)",
        # "takes Carla 120 minutes", "takes 3 bolts in total"
        r"(?i)\b(?:takes?|took)(?:\s+[a-zA-Z]+)?\s+([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)",
        # "needs to give her chickens 20 cups"
        r"(?i)\b(?:needs?\s+to\s+(?:give|feed|buy|use|have|pay|add|subtract))(?:\s+[^.\d\n]{1,30})?\s+([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)",
        # "have/has a total of 260 sheep"
        r"(?i)\b(?:have|has|had)\s+(?:a\s+total\s+of|in\s+total)\s+([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)",
        # "runs a total of 540 meters"
        r"(?i)\b(?:runs?|ran|walks?|walked|drives?|drove)\s+(?:a\s+total\s+of\s+)?([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)",
        # "[Subject] is/are [amount] [units] away/left/remaining/in total"
        r"(?i)\b(?:is|are|was|were)\s+([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)\s*(?:miles?|meters?|km|feet|inches|minutes?|hours?|days?|weeks?|years?|bolts?|cups?|sheep|eggs?|dollars?|cents?|glasses?|away|left|remaining|in total)",
        # Broad conclusion fallback
        r"(?i)(?:so|therefore|thus|hence|in total|in all|altogether|in conclusion)\s*,?\s*[^.\n]*?\b(?:is|are|equals|=|makes|takes|has|have|gets|needs|earns|sells|leaves|pays|cost|costs|runs|walks|eats|spent|spends|paid)\s+(?:a total of\s+|only\s+)?(\$?\s*[-+]?[\d,]+(?:\.\d+)?)\b",
    ]

    # Check terminal lines first (prevents intermediate calculations from matching)
    for sample in terminal_candidates:
        for pat in concluding_patterns:
            match = re.search(pat, sample)
            if match:
                val = clean_candidate_number(match.group(1))
                if val is not None:
                    return val, "concluding_statement"

    # Search backwards from the end across the full text ONLY for sentences with explicit discourse markers
    # (e.g. "So, ...", "Therefore, ..."). Never match plain premise sentences like "She had 10 apples."
    discourse_pattern = r"(?i)(?:so|therefore|thus|hence|in total|in all|altogether|in conclusion)\s*,?\s*[^.\n]*?\b(?:is|are|equals|=|makes|takes|has|have|gets|needs|earns|sells|leaves|pays|cost|costs|runs|walks|eats|spent|spends|paid)\s+(?:a total of\s+|only\s+)?(\$?\s*[-+]?[\d,]+(?:\.\d+)?)\b"
    matches = list(re.finditer(discourse_pattern, text))
    if matches:
        last_match = matches[-1]
        val = clean_candidate_number(last_match.group(1))
        if val is not None:
            return val, "concluding_statement"

    # Priority 6: Concluding equation at the very end of response: "= 18" or "= $18"
    match = re.search(r"=\s*(\$?\s*[-+]?[\d,]+(?:\.\d+)?)\.?\s*$", text)
    if match:
        val = clean_candidate_number(match.group(1))
        if val is not None:
            return val, "concluding_equation"

    # Priority 7: Single number on the last non-empty line or standalone response
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if lines:
        last_line = lines[-1]
        # Check if the last line contains exactly one number and nothing else besides unit/label
        # e.g. "42", "$42", "42.", "3 bolts", "Answer: 42"
        simple_match = re.match(r"^[\$€£¥\s]*[-+]?[\d,]+(?:\.\d+)?(?:\s+[a-zA-Z%]+)?\.?$", last_line)
        if simple_match:
            val = clean_candidate_number(last_line)
            if val is not None:
                return val, "standalone_last_line"

    # If response contains multiple numbers without clear final answer structure, return None (unparseable)
    return None, None


def compare_gsm8k_answers(candidate_str: Optional[str], reference_str: Optional[str]) -> bool:
    """
    Compare model extracted answer against canonical reference answer using Decimal normalization.
    Returns True on exact numeric equivalence (e.g. '18' == '18.0', '70000' == '70,000'), False otherwise.
    """
    if not candidate_str or not reference_str:
        return False

    clean_cand = str(candidate_str).strip().replace(",", "")
    clean_ref = str(reference_str).strip().replace(",", "")

    # Fast path: exact string match
    if clean_cand == clean_ref:
        return True

    # Decimal comparison
    try:
        dec_cand = Decimal(clean_cand)
        dec_ref = Decimal(clean_ref)
        return dec_cand == dec_ref
    except (InvalidOperation, ValueError):
        return clean_cand.lower() == clean_ref.lower()


def evaluate_gsm8k_result(result: BenchmarkResult) -> BenchmarkResult:
    """
    Evaluate an individual GSM8K benchmark result deterministically.
    Preserves all inference telemetry, timestamps, and cost data.
    Updates evaluation_status, extracted_answer, score, metric_name, and evaluation_details.
    """
    # 1. Non-successful inference status (timeout, 401, 429, cancelled, error) -> FAILED
    if result.status != "success":
        result.evaluation_status = EvaluationOutcome.FAILED
        result.score = None
        result.metric_name = "exact_match"
        result.evaluation_details = {
            "reason": "inference_request_failed",
            "request_status": result.status,
            "error_category": result.error_category,
            "error_message": result.error_message,
        }
        return result

    # 2. Empty or whitespace-only response -> UNPARSEABLE
    if not result.output_text or not result.output_text.strip():
        result.evaluation_status = EvaluationOutcome.UNPARSEABLE
        result.score = 0.0
        result.metric_name = "exact_match"
        result.extracted_answer = None
        result.evaluation_details = {"reason": "empty_model_response"}
        return result

    # 3. Extract final answer from model output text
    candidate_answer, extraction_method = extract_gsm8k_model_answer(result.output_text)
    result.extracted_answer = candidate_answer

    # 4. If answer cannot be parsed confidently -> UNPARSEABLE
    if not candidate_answer:
        result.evaluation_status = EvaluationOutcome.UNPARSEABLE
        result.score = 0.0
        result.metric_name = "exact_match"
        result.evaluation_details = {"reason": "unparseable_no_explicit_answer"}
        return result

    # 5. Extract canonical reference answer from metadata or reference_answer
    reference_target = None
    if isinstance(result.reference_metadata, dict):
        reference_target = result.reference_metadata.get("extracted_answer")

    if not reference_target and result.reference_answer:
        reference_target = extract_gsm8k_final_answer(result.reference_answer)

    # 6. If reference answer is missing from dataset record -> UNEVALUATED
    if not reference_target:
        result.evaluation_status = EvaluationOutcome.UNEVALUATED
        result.score = None
        result.metric_name = "exact_match"
        result.evaluation_details = {"reason": "missing_canonical_reference_target"}
        return result

    # 7. Compare candidate answer against reference answer
    is_correct = compare_gsm8k_answers(candidate_answer, str(reference_target))

    if is_correct:
        result.evaluation_status = EvaluationOutcome.CORRECT
        result.score = 1.0
    else:
        result.evaluation_status = EvaluationOutcome.INCORRECT
        result.score = 0.0

    result.metric_name = "exact_match"
    result.evaluation_details = {
        "extraction_method": extraction_method,
        "extracted_answer": candidate_answer,
        "canonical_reference": str(reference_target),
        "exact_match": is_correct,
    }

    return result


def calculate_pareto_frontier(
    model_metrics: Dict[str, ModelScoringSummary]
) -> Dict[str, Optional[bool]]:
    """
    Determine Pareto efficiency for evaluated models with known cost and quality.
    A candidate Model B is dominated by Model A if:
      Cost(A) <= Cost(B) and Quality(A) >= Quality(B)
      with at least one strict inequality.
    Models with unknown costs or missing accuracy are assigned None (cannot be placed on frontier).
    Non-dominated models among valid candidates are Pareto efficient (True); dominated models are False.
    """
    pareto_map: Dict[str, Optional[bool]] = {}

    # Identify models with valid quality and cost
    eligible: List[Tuple[str, float, float]] = []
    for m_id, m_summary in model_metrics.items():
        quality = (
            m_summary.scorable_accuracy
            if m_summary.scorable_accuracy is not None
            else m_summary.end_to_end_accuracy
        )
        cost = m_summary.cost_per_question_usd
        if quality is not None and cost is not None:
            eligible.append((m_id, float(cost), float(quality)))
        else:
            pareto_map[m_id] = None

    for m_id, cost, quality in eligible:
        dominated = False
        for other_id, other_cost, other_quality in eligible:
            if other_id == m_id:
                continue
            if (other_cost <= cost and other_quality >= quality) and (
                other_cost < cost or other_quality > quality
            ):
                dominated = True
                break
        pareto_map[m_id] = not dominated

    return pareto_map


def calculate_benchmark_scores(
    run: BenchmarkRun, results: List[BenchmarkResult]
) -> Tuple[BenchmarkRun, List[BenchmarkResult]]:
    """
    Score all results for a GSM8K benchmark run, calculate per-model and aggregate metrics,
    and update run.results_summary without making external API calls.
    """
    evaluated_results: List[BenchmarkResult] = []
    for res in results:
        evaluated_res = evaluate_gsm8k_result(res)
        evaluated_results.append(evaluated_res)

    # Group results by model_id
    model_groups: Dict[str, List[BenchmarkResult]] = {}
    for res in evaluated_results:
        model_groups.setdefault(res.model_id, []).append(res)

    # Create display name map from run.model_configs
    display_names: Dict[str, str] = {
        cfg.model_id: cfg.display_name for cfg in run.model_configs
    }

    model_metrics: Dict[str, ModelScoringSummary] = {}
    total_attempted = 0
    total_successful = 0
    total_correct = 0
    total_incorrect = 0
    total_unparseable = 0
    total_failed = 0
    total_unevaluated = 0

    for model_id, model_res_list in model_groups.items():
        attempted = len(model_res_list)
        successful = sum(1 for r in model_res_list if r.status == "success")
        correct = sum(1 for r in model_res_list if r.evaluation_status == EvaluationOutcome.CORRECT)
        incorrect = sum(1 for r in model_res_list if r.evaluation_status == EvaluationOutcome.INCORRECT)
        unparseable = sum(1 for r in model_res_list if r.evaluation_status == EvaluationOutcome.UNPARSEABLE)
        failed = sum(1 for r in model_res_list if r.evaluation_status == EvaluationOutcome.FAILED)
        unevaluated = sum(1 for r in model_res_list if r.evaluation_status == EvaluationOutcome.UNEVALUATED)

        scorable_den = correct + incorrect
        scorable_acc = round(correct / scorable_den, 4) if scorable_den > 0 else None
        e2e_acc = round(correct / attempted, 4) if attempted > 0 else None

        display_name = display_names.get(
            model_id, model_res_list[0].model_display_name if model_res_list else model_id
        )

        # Latency statistics
        latencies = [
            r.latency_ms
            for r in model_res_list
            if r.status == "success" and r.latency_ms is not None
        ]
        avg_latency = round(sum(latencies) / len(latencies), 2) if latencies else None
        median_latency = (
            round(float(statistics.median(latencies)), 2) if latencies else None
        )

        ttfts = [
            r.ttft_ms for r in model_res_list if r.status == "success" and r.ttft_ms is not None
        ]
        avg_ttft = round(sum(ttfts) / len(ttfts), 2) if ttfts else None

        # Token usage & provenance
        prompt_tok_list = [r.prompt_tokens for r in model_res_list if r.prompt_tokens is not None]
        comp_tok_list = [r.completion_tokens for r in model_res_list if r.completion_tokens is not None]
        tot_tok_list = [r.total_tokens for r in model_res_list if r.total_tokens is not None]

        tot_prompt = sum(prompt_tok_list) if prompt_tok_list else None
        tot_comp = sum(comp_tok_list) if comp_tok_list else None
        tot_tokens = sum(tot_tok_list) if tot_tok_list else None

        missing_usage = sum(
            1 for r in model_res_list if r.status == "success" and r.total_tokens is None
        )

        prov_set = {
            r.token_provenance for r in model_res_list if r.status == "success" and r.token_provenance
        }
        if len(prov_set) == 1:
            token_provenance = prov_set.pop()
        elif len(prov_set) > 1:
            token_provenance = "mixed"
        else:
            token_provenance = "unavailable"

        # Cost accounting
        costs = [
            r.cost_usd for r in model_res_list if r.status == "success" and r.cost_usd is not None
        ]
        unknown_cost_count = sum(
            1 for r in model_res_list if r.status == "success" and r.cost_usd is None
        )

        total_cost_usd = None
        cost_per_q_usd = None
        if unknown_cost_count == 0 and len(costs) == successful and successful > 0:
            total_cost_usd = round(sum(costs), 6)
            cost_per_q_usd = round(total_cost_usd / successful, 6)

        # Model configs lookup
        model_cfg = next((c for c in run.model_configs if c.model_id == model_id), None)
        provider_type = model_cfg.provider_type if model_cfg else None
        provider_model_id = (
            model_cfg.provider_model_id
            if model_cfg
            else (model_res_list[0].provider_model_id if model_res_list else None)
        )
        pricing_source = model_cfg.pricing_source if model_cfg else None

        model_metrics[model_id] = ModelScoringSummary(
            model_id=model_id,
            display_name=display_name,
            provider_type=provider_type,
            provider_model_id=provider_model_id,
            attempted_questions=attempted,
            successful_generations=successful,
            correct_answers=correct,
            incorrect_answers=incorrect,
            unparseable_answers=unparseable,
            failed_requests=failed,
            unevaluated_results=unevaluated,
            scorable_accuracy=scorable_acc,
            end_to_end_accuracy=e2e_acc,
            avg_latency_ms=avg_latency,
            median_latency_ms=median_latency,
            avg_ttft_ms=avg_ttft,
            total_prompt_tokens=tot_prompt,
            total_completion_tokens=tot_comp,
            total_tokens=tot_tokens,
            token_provenance=token_provenance,
            missing_usage_count=missing_usage,
            total_cost_usd=total_cost_usd,
            cost_per_question_usd=cost_per_q_usd,
            unknown_cost_count=unknown_cost_count,
            pricing_source=pricing_source,
        )

        total_attempted += attempted
        total_successful += successful
        total_correct += correct
        total_incorrect += incorrect
        total_unparseable += unparseable
        total_failed += failed
        total_unevaluated += unevaluated

    # Calculate Pareto frontier for evaluated models
    pareto_results = calculate_pareto_frontier(model_metrics)
    for m_id, is_pareto in pareto_results.items():
        if m_id in model_metrics:
            model_metrics[m_id].is_pareto_efficient = is_pareto

    overall_scorable_den = total_correct + total_incorrect
    overall_scorable_acc = (
        round(total_correct / overall_scorable_den, 4) if overall_scorable_den > 0 else None
    )
    overall_e2e_acc = (
        round(total_correct / total_attempted, 4) if total_attempted > 0 else None
    )

    scoring_summary = BenchmarkRunScoringSummary(
        evaluation_metric="exact_match",
        evaluated_at=datetime.now(timezone.utc),
        total_attempted=total_attempted,
        total_successful=total_successful,
        total_correct=total_correct,
        total_incorrect=total_incorrect,
        total_unparseable=total_unparseable,
        total_failed=total_failed,
        total_unevaluated=total_unevaluated,
        scorable_accuracy=overall_scorable_acc,
        end_to_end_accuracy=overall_e2e_acc,
        model_metrics=model_metrics,
    )

    run.results_summary = scoring_summary.model_dump(mode="json")
    return run, evaluated_results
