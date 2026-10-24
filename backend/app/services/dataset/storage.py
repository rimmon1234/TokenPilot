"""Storage manager for dataset manifests and canonical record lines."""
import json
import logging
import os
from pathlib import Path
from typing import List, Optional
from app.config import settings
from app.schemas.dataset import DatasetManifest, DatasetRecord

logger = logging.getLogger(__name__)


class DatasetStorageManager:
    """Manages persistence of dataset manifests (.manifest.json) and records (.jsonl)."""

    def __init__(self, storage_dir: Optional[str] = None):
        self.storage_dir = Path(storage_dir or settings.datasets_storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    def _manifest_path(self, manifest_id: str) -> Path:
        # Sanitize manifest_id to prevent directory traversal
        safe_id = Path(manifest_id).name
        return self.storage_dir / f"{safe_id}.manifest.json"

    def _records_path(self, manifest_id: str) -> Path:
        safe_id = Path(manifest_id).name
        return self.storage_dir / f"{safe_id}.jsonl"

    def save_dataset(
        self, manifest: DatasetManifest, records: List[DatasetRecord]
    ) -> None:
        """Write manifest and canonical records atomically to disk."""
        manifest_file = self._manifest_path(manifest.manifest_id)
        records_file = self._records_path(manifest.manifest_id)

        # Update manifest storage_path to relative or local representation
        manifest.storage_path = str(records_file.resolve())

        # Write records as JSON Lines (.jsonl)
        with open(records_file, "w", encoding="utf-8") as rf:
            for rec in records:
                rf.write(rec.model_dump_json() + "\n")

        # Write manifest
        with open(manifest_file, "w", encoding="utf-8") as mf:
            mf.write(manifest.model_dump_json(indent=2))

        logger.info(
            "Saved dataset '%s' (%d records) to %s",
            manifest.manifest_id,
            len(records),
            records_file
        )

    def list_manifests(self) -> List[DatasetManifest]:
        """List all saved dataset manifests, sorted by import timestamp descending."""
        manifests: List[DatasetManifest] = []
        if not self.storage_dir.exists():
            return manifests

        for f in self.storage_dir.glob("*.manifest.json"):
            try:
                with open(f, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                    manifests.append(DatasetManifest.model_validate(data))
            except Exception as err:
                logger.warning("Failed to parse dataset manifest %s: %s", f, err)

        manifests.sort(key=lambda m: m.imported_at, reverse=True)
        return manifests

    def get_manifest(self, manifest_id: str) -> Optional[DatasetManifest]:
        """Retrieve a specific dataset manifest by ID."""
        manifest_file = self._manifest_path(manifest_id)
        if not manifest_file.exists():
            return None

        try:
            with open(manifest_file, "r", encoding="utf-8") as fp:
                data = json.load(fp)
                return DatasetManifest.model_validate(data)
        except Exception as err:
            logger.error("Failed to load manifest %s: %s", manifest_id, err)
            return None

    def get_records(
        self, manifest_id: str, limit: int = 50, offset: int = 0
    ) -> List[DatasetRecord]:
        """Read a slice of canonical records for the given dataset manifest."""
        records_file = self._records_path(manifest_id)
        if not records_file.exists():
            return []

        records: List[DatasetRecord] = []
        current_idx = 0
        target_end = offset + limit

        with open(records_file, "r", encoding="utf-8") as fp:
            for line in fp:
                line = line.strip()
                if not line:
                    continue
                if current_idx >= offset and current_idx < target_end:
                    try:
                        record_dict = json.loads(line)
                        records.append(DatasetRecord.model_validate(record_dict))
                    except Exception as err:
                        logger.warning("Error parsing record line %d: %s", current_idx, err)
                current_idx += 1
                if current_idx >= target_end:
                    break

        return records

    def delete_dataset(self, manifest_id: str) -> bool:
        """Delete manifest and associated records file from disk."""
        manifest_file = self._manifest_path(manifest_id)
        records_file = self._records_path(manifest_id)

        deleted = False
        if manifest_file.exists():
            manifest_file.unlink()
            deleted = True
        if records_file.exists():
            records_file.unlink()
            deleted = True

        return deleted


dataset_storage = DatasetStorageManager()
