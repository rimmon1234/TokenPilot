"""FastAPI router for Multi-Model Benchmark Execution Engine."""
import logging
from typing import List
from fastapi import APIRouter, HTTPException, Query, status
from app.schemas.evaluation import (
    BenchmarkRunCreate,
    BenchmarkRunUpdate,
    BenchmarkRun,
    BenchmarkResult,
)
from app.services.benchmark import (
    benchmark_runner,
    benchmark_storage,
    calculate_benchmark_scores,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/benchmarks", tags=["Benchmarks"])


@router.post("/runs", response_model=BenchmarkRun, status_code=status.HTTP_201_CREATED)
async def create_benchmark_run(request: BenchmarkRunCreate):
    """
    Initiate a reproducible multi-model benchmark evaluation run against a dataset manifest.
    Validates manifest, model eligibility, SSRF boundaries, and deterministic sampling parameters.
    """
    try:
        run = benchmark_runner.start_benchmark_run(request)
        return run
    except ValueError as err:
        logger.warning("Benchmark run validation error: %s", err)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(err),
        )
    except Exception as err:
        logger.error("Failed to start benchmark run: %s", err, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error starting benchmark run: {str(err)}",
        )


@router.get("/runs", response_model=List[BenchmarkRun])
async def list_benchmark_runs():
    """List all benchmark evaluation runs ordered by recency."""
    return benchmark_runner.list_runs()


@router.get("/runs/{run_id}", response_model=BenchmarkRun)
async def get_benchmark_run(run_id: str):
    """Retrieve metadata, current progress, and summary for a benchmark run."""
    run = benchmark_runner.get_run(run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Benchmark run '{run_id}' not found.",
        )
    return run


@router.patch("/runs/{run_id}", response_model=BenchmarkRun)
async def update_benchmark_run(run_id: str, request: BenchmarkRunUpdate):
    """
    Update explicitly permitted metadata fields of an existing benchmark run (such as display_name).
    Does not modify benchmark results, dataset manifests, scoring summaries, or model configs.
    """
    run = benchmark_runner.get_run(run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Benchmark run '{run_id}' not found.",
        )

    run.display_name = request.display_name
    benchmark_storage.save_run(run)

    if run_id in benchmark_runner._active_runs:
        benchmark_runner._active_runs[run_id] = run

    return run


@router.get("/runs/{run_id}/results", response_model=List[BenchmarkResult])
async def get_benchmark_run_results(
    run_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Read paginated canonical benchmark evaluation results for a run."""
    run = benchmark_runner.get_run(run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Benchmark run '{run_id}' not found.",
        )

    results = benchmark_storage.get_results(run_id, limit=limit, offset=offset)
    return results


@router.post("/runs/{run_id}/cancel", response_model=BenchmarkRun)
async def cancel_benchmark_run(run_id: str):
    """Signal cancellation for an active or queued benchmark run."""
    success = benchmark_runner.cancel_run(run_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Benchmark run '{run_id}' not found or cannot be cancelled.",
        )
    run = benchmark_runner.get_run(run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Benchmark run '{run_id}' not found after cancellation.",
        )
    return run


@router.delete("/runs/{run_id}")
async def delete_benchmark_run(run_id: str):
    """
    Permanently delete a completed or stopped benchmark run and its results.
    Active (running/pending) runs cannot be deleted; cancel them first.
    """
    run = benchmark_runner.get_run(run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Benchmark run '{run_id}' not found.",
        )

    if run.status in ["running", "pending"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete an active benchmark run (current status: '{run.status}'). Cancel the run first.",
        )

    # Remove from runner memory cache if present
    if run_id in benchmark_runner._active_runs:
        del benchmark_runner._active_runs[run_id]

    deleted = benchmark_storage.delete_run(run_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Benchmark run '{run_id}' files not found on disk.",
        )

    return {"status": "deleted", "run_id": run_id}


@router.post("/runs/{run_id}/score", response_model=BenchmarkRun)
async def score_benchmark_run(run_id: str):
    """
    Evaluate persisted benchmark responses against canonical ground-truth reference answers.
    Operates strictly in-process and never makes external model API calls.
    Updates BenchmarkResult scores and run results_summary metrics atomically.
    """
    run = benchmark_runner.get_run(run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Benchmark run '{run_id}' not found.",
        )

    # Validate task compatibility (GSM8K math reasoning)
    if run.task_type != "math_reasoning" and run.dataset_id.lower() != "gsm8k":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Run '{run_id}' has task_type '{run.task_type}' which is not compatible with GSM8K numerical scoring.",
        )

    if run.status in ["running", "pending"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot score an active benchmark run (current status: '{run.status}'). Wait for completion or cancel the run first.",
        )

    # Load all persisted results for this run
    results = benchmark_storage.get_all_results(run_id)

    # Score deterministically without calling any provider
    updated_run, evaluated_results = calculate_benchmark_scores(run, results)

    # Atomically persist evaluated results and updated run metadata
    benchmark_storage.save_results_atomic(run_id, evaluated_results)
    benchmark_storage.save_run(updated_run)

    # Sync runner cache if present
    if run_id in benchmark_runner._active_runs:
        benchmark_runner._active_runs[run_id] = updated_run

    return updated_run


@router.get("/runs/{run_id}/export")
async def export_benchmark_run(
    run_id: str,
    format: str = Query("json", pattern="^(json|csv)$"),
):
    """
    Export comprehensive benchmark evaluation report in JSON or CSV format.
    Includes reproducibility metadata, model comparison summaries, and result-level records.
    Strictly excludes API keys, credentials, and transient secrets.
    """
    import io
    import csv
    from datetime import datetime, timezone
    from fastapi.responses import Response, JSONResponse

    run = benchmark_runner.get_run(run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Benchmark run '{run_id}' not found.",
        )

    results = benchmark_storage.get_all_results(run_id)

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

        # 1. Metadata Header
        writer.writerow(["# TokenPilot Benchmark Evaluation Report"])
        writer.writerow(["# Benchmark Name", run.display_name or run.id])
        writer.writerow(["# Run ID", run.id])
        writer.writerow(["# Dataset", f"{run.dataset_name} ({run.dataset_id})"])
        writer.writerow(["# Revision", run.dataset_revision])
        writer.writerow(["# Source Split", run.source_split])
        writer.writerow(["# Task Type", run.task_type])
        writer.writerow(["# Seed", run.seed])
        writer.writerow(["# Subset Size", run.subset_size or "Full"])
        writer.writerow(["# Temperature", run.generation_settings.temperature])
        writer.writerow(["# Started At", str(run.started_at)])
        writer.writerow(["# Completed At", str(run.completed_at or "")])
        writer.writerow(["# Status", run.status])
        writer.writerow([])

        # 2. Section: Model Comparison Summary
        writer.writerow(["[Model Comparison Summary]"])
        writer.writerow([
            "Model ID",
            "Display Name",
            "Model Source",
            "Source Repo ID",
            "Execution Provider",
            "Execution Location",
            "Runtime Model ID",
            "Attempted Questions",
            "Successful Generations",
            "Correct Answers",
            "Incorrect Answers",
            "Unparseable Answers",
            "Failed Requests",
            "Scorable Accuracy",
            "End-to-End Accuracy",
            "Avg Latency (ms)",
            "Median Latency (ms)",
            "Avg TTFT (ms)",
            "Total Prompt Tokens",
            "Total Completion Tokens",
            "Total Tokens",
            "Token Provenance",
            "Provider API Cost (USD)",
            "Local Compute Cost (USD)",
            "Total Cost (USD)",
            "Cost Per Question (USD)",
            "Pricing Source",
            "Pareto Efficient",
        ])

        model_metrics = (
            run.results_summary.get("model_metrics", {})
            if isinstance(run.results_summary, dict)
            else {}
        )
        for m_id, m_data in model_metrics.items():
            writer.writerow([
                m_id,
                m_data.get("display_name", m_id),
                m_data.get("model_source", ""),
                m_data.get("source_repo_id", "") or "",
                m_data.get("execution_provider") or m_data.get("provider_type", ""),
                m_data.get("execution_location", ""),
                m_data.get("provider_model_id", ""),
                m_data.get("attempted_questions", 0),
                m_data.get("successful_generations", 0),
                m_data.get("correct_answers", 0),
                m_data.get("incorrect_answers", 0),
                m_data.get("unparseable_answers", 0),
                m_data.get("failed_requests", 0),
                m_data.get("scorable_accuracy") if m_data.get("scorable_accuracy") is not None else "",
                m_data.get("end_to_end_accuracy") if m_data.get("end_to_end_accuracy") is not None else "",
                m_data.get("avg_latency_ms") if m_data.get("avg_latency_ms") is not None else "",
                m_data.get("median_latency_ms") if m_data.get("median_latency_ms") is not None else "",
                m_data.get("avg_ttft_ms") if m_data.get("avg_ttft_ms") is not None else "",
                m_data.get("total_prompt_tokens") if m_data.get("total_prompt_tokens") is not None else "",
                m_data.get("total_completion_tokens") if m_data.get("total_completion_tokens") is not None else "",
                m_data.get("total_tokens") if m_data.get("total_tokens") is not None else "",
                m_data.get("token_provenance", "unavailable"),
                m_data.get("provider_api_cost_usd") if m_data.get("provider_api_cost_usd") is not None else "",
                m_data.get("local_compute_cost_usd") if m_data.get("local_compute_cost_usd") is not None else "",
                m_data.get("total_cost_usd") if m_data.get("total_cost_usd") is not None else "",
                m_data.get("cost_per_question_usd") if m_data.get("cost_per_question_usd") is not None else "",
                m_data.get("pricing_source", ""),
                m_data.get("is_pareto_efficient") if m_data.get("is_pareto_efficient") is not None else "",
            ])
        writer.writerow([])

        # 3. Section: Detailed Evaluation Results
        writer.writerow(["[Detailed Evaluation Results]"])
        writer.writerow([
            "Result ID",
            "Record ID",
            "Model ID",
            "Model Display Name",
            "Model Source",
            "Execution Provider",
            "Execution Location",
            "Runtime Model ID",
            "Status",
            "Evaluation Status",
            "Score",
            "Extracted Answer",
            "Reference Answer",
            "Prompt Text",
            "Output Text",
            "Latency (ms)",
            "TTFT (ms)",
            "Prompt Tokens",
            "Completion Tokens",
            "Total Tokens",
            "Token Provenance",
            "Provider API Cost (USD)",
            "Local Compute Cost (USD)",
            "Total Cost (USD)",
            "Error Category",
            "Error Message",
        ])
        for r in results:
            eval_status_str = (
                r.evaluation_status.value
                if hasattr(r.evaluation_status, "value")
                else str(r.evaluation_status)
            )
            writer.writerow([
                r.id,
                r.record_id,
                r.model_id,
                r.model_display_name,
                r.model_source or "",
                r.execution_provider or "",
                r.execution_location or "",
                r.provider_model_id,
                r.status,
                eval_status_str,
                r.score if r.score is not None else "",
                r.extracted_answer or "",
                r.reference_answer or "",
                r.prompt_text or "",
                r.output_text or "",
                r.latency_ms,
                r.ttft_ms if r.ttft_ms is not None else "",
                r.prompt_tokens if r.prompt_tokens is not None else "",
                r.completion_tokens if r.completion_tokens is not None else "",
                r.total_tokens if r.total_tokens is not None else "",
                r.token_provenance or "",
                r.provider_api_cost_usd if r.provider_api_cost_usd is not None else "",
                r.local_compute_cost_usd if r.local_compute_cost_usd is not None else "",
                r.cost_usd if r.cost_usd is not None else "",
                r.error_category or "",
                r.error_message or "",
            ])

        csv_content = output.getvalue()
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="benchmark_report_{run_id}.csv"',
                "Content-Type": "text/csv; charset=utf-8",
            },
        )

    # JSON export
    report = {
        "report_type": "tokenpilot_benchmark_report",
        "export_version": "1.0",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "run_metadata": {
            "run_id": run.id,
            "display_name": run.display_name,
            "dataset_id": run.dataset_id,
            "dataset_name": run.dataset_name,
            "dataset_revision": run.dataset_revision,
            "source_split": run.source_split,
            "task_type": run.task_type,
            "subset_size": run.subset_size,
            "seed": run.seed,
            "generation_settings": run.generation_settings.model_dump(),
            "status": run.status,
            "started_at": (
                run.started_at.isoformat()
                if hasattr(run.started_at, "isoformat")
                else str(run.started_at)
            ),
            "completed_at": (
                run.completed_at.isoformat()
                if run.completed_at and hasattr(run.completed_at, "isoformat")
                else (str(run.completed_at) if run.completed_at else None)
            ),
            "tested_record_ids": sorted(list({r.record_id for r in results})),
        },
        "model_configs": [
            {
                "model_id": cfg.model_id,
                "display_name": cfg.display_name,
                "model_source": cfg.model_source,
                "source_repo_id": cfg.source_repo_id or cfg.huggingface_repo_id,
                "execution_provider": cfg.execution_provider or cfg.provider_type,
                "execution_location": cfg.execution_location or ("local" if "local" in str(cfg.execution_mode) else "remote"),
                "runtime_model_id": cfg.provider_model_id,
                "provider_type": cfg.provider_type,
                "provider_model_id": cfg.provider_model_id,
                "pricing_source": cfg.pricing_source,
                "input_price_per_million": cfg.input_price_per_million,
                "output_price_per_million": cfg.output_price_per_million,
                "local_compute_cost_per_second": cfg.local_compute_cost_per_second,
                "local_compute_price_per_million": cfg.local_compute_price_per_million,
            }
            for cfg in run.model_configs
        ],
        "scoring_summary": run.results_summary,
        "results": [
            {
                "id": r.id,
                "record_id": r.record_id,
                "model_id": r.model_id,
                "model_display_name": r.model_display_name,
                "model_source": r.model_source,
                "source_repo_id": r.source_repo_id,
                "execution_provider": r.execution_provider,
                "execution_location": r.execution_location,
                "provider_model_id": r.provider_model_id,
                "status": r.status,
                "evaluation_status": (
                    r.evaluation_status.value
                    if hasattr(r.evaluation_status, "value")
                    else str(r.evaluation_status)
                ),
                "score": r.score,
                "metric_name": r.metric_name,
                "extracted_answer": r.extracted_answer,
                "reference_answer": r.reference_answer,
                "prompt_text": r.prompt_text,
                "output_text": r.output_text,
                "latency_ms": r.latency_ms,
                "ttft_ms": r.ttft_ms,
                "prompt_tokens": r.prompt_tokens,
                "completion_tokens": r.completion_tokens,
                "total_tokens": r.total_tokens,
                "token_provenance": r.token_provenance,
                "provider_api_cost_usd": r.provider_api_cost_usd,
                "local_compute_cost_usd": r.local_compute_cost_usd,
                "cost_usd": r.cost_usd,
                "error_category": r.error_category,
                "error_message": r.error_message,
            }
            for r in results
        ],
    }

    return JSONResponse(
        content=report,
        headers={
            "Content-Disposition": f'attachment; filename="benchmark_report_{run_id}.json"'
        },
    )

