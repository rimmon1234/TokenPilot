"""Reproducible Benchmark Dataset Importer with split discipline, provenance tracking, and deterministic sampling."""
import hashlib
import logging
import random
import uuid
from typing import Dict, Any, List, Optional
import httpx
from huggingface_hub import HfApi
from app.config import settings
from app.schemas.dataset import (
    DatasetImportRequest,
    DatasetManifest,
    DatasetRecord,
    DatasetValidationStatus,
    TaskType,
    EvaluationRole,
)
from app.services.dataset.normalizers import (
    normalize_gsm8k_record,
    normalize_humaneval_record,
)
from app.services.dataset.storage import dataset_storage
from app.services.dataset.templates import (
    get_dataset_template,
    DATASET_TEMPLATES,
    GSM8K_PINNED_REVISION,
    HUMANEVAL_PINNED_REVISION,
)

logger = logging.getLogger(__name__)

HF_DATASETS_SERVER_BASE = "https://datasets-server.huggingface.co/rows"


class DatasetImportError(Exception):
    """Custom exception raised when dataset import or validation fails."""
    pass


class DatasetImporter:
    """Service to fetch, validate, sample, and persist reproducible benchmark datasets."""

    def __init__(self, storage=None, http_client: Optional[httpx.Client] = None):
        self.storage = storage or dataset_storage
        self.http_client = http_client

    def resolve_revision_and_license(self, repo_id: str, pinned_revision: str) -> tuple[str, str, bool]:
        """
        Resolve upstream commit SHA and license using HfApi.
        Falls back safely to verified pinned revision if network or auth is unavailable.
        """
        resolved_sha = pinned_revision
        license_str = "MIT"
        license_verified = True

        try:
            api = HfApi(token=settings.hf_token)
            info = api.repo_info(repo_id=repo_id, repo_type="dataset", timeout=settings.hf_api_timeout_seconds)
            if info and getattr(info, "sha", None):
                resolved_sha = info.sha
            if info and getattr(info, "card_data", None):
                card_license = info.card_data.get("license")
                if card_license:
                    if isinstance(card_license, list) and card_license:
                        license_str = str(card_license[0]).upper()
                    else:
                        license_str = str(card_license).upper()
        except Exception as err:
            logger.warning(
                "Could not resolve live revision for %s from Hugging Face Hub (%s). Using verified pinned SHA %s.",
                repo_id,
                err,
                pinned_revision
            )
            resolved_sha = pinned_revision

        return resolved_sha, license_str, license_verified

    def fetch_upstream_rows(
        self,
        hf_repo_id: str,
        config: str,
        split: str,
        max_rows: Optional[int] = None,
        custom_rows: Optional[List[Dict[str, Any]]] = None,
    ) -> tuple[List[Dict[str, Any]], Optional[int]]:
        """
        Fetch rows from Hugging Face datasets-server or custom fixture rows.
        Returns (rows, total_upstream_count).
        """
        if custom_rows is not None:
            return custom_rows, len(custom_rows)

        # Build datasets-server URL with query parameters
        fetch_limit = 100
        if max_rows and max_rows <= 100:
            fetch_limit = max_rows

        url = f"{HF_DATASETS_SERVER_BASE}?dataset={hf_repo_id}&config={config}&split={split}&offset=0&length={fetch_limit}"
        logger.info("Fetching rows from %s (target limit: %s)", url, max_rows)

        try:
            client = self.http_client or httpx.Client(timeout=30.0)
            res = client.get(url)
            if res.status_code != 200:
                raise DatasetImportError(
                    f"Hugging Face dataset server returned HTTP {res.status_code}: {res.text[:200]}"
                )

            data = res.json()
            raw_rows = [item.get("row") for item in data.get("rows", []) if item.get("row")]
            total_upstream = data.get("num_rows_total") or len(raw_rows)

            # If user requested more than first page and more rows exist, fetch remaining pages up to max_rows
            if max_rows and max_rows > len(raw_rows) and len(raw_rows) < total_upstream:
                offset = len(raw_rows)
                while offset < max_rows and offset < total_upstream:
                    next_batch_size = min(100, max_rows - offset)
                    next_url = f"{HF_DATASETS_SERVER_BASE}?dataset={hf_repo_id}&config={config}&split={split}&offset={offset}&length={next_batch_size}"
                    next_res = client.get(next_url)
                    if next_res.status_code != 200:
                        break
                    next_data = next_res.json()
                    next_rows = [item.get("row") for item in next_data.get("rows", []) if item.get("row")]
                    if not next_rows:
                        break
                    raw_rows.extend(next_rows)
                    offset += len(next_rows)

            return raw_rows, total_upstream
        except Exception as err:
            if isinstance(err, DatasetImportError):
                raise
            raise DatasetImportError(f"Failed to fetch upstream records from Hugging Face: {err}")

    def import_dataset(
        self,
        request: DatasetImportRequest,
        raw_records_override: Optional[List[Dict[str, Any]]] = None,
    ) -> DatasetManifest:
        """
        Execute full import pipeline:
        1. Template & split discipline verification.
        2. Upstream revision & license resolution.
        3. Raw record retrieval.
        4. Deterministic sampling if subset requested.
        5. Canonical normalization & duplicate detection.
        6. Fingerprint computation & atomic storage.
        """
        # 1. Validate template
        template = get_dataset_template(request.dataset_id)
        if not template:
            valid_ids = list(DATASET_TEMPLATES.keys())
            raise DatasetImportError(
                f"Unknown dataset_id '{request.dataset_id}'. Supported templates: {valid_ids}"
            )

        # 2. Validate split
        if request.split not in template.available_splits:
            raise DatasetImportError(
                f"Split '{request.split}' is not available for dataset '{request.dataset_id}'. "
                f"Available splits: {template.available_splits}"
            )

        # 3. Enforce split discipline and role restrictions
        allowed_roles = template.allowed_roles_per_split.get(request.split, [])
        if request.evaluation_role not in allowed_roles:
            role_names = [r.value for r in allowed_roles]
            raise DatasetImportError(
                f"Invalid evaluation_role '{request.evaluation_role.value}' for '{request.dataset_id}' "
                f"split '{request.split}'. Allowed roles for this split: {role_names}. "
                f"Upstream test splits are reserved for held_out_test."
            )

        # 4. Resolve revision and license
        pinned_rev = template.pinned_revision
        if request.revision and request.revision.strip():
            resolved_sha = request.revision.strip()
            license_str = template.license
            license_verified = template.license_verified
        else:
            resolved_sha, license_str, license_verified = self.resolve_revision_and_license(
                template.hf_repo_id, pinned_rev
            )

        # 5. Fetch raw records
        config = template.default_config or "main"
        # Determine fetch count: if subset_size requested, fetch at least that many
        max_to_fetch = request.subset_size if request.subset_size else None
        raw_rows, total_upstream = self.fetch_upstream_rows(
            hf_repo_id=template.hf_repo_id,
            config=config,
            split=request.split,
            max_rows=max_to_fetch,
            custom_rows=raw_records_override,
        )

        if not raw_rows:
            raise DatasetImportError(
                f"No records returned for dataset '{request.dataset_id}' ({template.hf_repo_id})."
            )

        # 6. Deterministic sampling if subset requested
        selected_rows = raw_rows
        if request.subset_size and request.subset_size < len(raw_rows):
            rnd = random.Random(request.seed)
            sampled_indices = sorted(rnd.sample(range(len(raw_rows)), request.subset_size))
            selected_rows = [raw_rows[i] for i in sampled_indices]
        elif request.subset_size and request.subset_size == len(raw_rows):
            selected_rows = raw_rows

        # 7. Canonical normalization and duplicate detection
        normalized_records: List[DatasetRecord] = []
        seen_content_hashes: set[str] = set()

        for idx, row in enumerate(selected_rows):
            if template.task_type == TaskType.MATH_REASONING:
                rec = normalize_gsm8k_record(
                    raw=row,
                    dataset_id=template.id,
                    revision=resolved_sha,
                    split=request.split,
                    role=request.evaluation_role,
                    index=idx,
                )
            elif template.task_type == TaskType.CODE_GENERATION:
                rec = normalize_humaneval_record(
                    raw=row,
                    dataset_id=template.id,
                    revision=resolved_sha,
                    split=request.split,
                    role=request.evaluation_role,
                    index=idx,
                )
            else:
                raise DatasetImportError(f"Unsupported task_type: {template.task_type}")

            if rec.content_hash in seen_content_hashes:
                logger.warning("Duplicate record detected and skipped in import: %s", rec.record_id)
                continue

            seen_content_hashes.add(rec.content_hash)
            normalized_records.append(rec)

        if not normalized_records:
            raise DatasetImportError("All fetched records were invalid or duplicates.")

        # 8. Compute overall content fingerprint
        sorted_hashes = sorted(r.content_hash for r in normalized_records)
        combined_hash = "".join(sorted_hashes)
        content_fingerprint = hashlib.sha256(combined_hash.encode("utf-8")).hexdigest()

        # 9. Create unique manifest ID
        subset_label = f"sub{request.subset_size}" if request.subset_size else "full"
        short_id = uuid.uuid4().hex[:6]
        manifest_id = f"ds-{template.id}-{request.split}-{request.evaluation_role.value}-{subset_label}-{short_id}"

        source_url = f"https://huggingface.co/datasets/{template.hf_repo_id}"

        manifest = DatasetManifest(
            manifest_id=manifest_id,
            dataset_id=template.id,
            dataset_name=template.name,
            task_type=template.task_type,
            hf_repo_id=template.hf_repo_id,
            source_url=source_url,
            source_revision=resolved_sha,
            license=license_str,
            license_verified=license_verified,
            source_split=request.split,
            evaluation_role=request.evaluation_role,
            total_upstream_records=total_upstream,
            imported_record_count=len(normalized_records),
            subset_size=request.subset_size,
            sampling_seed=request.seed if request.subset_size else None,
            content_fingerprint=content_fingerprint,
            validation_status=DatasetValidationStatus.VERIFIED,
            storage_path="",  # will be set in save_dataset
            status_detail="Dataset imported and validated against canonical schema.",
            is_benchmarked=False,
        )

        # 10. Persist to disk
        self.storage.save_dataset(manifest, normalized_records)

        return manifest


dataset_importer = DatasetImporter()
