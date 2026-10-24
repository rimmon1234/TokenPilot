"""Storage manager for BenchmarkRun metadata and canonical BenchmarkResult records."""
import json
import logging
from pathlib import Path
from typing import List, Optional
from app.config import settings
from app.schemas.evaluation import BenchmarkRun, BenchmarkResult

logger = logging.getLogger(__name__)


class BenchmarkStorageManager:
    """Manages persistence of benchmark run metadata (.run.json) and results (.results.jsonl)."""

    def __init__(self, storage_dir: Optional[str] = None):
        self.storage_dir = Path(storage_dir or settings.benchmark_runs_storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    def _run_path(self, run_id: str) -> Path:
        safe_id = Path(run_id).name
        return self.storage_dir / f"{safe_id}.run.json"

    def _results_path(self, run_id: str) -> Path:
        safe_id = Path(run_id).name
        return self.storage_dir / f"{safe_id}.results.jsonl"

    def save_run(
        self, run: BenchmarkRun, results: Optional[List[BenchmarkResult]] = None
    ) -> None:
        """Write run metadata and optional initial results to disk atomically."""
        import os
        run_file = self._run_path(run.id)
        tmp_run = run_file.with_suffix(".json.tmp")
        try:
            with open(tmp_run, "w", encoding="utf-8") as rf:
                rf.write(run.model_dump_json(indent=2))
                rf.flush()
                os.fsync(rf.fileno())
            os.replace(tmp_run, run_file)
        finally:
            if tmp_run.exists():
                try:
                    tmp_run.unlink()
                except OSError:
                    pass

        if results is not None:
            self.save_results_atomic(run.id, results)

    def save_results_atomic(self, run_id: str, results: List[BenchmarkResult]) -> None:
        """
        Atomically persist all BenchmarkResult records for a run to prevent partial write corruption.
        Writes to a temporary file first and replaces the target file via os.replace.
        """
        import os
        results_file = self._results_path(run_id)
        tmp_file = results_file.with_suffix(".jsonl.tmp")
        try:
            with open(tmp_file, "w", encoding="utf-8") as res_f:
                for res in results:
                    res_f.write(res.model_dump_json() + "\n")
                res_f.flush()
                os.fsync(res_f.fileno())
            os.replace(tmp_file, results_file)
        finally:
            if tmp_file.exists():
                try:
                    tmp_file.unlink()
                except OSError:
                    pass

    def append_result(self, run_id: str, result: BenchmarkResult) -> None:
        """Append a single evaluated BenchmarkResult record to the run's .results.jsonl file."""
        results_file = self._results_path(run_id)
        with open(results_file, "a", encoding="utf-8") as res_f:
            res_f.write(result.model_dump_json() + "\n")

    def get_run(self, run_id: str) -> Optional[BenchmarkRun]:
        """Load a benchmark run by ID from disk."""
        run_file = self._run_path(run_id)
        if not run_file.exists():
            return None

        try:
            with open(run_file, "r", encoding="utf-8") as rf:
                data = json.load(rf)
                return BenchmarkRun.model_validate(data)
        except Exception as err:
            logger.error("Failed to load benchmark run %s: %s", run_id, err)
            return None

    def list_runs(self) -> List[BenchmarkRun]:
        """List all saved benchmark runs, ordered by start time descending."""
        runs: List[BenchmarkRun] = []
        if not self.storage_dir.exists():
            return runs

        for f in self.storage_dir.glob("*.run.json"):
            try:
                with open(f, "r", encoding="utf-8") as rf:
                    data = json.load(rf)
                    runs.append(BenchmarkRun.model_validate(data))
            except Exception as err:
                logger.warning("Failed to parse benchmark run file %s: %s", f, err)

        runs.sort(key=lambda r: r.started_at, reverse=True)
        return runs

    def get_results(
        self, run_id: str, limit: int = 50, offset: int = 0
    ) -> List[BenchmarkResult]:
        """Read a slice of benchmark evaluation results for a run."""
        results_file = self._results_path(run_id)
        if not results_file.exists():
            return []

        results: List[BenchmarkResult] = []
        current_idx = 0
        target_end = offset + limit

        with open(results_file, "r", encoding="utf-8") as rf:
            for line in rf:
                line = line.strip()
                if not line:
                    continue
                if current_idx >= offset and current_idx < target_end:
                    try:
                        res_dict = json.loads(line)
                        results.append(BenchmarkResult.model_validate(res_dict))
                    except Exception as err:
                        logger.warning("Failed parsing benchmark result line %d: %s", current_idx, err)
                current_idx += 1
                if current_idx >= target_end:
                    break

        return results

    def get_all_results(self, run_id: str) -> List[BenchmarkResult]:
        """Read all canonical benchmark evaluation results for a run."""
        results_file = self._results_path(run_id)
        if not results_file.exists():
            return []

        results: List[BenchmarkResult] = []
        with open(results_file, "r", encoding="utf-8") as rf:
            for idx, line in enumerate(rf):
                line = line.strip()
                if not line:
                    continue
                try:
                    res_dict = json.loads(line)
                    results.append(BenchmarkResult.model_validate(res_dict))
                except Exception as err:
                    logger.warning("Failed parsing benchmark result line %d: %s", idx, err)

        return results

    def delete_run(self, run_id: str) -> bool:
        """Delete run metadata and results files."""
        run_file = self._run_path(run_id)
        results_file = self._results_path(run_id)

        deleted = False
        if run_file.exists():
            run_file.unlink()
            deleted = True
        if results_file.exists():
            results_file.unlink()
            deleted = True

        return deleted


benchmark_storage = BenchmarkStorageManager()
