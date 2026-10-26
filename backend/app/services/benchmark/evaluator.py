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
from app.services.benchmark.metadata_resolver import resolve_model_metadata


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
    hash_matches = re.findall(r"####\s*([^\n\r]+)", text)
    if hash_matches:
        candidates = [clean_candidate_number(m) for m in hash_matches]
        valid_candidates = [c for c in candidates if c is not None]
        if valid_candidates:
            try:
                first_dec = Decimal(valid_candidates[0])
                if all(Decimal(c) == first_dec for c in valid_candidates[1:]):
                    return valid_candidates[0], "gsm8k_hash"
            except Exception:
                if len(set(valid_candidates)) == 1:
                    return valid_candidates[0], "gsm8k_hash"
            return None, None

    # Priority 2: LaTeX boxed representation: '\boxed{<number>}'
    boxed_matches = re.findall(r"\\boxed\{([^}]+)\}", text)
    if boxed_matches:
        candidates = [clean_candidate_number(m) for m in boxed_matches]
        valid_candidates = [c for c in candidates if c is not None]
        if valid_candidates:
            try:
                first_dec = Decimal(valid_candidates[0])
                if all(Decimal(c) == first_dec for c in valid_candidates[1:]):
                    return valid_candidates[0], "latex_boxed"
            except Exception:
                if len(set(valid_candidates)) == 1:
                    return valid_candidates[0], "latex_boxed"
            return None, None

    # Priority 3: Explicit final answer statements
    final_patterns = [
        r"(?i)(?:the\s+)?final\s+(?:answer|result|value|total|amount|weight|cost)\s+(?:is|equals|=|:)\s*:?\s*([^\n\r.]+)",
        r"(?i)final\s+answer\s*:\s*([^\n\r.]+)",
    ]
    cand_finals = []
    for pat in final_patterns:
        for m in re.finditer(pat, text):
            val = clean_candidate_number(m.group(1))
            if val is not None:
                cand_finals.append(val)
    if cand_finals:
        try:
            first_dec = Decimal(cand_finals[0])
            if all(Decimal(c) == first_dec for c in cand_finals[1:]):
                return cand_finals[0], "final_answer_phrase"
        except Exception:
            if len(set(cand_finals)) == 1:
                return cand_finals[0], "final_answer_phrase"
        return None, None

    # Priority 4: Explicit answer statements at beginning of line or clause
    ans_patterns = [
        r"(?i)(?:^|\n|[.!?]\s+)(?:[a-zA-Z,]+\s+)*(?:the\s+)?(?:answer|result|total|sum)\s*(?:is|equals|=|:)\s*:?\s*([^\n\r.]+)",
        r"(?i)(?:^|\n)(?:answer|result|total)\s*:\s*([^\n\r.]+)",
    ]
    cand_ans = []
    for pat in ans_patterns:
        for m in re.finditer(pat, text):
            val = clean_candidate_number(m.group(1))
            if val is not None:
                cand_ans.append(val)
    if cand_ans:
        try:
            first_dec = Decimal(cand_ans[0])
            if all(Decimal(c) == first_dec for c in cand_ans[1:]):
                return cand_ans[0], "answer_phrase"
        except Exception:
            if len(set(cand_ans)) == 1:
                return cand_ans[0], "answer_phrase"
        return None, None

    # Priority 5: Concluding sentences with explicit conclusion patterns
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    terminal_candidates = []
    if lines:
        terminal_candidates.append(lines[-1])
        if len(lines) >= 2:
            terminal_candidates.append(" ".join(lines[-2:]))

    concluding_patterns = [
        # 1. Recommendation / modal verb + action verb + amount: 'Julie should read 42 pages', 'needs to give her chickens 20 cups', 'needs to pay $64'
        r"(?i)\b(?:should|needs?\s+to|must|will|would|can|has\s+to|had\s+to)\s+(?:[a-zA-Z]+\s+){1,4}(?:a\s+total\s+of\s+|about\s+|only\s+|an\s+additional\s+)?([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)",
        # 2. Time taken: 'takes Carla 120 minutes', 'takes 3 bolts in total'
        r"(?i)\b(?:takes?|took)(?:\s+[a-zA-Z]+)?\s+([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)",
        # 3. Topic noun + verb + amount: 'final weight ... is 16 pounds', 'the total is 42 pages', 'profit of $70,000'
        r"(?i)\b(?:the\s+)?(?:final\s+)?(?:weight|cost|price|distance|amount|remainder|total(?:\s+cost|\s+distance|\s+amount|\s+number|\s+time)?|number|count|earnings?|profit|value|time|length|height|width|sum)\s*[^.\n]*?\b(?:is|are|was|were|=|equals|came\s+to|of)\s+([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)",
        # 4. Cost and spending verbs: 'Jasper spends $45...', 'needs to pay $64', 'costs $18'
        r"(?i)\b(?:needs?\s+to\s+pay|spends?|spent|paid|pays?|cost|costs?)\s+([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)",
        # 5. Existence: 'there were 121 people on the ship'
        r"(?i)\b(?:there\s+(?:is|are|was|were|will\s+be))\s+(?:a\s+total\s+of\s+|about\s+|only\s+)?([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)",
        # 6. Passive conclusion: '1080 beetles are eaten each day'
        r"(?i)\b(?:so|therefore|thus|hence|in total|in all|altogether|this means(?:\s+that)?)\s*,?\s*([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)\s+(?:[a-zA-Z%]+\s+)*(?:are|were|was|is|will\s+be)\s+(?:eaten|read|written|bought|sold|consumed|needed|required|used|left|remaining|produced|spent|paid|collected)",
        # 7. Discourse marker + action verb: 'So, Julie reads 42...', 'Therefore, James writes 624 pages...'
        r"(?i)(?:so|therefore|thus|hence|in total|in all|altogether|this means(?:\s+that)?|as a result)\s*,?\s*[^.\n]*?\b(?:reads?|wrote|writes?|ate|eats?|bought|buys?|paid|pays?|spent|spends?|made|makes?|earned|earns?|had|has|have|got|gets?|received?|receives?|took|takes?|used|uses?|gave|gives?|ran|runs?|walked|walks?|drove|drives?|shoveled?|shovels?|planted?|plants?|consumed?|consumes?|collected?|collects?|cooked?|cooks?|baked?|bakes?|sold|sells?|leaves?|left|cost|costs?)\s+(?:a\s+total\s+of\s+|about\s+|only\s+|an\s+additional\s+)?([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)",
        # 8. Action verb + concluding adverbial phrase at end of sentence: 'Albert eats 48 slices of pizza that day.', 'Bella bought 38 stamps in all.'
        r"(?i)\b(?:reads?|wrote|writes?|ate|eats?|bought|buys?|paid|pays?|spent|spends?|made|makes?|earned|earns?|got|gets?|received?|receives?|took|takes?|used|uses?|gave|gives?|ran|runs?|walked|walks?|drove|drives?|shoveled?|shovels?|planted?|plants?|consumed?|consumes?|collected?|collects?|cooked?|cooks?|baked?|bakes?|sold|sells?|cost|costs?)\s+(?:a\s+total\s+of\s+|about\s+|only\s+|an\s+additional\s+)?([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)\s*(?:[a-zA-Z%]+\s+)*(?:in\s+all|in\s+total|altogether|that\s+day|each\s+day|per\s+day|a\s+day|a\s+week|per\s+week|a\s+year|per\s+year|in\s+a\s+year|tomorrow|yesterday)\b",
        # 9. '[Subject] is/are [amount] [units] away/left/remaining/in total'
        r"(?i)\b(?:is|are|was|were)\s+([-\$€£¥]?\s*[\d,]+(?:\.\d+)?)\s*(?:miles?|meters?|km|feet|inches|minutes?|hours?|days?|weeks?|years?|bolts?|cups?|sheep|eggs?|dollars?|cents?|glasses?|away|left|remaining|in total)",
        # 10. Broad discourse fallback
        r"(?i)(?:so|therefore|thus|hence|in total|in all|altogether|in conclusion|this means(?:\s+that)?)\s*,?\s*[^.\n]*?\b(?:is|are|was|were|equals|=|makes?|made|takes?|took|has|have|had|gets?|got|needs?|needed|earns?|earned|sells?|sold|leaves?|left|pays?|paid|cost|costs?|runs?|ran|walks?|walked|eats?|ate|spent|spends?)\s+(?:a\s+total\s+of\s+|only\s+)?(\$?\s*[-+]?[\d,]+(?:\.\d+)?)\b",
    ]

    for sample in terminal_candidates:
        for pat in concluding_patterns:
            match = re.search(pat, sample)
            if match:
                val = clean_candidate_number(match.group(1))
                if val is not None:
                    return val, "concluding_statement"

    # Search backwards from the end across the full text ONLY for sentences with explicit discourse markers
    # (e.g. "So, ...", "Therefore, ..."). Never match plain premise sentences like "She had 10 apples."
    discourse_pattern = r"(?i)(?:so|therefore|thus|hence|in total|in all|altogether|in conclusion|this means(?:\s+that)?)\s*,?\s*[^.\n]*?\b(?:is|are|was|were|equals|=|makes?|made|takes?|took|has|have|had|gets?|got|needs?|needed|earns?|earned|sells?|sold|leaves?|left|pays?|paid|cost|costs?|runs?|ran|walks?|walked|eats?|ate|spent|spends?|reads?|wrote|writes?|bought|buys?|eats?|ate)\s+(?:a\s+total\s+of\s+|only\s+)?(\$?\s*[-+]?[\d,]+(?:\.\d+)?)\b"
    matches = list(re.finditer(discourse_pattern, text))
    if matches:
        last_match = matches[-1]
        val = clean_candidate_number(last_match.group(1))
        if val is not None:
            return val, "concluding_statement"

    # Priority 6: Concluding equation at the very end of response: "= 18" or "= $18" or "= 42 pages."
    match = re.search(r"=\s*(\$?\s*[-+]?[\d,]+(?:\.\d+)?)(?:\s+[a-zA-Z%]+)?\.?\s*$", text)
    if match:
        val = clean_candidate_number(match.group(1))
        if val is not None:
            return val, "concluding_equation"

    # Priority 7: Single number on the last non-empty line or standalone response
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if lines:
        last_line = lines[-1]
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


def evaluate_gsm8k_result(
    result: BenchmarkResult, model_config: Optional[Any] = None
) -> BenchmarkResult:
    """
    Evaluate an individual GSM8K benchmark result deterministically.
    Preserves all inference telemetry, timestamps, and cost data.
    Updates evaluation_status, extracted_answer, score, metric_name, and evaluation_details.
    """
    # Disambiguate model metadata if missing on result
    if not result.model_source or not result.execution_provider or not result.execution_location:
        meta = resolve_model_metadata(model_config or result)
        if not result.model_source:
            result.model_source = meta["model_source"]
        if not result.source_repo_id:
            result.source_repo_id = meta["source_repo_id"]
        if not result.execution_provider:
            result.execution_provider = meta["execution_provider"]
        if not result.execution_location:
            result.execution_location = meta["execution_location"]

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
    model_config_map: Dict[str, Any] = {
        cfg.model_id: cfg for cfg in (run.model_configs or [])
    }
    evaluated_results: List[BenchmarkResult] = []
    for res in results:
        cfg = model_config_map.get(res.model_id)
        evaluated_res = evaluate_gsm8k_result(res, model_config=cfg)
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

        # Model configs lookup & metadata resolution
        model_cfg = next((c for c in run.model_configs if c.model_id == model_id), None)
        first_res = model_res_list[0] if model_res_list else None
        meta = resolve_model_metadata(model_cfg or first_res or {})

        model_source = (model_cfg.model_source if model_cfg and model_cfg.model_source else None) or (first_res.model_source if first_res else None) or meta["model_source"]
        source_repo_id = (model_cfg.source_repo_id if model_cfg and model_cfg.source_repo_id else None) or (first_res.source_repo_id if first_res else None) or meta["source_repo_id"]
        execution_provider = (model_cfg.execution_provider if model_cfg and model_cfg.execution_provider else None) or (first_res.execution_provider if first_res else None) or meta["execution_provider"]
        execution_location = (model_cfg.execution_location if model_cfg and model_cfg.execution_location else None) or (first_res.execution_location if first_res else None) or meta["execution_location"]
        provider_type = execution_provider or (model_cfg.provider_type if model_cfg else None)
        provider_model_id = (
            (model_cfg.provider_model_id if model_cfg else None)
            or (first_res.provider_model_id if first_res else None)
            or meta["runtime_model_id"]
        )
        pricing_source = model_cfg.pricing_source if model_cfg else None

        # Truthful multi-dimensional cost accounting
        # Distinguish: local API invoice (known $0.00) vs local compute cost vs total cost
        has_configured_local_compute = (
            model_cfg is not None
            and (
                (model_cfg.local_compute_cost_per_second is not None and model_cfg.local_compute_cost_per_second >= 0)
                or (model_cfg.local_compute_price_per_million is not None and model_cfg.local_compute_price_per_million >= 0)
            )
        )

        costs = [
            r.cost_usd for r in model_res_list if r.status == "success" and r.cost_usd is not None
        ]

        if execution_location == "local":
            provider_api_cost_usd = 0.0 if successful > 0 else None
            if has_configured_local_compute:
                comp_costs = [
                    r.local_compute_cost_usd for r in model_res_list if r.status == "success" and r.local_compute_cost_usd is not None
                ]
                if len(comp_costs) == successful and successful > 0:
                    local_compute_cost_usd = round(sum(comp_costs), 6)
                    total_cost_usd = round(local_compute_cost_usd, 6)
                    cost_per_q_usd = round(total_cost_usd / successful, 6)
                    unknown_cost_count = 0
                else:
                    local_compute_cost_usd = None
                    total_cost_usd = None
                    cost_per_q_usd = None
                    unknown_cost_count = successful
            else:
                # No local compute hardware rate configured -> compute cost and total cost are strictly unknown
                local_compute_cost_usd = None
                total_cost_usd = None
                cost_per_q_usd = None
                unknown_cost_count = successful
        elif execution_location == "remote":
            local_compute_cost_usd = 0.0 if successful > 0 else None
            unknown_cost_count = sum(
                1 for r in model_res_list if r.status == "success" and r.cost_usd is None
            )
            if unknown_cost_count == 0 and len(costs) == successful and successful > 0:
                total_cost_usd = round(sum(costs), 6)
                cost_per_q_usd = round(total_cost_usd / successful, 6)
                provider_api_cost_usd = total_cost_usd
            else:
                total_cost_usd = None
                cost_per_q_usd = None
                provider_api_cost_usd = None
        else:
            provider_api_cost_usd = None
            local_compute_cost_usd = None
            total_cost_usd = None
            cost_per_q_usd = None
            unknown_cost_count = successful

        model_metrics[model_id] = ModelScoringSummary(
            model_id=model_id,
            display_name=display_name,
            provider_type=provider_type,
            provider_model_id=provider_model_id,
            model_source=model_source,
            source_repo_id=source_repo_id,
            execution_provider=execution_provider,
            execution_location=execution_location,
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
            provider_api_cost_usd=provider_api_cost_usd,
            local_compute_cost_usd=local_compute_cost_usd,
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
