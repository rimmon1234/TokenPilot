"""Benchmark Execution Engine for running reproducible multi-model evaluations."""
import asyncio
import logging
import random
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Any
from app.config import settings
from app.schemas.gateway import GatewayChatRequest
from app.schemas.usage import PricingSnapshot
from app.schemas.dataset import TaskType, DatasetRecord
from app.schemas.evaluation import (
    BenchmarkRunCreate,
    BenchmarkRun,
    BenchmarkResult,
    BenchmarkRunStatus,
    BenchmarkRunProgress,
    BenchmarkModelConfig,
)
from app.services.gateway.runner import execute_internal_inference
from app.services.gateway.utils import calculate_estimated_cost
from app.services.benchmark.metadata_resolver import resolve_model_metadata, calculate_cost_breakdown
from app.services.dataset.storage import dataset_storage
from app.services.benchmark.storage import benchmark_storage
from app.core.network_validator import validate_outbound_url


logger = logging.getLogger(__name__)


class BenchmarkRunner:
    """Manages creation, execution, cancellation, and monitoring of multi-model benchmark runs."""

    def __init__(self, storage=None, dataset_store=None):
        self.storage = storage or benchmark_storage
        self.dataset_store = dataset_store or dataset_storage
        # In-memory tracking of active runs and cancellation signals
        self._active_runs: Dict[str, BenchmarkRun] = {}
        self._cancel_events: Dict[str, asyncio.Event] = {}
        self._active_tasks: Dict[str, asyncio.Task] = {}
        self._reconcile_orphaned_runs()

    def _reconcile_orphaned_runs(self) -> None:
        """Mark any runs left in PENDING or RUNNING status on server startup as CANCELLED."""
        try:
            saved_runs = self.storage.list_runs()
            for r in saved_runs:
                if r.status in (BenchmarkRunStatus.PENDING, BenchmarkRunStatus.RUNNING):
                    logger.warning("Reconciling orphaned benchmark run %s to CANCELLED.", r.id)
                    r.status = BenchmarkRunStatus.CANCELLED
                    r.completed_at = datetime.now(timezone.utc)
                    r.error_message = "Server restarted while benchmark run was in-flight."
                    self.storage.save_run(r)
        except Exception as ex:
            logger.debug("Failed to reconcile orphaned benchmark runs on startup: %s", ex)

    def validate_run_request(self, request: BenchmarkRunCreate) -> tuple[Any, List[DatasetRecord]]:
        """
        Validate dataset manifest, models, SSRF constraints, and split discipline.
        Returns (manifest, selected_records).
        """
        # 1. Verify dataset manifest exists
        manifest = self.dataset_store.get_manifest(request.dataset_manifest_id)
        if not manifest:
            raise ValueError(f"Dataset manifest '{request.dataset_manifest_id}' not found.")

        # 2. Enforce M4.2.1 scope: GSM8K supported, HumanEval code execution disallowed
        if manifest.task_type == TaskType.CODE_GENERATION:
            raise ValueError(
                "HumanEval code execution requires an isolated execution sandbox and is deferred to a future phase. "
                "GSM8K datasets are supported for multi-model evaluation in M4.2.1."
            )

        # 3. Validate models
        if not request.models:
            raise ValueError("At least one model configuration is required for a benchmark run.")

        model_ids = [m.model_id for m in request.models]
        if len(set(model_ids)) != len(model_ids):
            raise ValueError("Duplicate model IDs detected in benchmark run request.")

        for m in request.models:
            if not m.provider_model_id or not m.provider_model_id.strip():
                raise ValueError(f"Model '{m.display_name}' is missing a valid provider_model_id.")

            # SSRF validation on custom base URLs
            if m.base_url:
                is_valid, _, err = validate_outbound_url(
                    m.base_url, allow_local_network=settings.allow_local_network_tests
                )
                if not is_valid:
                    raise ValueError(f"Invalid base_url for model '{m.display_name}': {err}")

            # Disambiguate model source, runtime provider, location, and runtime model ID
            meta = resolve_model_metadata(m)
            if not m.model_source:
                m.model_source = meta["model_source"]
            if not m.source_repo_id:
                m.source_repo_id = meta["source_repo_id"]
            if not m.execution_provider:
                m.execution_provider = meta["execution_provider"]
            if not m.execution_location:
                m.execution_location = meta["execution_location"]
            if not m.provider_model_id:
                m.provider_model_id = meta["runtime_model_id"]

            # Ensure PricingSnapshot is attached if pricing information is present
            if not m.pricing_snapshot and (
                m.input_price_per_million is not None
                or m.output_price_per_million is not None
                or m.local_compute_cost_per_second is not None
                or m.local_compute_price_per_million is not None
            ):
                m.pricing_snapshot = PricingSnapshot(
                    input_price_per_million=m.input_price_per_million,
                    output_price_per_million=m.output_price_per_million,
                    pricing_source=m.pricing_source or "model_card",
                    local_compute_cost_per_second=m.local_compute_cost_per_second,
                    local_compute_price_per_million=m.local_compute_price_per_million,
                )

        # 4. Load canonical records
        all_records = self.dataset_store.get_records(request.dataset_manifest_id, limit=5000, offset=0)
        if not all_records:
            raise ValueError(f"No records found for dataset manifest '{request.dataset_manifest_id}'.")

        # 5. Deterministic subset sampling if requested
        if request.subset_size and request.subset_size < len(all_records):
            rnd = random.Random(request.seed)
            sampled_indices = sorted(rnd.sample(range(len(all_records)), request.subset_size))
            records = [all_records[i] for i in sampled_indices]
        else:
            records = all_records

        return manifest, records

    def start_benchmark_run(self, request: BenchmarkRunCreate) -> BenchmarkRun:
        """
        Validate request, initialize run metadata, and launch background evaluation loop.
        Returns the initial BenchmarkRun entity in PENDING status.
        """
        manifest, records = self.validate_run_request(request)

        run_id = f"run-{uuid.uuid4().hex[:10]}"
        total_evaluations = len(records) * len(request.models)

        # Create serialized run record (excluding credentials)
        run = BenchmarkRun(
            id=run_id,
            dataset_manifest_id=manifest.manifest_id,
            dataset_name=manifest.dataset_name,
            dataset_id=manifest.dataset_id,
            dataset_revision=manifest.source_revision,
            source_split=manifest.source_split,
            task_type=manifest.task_type,
            model_ids=[m.model_id for m in request.models],
            model_configs=request.models,
            status=BenchmarkRunStatus.PENDING,
            progress=BenchmarkRunProgress(total_items=total_evaluations),
            generation_settings=request.generation_settings,
            subset_size=request.subset_size,
            seed=request.seed,
            started_at=datetime.now(timezone.utc),
            results_summary={},
        )

        # Persist initial run to disk and track active state
        self.storage.save_run(run, results=[])
        self._active_runs[run_id] = run
        self._cancel_events[run_id] = asyncio.Event()

        # Launch evaluation loop in background
        task = asyncio.create_task(
            self._execute_evaluation_loop(
                run_id=run_id,
                manifest=manifest,
                records=records,
                models=request.models,
                settings=request.generation_settings,
            )
        )
        self._active_tasks[run_id] = task

        return run

    async def wait_for_run(self, run_id: str, timeout: float = 10.0) -> Optional[BenchmarkRun]:
        """Await completion of a benchmark background run task."""
        task = self._active_tasks.get(run_id)
        if task:
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
            except Exception:
                pass
        return self.get_run(run_id)

    async def _execute_evaluation_loop(
        self,
        run_id: str,
        manifest: Any,
        records: List[DatasetRecord],
        models: List[BenchmarkModelConfig],
        settings: Any,
    ) -> None:
        """Sequential multi-model benchmark evaluation loop with rate-limit and cancellation safeguards."""
        run = self._active_runs.get(run_id)
        if not run:
            return

        run.status = BenchmarkRunStatus.RUNNING
        self.storage.save_run(run)
        logger.info("Starting benchmark run %s (%d prompts × %d models)", run_id, len(records), len(models))

        cancel_ev = self._cancel_events.get(run_id)
        seen_result_ids: Set[str] = set()

        try:
            # Evaluate models sequentially to protect against provider rate limits
            for model_cfg in models:
                for record in records:
                    # Check for cancellation before each prompt execution
                    if cancel_ev and cancel_ev.is_set():
                        logger.info("Benchmark run %s received cancellation signal.", run_id)
                        run.status = BenchmarkRunStatus.CANCELLED
                        run.completed_at = datetime.now(timezone.utc)
                        self.storage.save_run(run)
                        return

                    # Update progress
                    run.progress.current_model_id = model_cfg.model_id
                    run.progress.current_record_id = record.record_id

                    # Deduplication check
                    res_id = f"res-{run_id}-{model_cfg.model_id}-{record.record_id}"
                    if res_id in seen_result_ids:
                        continue
                    seen_result_ids.add(res_id)

                    # Build GatewayChatRequest from canonical record
                    chat_req = GatewayChatRequest(
                        model_id=model_cfg.model_id,
                        model_display_name=model_cfg.display_name,
                        provider_type=model_cfg.provider_type,
                        execution_mode=model_cfg.execution_mode,
                        provider_model_id=model_cfg.provider_model_id,
                        base_url=model_cfg.base_url,
                        huggingface_repo_id=model_cfg.huggingface_repo_id,
                        messages=[{"role": m["role"], "content": m["content"]} for m in record.input_messages],
                        temperature=settings.temperature,
                        max_tokens=settings.max_tokens,
                        top_p=settings.top_p,
                        stream=True,
                        input_price_per_million=model_cfg.input_price_per_million,
                        output_price_per_million=model_cfg.output_price_per_million,
                        pricing_source=model_cfg.pricing_source,
                    )

                    credential_val = (
                        model_cfg.transient_credential.get_secret_value()
                        if model_cfg.transient_credential
                        else None
                    )

                    # Execute in-process via existing provider adapter
                    inf_res = await execute_internal_inference(chat_req, credential=credential_val)

                    # Resolve model metadata and calculate truthful multi-dimensional cost breakdown
                    meta = resolve_model_metadata(model_cfg)
                    loc = model_cfg.execution_location or meta["execution_location"]

                    cost_breakdown = calculate_cost_breakdown(
                        execution_location=loc,
                        prompt_tokens=inf_res.prompt_tokens,
                        completion_tokens=inf_res.completion_tokens,
                        total_tokens=inf_res.total_tokens,
                        latency_ms=inf_res.latency_ms,
                        input_price_per_million=model_cfg.input_price_per_million,
                        output_price_per_million=model_cfg.output_price_per_million,
                        local_compute_cost_per_second=model_cfg.local_compute_cost_per_second,
                        local_compute_price_per_million=model_cfg.local_compute_price_per_million,
                        pricing_source=model_cfg.pricing_source,
                    )

                    # Construct normalized BenchmarkResult
                    result = BenchmarkResult(
                        id=res_id,
                        run_id=run_id,
                        dataset_manifest_id=manifest.manifest_id,
                        dataset_id=manifest.dataset_id,
                        dataset_revision=manifest.source_revision,
                        source_split=manifest.source_split,
                        record_id=record.record_id,
                        content_hash=record.content_hash,
                        model_id=model_cfg.model_id,
                        provider_model_id=model_cfg.provider_model_id,
                        model_display_name=model_cfg.display_name,
                        model_source=model_cfg.model_source or meta["model_source"],
                        source_repo_id=model_cfg.source_repo_id or meta["source_repo_id"],
                        execution_provider=model_cfg.execution_provider or meta["execution_provider"],
                        execution_location=loc,
                        status="success" if inf_res.success else "failed",
                        prompt_text=record.input_messages[0]["content"],
                        reference_answer=record.reference_answer,
                        reference_metadata=record.reference_metadata,
                        output_text=inf_res.output_text,
                        prompt_tokens=inf_res.prompt_tokens,
                        completion_tokens=inf_res.completion_tokens,
                        total_tokens=inf_res.total_tokens,
                        token_provenance=inf_res.token_provenance,
                        latency_ms=inf_res.latency_ms,
                        ttft_ms=inf_res.ttft_ms,
                        finish_reason=inf_res.finish_reason,
                        pricing_snapshot=model_cfg.pricing_snapshot,
                        provider_api_cost_usd=cost_breakdown["provider_api_cost_usd"],
                        local_compute_cost_usd=cost_breakdown["local_compute_cost_usd"],
                        cost_usd=cost_breakdown["total_cost_usd"],
                        error_message=inf_res.error_message,
                        error_category=inf_res.error_category,
                        score=None,  # Reserved for M4.2.2!
                        metric_name="exact_numeric_match" if manifest.task_type == TaskType.MATH_REASONING else None,
                    )

                    # Persist result record
                    self.storage.append_result(run_id, result)

                    # Update counters
                    if inf_res.success:
                        run.progress.completed_items += 1
                    else:
                        run.progress.failed_items += 1

            # Finalize run status
            run.completed_at = datetime.now(timezone.utc)
            run.progress.current_model_id = None
            run.progress.current_record_id = None

            if cancel_ev and cancel_ev.is_set():
                run.status = BenchmarkRunStatus.CANCELLED
            elif run.progress.failed_items == 0:
                run.status = BenchmarkRunStatus.COMPLETED
            elif run.progress.completed_items > 0:
                run.status = BenchmarkRunStatus.COMPLETED_WITH_ERRORS
            else:
                run.status = BenchmarkRunStatus.FAILED

            run.results_summary = {
                "total_evaluations": run.progress.completed_items + run.progress.failed_items,
                "successful_evaluations": run.progress.completed_items,
                "failed_evaluations": run.progress.failed_items,
                "evaluated_models": run.model_ids,
                "scoring_state": "ready_for_scoring",
            }
            self.storage.save_run(run)
            logger.info("Benchmark run %s finished with status: %s", run_id, run.status.value)

        except asyncio.CancelledError:
            logger.info("Benchmark run %s task was cancelled.", run_id)
            run.status = BenchmarkRunStatus.CANCELLED
            run.completed_at = datetime.now(timezone.utc)
            run.progress.current_model_id = None
            run.progress.current_record_id = None
            self.storage.save_run(run)
        except Exception as ex:
            logger.error("Unexpected error in benchmark execution loop %s: %s", run_id, ex, exc_info=True)
            run.status = BenchmarkRunStatus.FAILED
            run.error_message = str(ex)
            run.completed_at = datetime.now(timezone.utc)
            run.progress.current_model_id = None
            run.progress.current_record_id = None
            self.storage.save_run(run)
        finally:
            self._cancel_events.pop(run_id, None)
            self._active_tasks.pop(run_id, None)
            self._active_runs.pop(run_id, None)

    def cancel_run(self, run_id: str) -> bool:
        """Trigger cancellation for an in-flight benchmark run."""
        # 1. Active in-memory cancellation
        if run_id in self._cancel_events:
            self._cancel_events[run_id].set()
            task = self._active_tasks.get(run_id)
            if task and not task.done():
                task.cancel()
            run = self._active_runs.get(run_id)
            if run:
                run.status = BenchmarkRunStatus.CANCELLED
                run.completed_at = datetime.now(timezone.utc)
                run.progress.current_model_id = None
                run.progress.current_record_id = None
                self.storage.save_run(run)
            return True

        # 2. Check if saved run can be marked cancelled
        saved_run = self.storage.get_run(run_id)
        if saved_run and saved_run.status in (BenchmarkRunStatus.PENDING, BenchmarkRunStatus.RUNNING):
            saved_run.status = BenchmarkRunStatus.CANCELLED
            saved_run.completed_at = datetime.now(timezone.utc)
            saved_run.progress.current_model_id = None
            saved_run.progress.current_record_id = None
            self.storage.save_run(saved_run)
            if run_id in self._active_runs:
                self._active_runs[run_id] = saved_run
            return True

        # 3. Already cancelled (idempotent success)
        if saved_run and saved_run.status == BenchmarkRunStatus.CANCELLED:
            return True

        return False

    def get_run(self, run_id: str) -> Optional[BenchmarkRun]:
        """Get live progress or saved run metadata."""
        if run_id in self._active_runs:
            return self._active_runs[run_id]
        return self.storage.get_run(run_id)

    def list_runs(self) -> List[BenchmarkRun]:
        """List all saved and active benchmark runs."""
        saved_runs = self.storage.list_runs()
        # Merge with in-memory active runs if not yet written
        saved_dict = {r.id: r for r in saved_runs}
        for run_id, active_run in self._active_runs.items():
            saved_dict[run_id] = active_run

        all_runs = list(saved_dict.values())
        all_runs.sort(key=lambda r: r.started_at, reverse=True)
        return all_runs


benchmark_runner = BenchmarkRunner()
