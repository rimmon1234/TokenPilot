"""FastAPI router for Multi-Model Benchmark Execution Engine."""
import logging
from typing import List
from fastapi import APIRouter, HTTPException, Query, status
from app.schemas.evaluation import (
    BenchmarkRunCreate,
    BenchmarkRun,
    BenchmarkResult,
)
from app.services.benchmark import benchmark_runner, benchmark_storage

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


@router.post("/runs/{run_id}/cancel")
async def cancel_benchmark_run(run_id: str):
    """Signal cancellation for an active or queued benchmark run."""
    success = benchmark_runner.cancel_run(run_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Benchmark run '{run_id}' not found or cannot be cancelled.",
        )
    return {"status": "cancelled", "run_id": run_id}
