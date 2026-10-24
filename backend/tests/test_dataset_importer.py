"""Tests for Benchmark Dataset Importer, Normalizers, and Storage Manager."""
import json
import os
import shutil
import tempfile
from pathlib import Path
import pytest
from app.schemas.dataset import (
    DatasetImportRequest,
    DatasetRecord,
    TaskType,
    EvaluationRole,
    DatasetValidationStatus,
)
from app.services.dataset.normalizers import (
    extract_gsm8k_final_answer,
    normalize_gsm8k_record,
    normalize_humaneval_record,
)
from app.services.dataset.templates import (
    get_dataset_template,
    list_dataset_templates,
    GSM8K_PINNED_REVISION,
    HUMANEVAL_PINNED_REVISION,
)
from app.services.dataset.storage import DatasetStorageManager
from app.services.dataset.importer import (
    DatasetImporter,
    DatasetImportError,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def gsm8k_fixture_data():
    with open(FIXTURES_DIR / "gsm8k_fixture.json", "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def humaneval_fixture_data():
    with open(FIXTURES_DIR / "humaneval_fixture.json", "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def temp_storage():
    temp_dir = tempfile.mkdtemp()
    storage = DatasetStorageManager(storage_dir=temp_dir)
    yield storage
    shutil.rmtree(temp_dir, ignore_errors=True)


# ---------------------------------------------------------
# GSM8K Answer Extraction & Normalization
# ---------------------------------------------------------

def test_extract_gsm8k_final_answer_variations():
    assert extract_gsm8k_final_answer("Total is 9 * 2 = 18. #### 18") == "18"
    assert extract_gsm8k_final_answer("#### -42") == "-42"
    assert extract_gsm8k_final_answer("#### $1,200") == "1200"
    assert extract_gsm8k_final_answer("#### 3.14") == "3.14"
    assert extract_gsm8k_final_answer("#### 50.") == "50"
    assert extract_gsm8k_final_answer("No delimiter here 18") is None
    assert extract_gsm8k_final_answer("####") is None
    assert extract_gsm8k_final_answer("") is None
    assert extract_gsm8k_final_answer(None) is None


def test_normalize_gsm8k_record_valid(gsm8k_fixture_data):
    raw = gsm8k_fixture_data[0]
    rec = normalize_gsm8k_record(
        raw=raw,
        dataset_id="gsm8k",
        revision=GSM8K_PINNED_REVISION,
        split="test",
        role=EvaluationRole.HELD_OUT_TEST,
        index=0,
    )

    assert isinstance(rec, DatasetRecord)
    assert rec.dataset_id == "gsm8k"
    assert rec.task_type == TaskType.MATH_REASONING
    assert rec.evaluation_role == EvaluationRole.HELD_OUT_TEST
    assert rec.source_split == "test"
    assert len(rec.input_messages) == 1
    assert rec.input_messages[0]["role"] == "user"
    assert "Janet" in rec.input_messages[0]["content"]
    assert rec.reference_metadata["extracted_answer"] == "18"
    assert rec.license == "MIT"
    assert rec.record_id.startswith("rec-gsm8k-test-0-")
    assert rec.content_hash is not None


def test_normalize_gsm8k_missing_fields():
    with pytest.raises(ValueError, match="missing required 'question'"):
        normalize_gsm8k_record(
            raw={"answer": "42"},
            dataset_id="gsm8k",
            revision=GSM8K_PINNED_REVISION,
            split="test",
            role=EvaluationRole.HELD_OUT_TEST,
            index=0,
        )

    with pytest.raises(ValueError, match="missing required 'answer'"):
        normalize_gsm8k_record(
            raw={"question": "What is 2+2?"},
            dataset_id="gsm8k",
            revision=GSM8K_PINNED_REVISION,
            split="test",
            role=EvaluationRole.HELD_OUT_TEST,
            index=0,
        )


# ---------------------------------------------------------
# HumanEval Normalization & Untrusted Code Safety
# ---------------------------------------------------------

def test_normalize_humaneval_record_valid(humaneval_fixture_data):
    raw = humaneval_fixture_data[0]
    rec = normalize_humaneval_record(
        raw=raw,
        dataset_id="humaneval",
        revision=HUMANEVAL_PINNED_REVISION,
        split="test",
        role=EvaluationRole.HELD_OUT_TEST,
        index=0,
    )

    assert isinstance(rec, DatasetRecord)
    assert rec.dataset_id == "humaneval"
    assert rec.task_type == TaskType.CODE_GENERATION
    assert rec.evaluation_role == EvaluationRole.HELD_OUT_TEST
    assert rec.record_id == "rec-he-test-humaneval_0"
    assert rec.reference_metadata["entry_point"] == "has_close_elements"
    assert "assert candidate" in rec.reference_metadata["test"]
    assert rec.reference_metadata["execution_policy"] == "untrusted_isolated_sandbox_required"
    assert rec.license == "MIT"


def test_normalize_humaneval_missing_fields():
    with pytest.raises(ValueError, match="missing required 'task_id'"):
        normalize_humaneval_record(
            raw={"prompt": "def f(): pass", "canonical_solution": "pass"},
            dataset_id="humaneval",
            revision=HUMANEVAL_PINNED_REVISION,
            split="test",
            role=EvaluationRole.HELD_OUT_TEST,
            index=0,
        )

    with pytest.raises(ValueError, match="missing required 'prompt'"):
        normalize_humaneval_record(
            raw={"task_id": "HumanEval/99", "canonical_solution": "pass"},
            dataset_id="humaneval",
            revision=HUMANEVAL_PINNED_REVISION,
            split="test",
            role=EvaluationRole.HELD_OUT_TEST,
            index=0,
        )


# ---------------------------------------------------------
# Split Discipline and Role Enforcement
# ---------------------------------------------------------

def test_humaneval_rejects_training_role(humaneval_fixture_data, temp_storage):
    importer = DatasetImporter(storage=temp_storage)
    req = DatasetImportRequest(
        dataset_id="humaneval",
        split="test",
        evaluation_role=EvaluationRole.DEV_TRAIN,  # NOT ALLOWED on test split
        subset_size=2,
    )
    with pytest.raises(DatasetImportError, match="reserved for held_out_test"):
        importer.import_dataset(req, raw_records_override=humaneval_fixture_data)


def test_gsm8k_test_split_rejects_training_role(gsm8k_fixture_data, temp_storage):
    importer = DatasetImporter(storage=temp_storage)
    req = DatasetImportRequest(
        dataset_id="gsm8k",
        split="test",
        evaluation_role=EvaluationRole.DEV_TRAIN,  # NOT ALLOWED on test split
        subset_size=2,
    )
    with pytest.raises(DatasetImportError, match="reserved for held_out_test"):
        importer.import_dataset(req, raw_records_override=gsm8k_fixture_data)


def test_gsm8k_train_split_accepts_dev_train(gsm8k_fixture_data, temp_storage):
    importer = DatasetImporter(storage=temp_storage)
    req = DatasetImportRequest(
        dataset_id="gsm8k",
        split="train",
        evaluation_role=EvaluationRole.DEV_TRAIN,
        subset_size=2,
        seed=42,
    )
    manifest = importer.import_dataset(req, raw_records_override=gsm8k_fixture_data)
    assert manifest.source_split == "train"
    assert manifest.evaluation_role == EvaluationRole.DEV_TRAIN
    assert manifest.imported_record_count == 2


# ---------------------------------------------------------
# Deterministic Sampling with Fixed Seed
# ---------------------------------------------------------

def test_deterministic_sampling_seed(gsm8k_fixture_data, temp_storage):
    importer = DatasetImporter(storage=temp_storage)

    req1 = DatasetImportRequest(
        dataset_id="gsm8k",
        split="test",
        evaluation_role=EvaluationRole.HELD_OUT_TEST,
        subset_size=2,
        seed=12345,
    )
    manifest1 = importer.import_dataset(req1, raw_records_override=gsm8k_fixture_data)
    records1 = temp_storage.get_records(manifest1.manifest_id)

    req2 = DatasetImportRequest(
        dataset_id="gsm8k",
        split="test",
        evaluation_role=EvaluationRole.HELD_OUT_TEST,
        subset_size=2,
        seed=12345,
    )
    manifest2 = importer.import_dataset(req2, raw_records_override=gsm8k_fixture_data)
    records2 = temp_storage.get_records(manifest2.manifest_id)

    # Identical seed produces identical content fingerprints and record sequences
    assert manifest1.content_fingerprint == manifest2.content_fingerprint
    assert [r.record_id for r in records1] == [r.record_id for r in records2]


# ---------------------------------------------------------
# Duplicate Detection and Clean Imports
# ---------------------------------------------------------

def test_duplicate_detection(gsm8k_fixture_data, temp_storage):
    importer = DatasetImporter(storage=temp_storage)

    # Duplicate the first record 3 times
    duplicate_rows = [gsm8k_fixture_data[0], gsm8k_fixture_data[0], gsm8k_fixture_data[1]]
    req = DatasetImportRequest(
        dataset_id="gsm8k",
        split="test",
        evaluation_role=EvaluationRole.HELD_OUT_TEST,
        subset_size=None,
    )
    manifest = importer.import_dataset(req, raw_records_override=duplicate_rows)
    assert manifest.imported_record_count == 2  # Deduplicated from 3 to 2


# ---------------------------------------------------------
# Storage Manager CRUD
# ---------------------------------------------------------

def test_storage_manager_crud(gsm8k_fixture_data, temp_storage):
    importer = DatasetImporter(storage=temp_storage)
    req = DatasetImportRequest(
        dataset_id="gsm8k",
        split="test",
        evaluation_role=EvaluationRole.HELD_OUT_TEST,
        subset_size=2,
        seed=42,
    )
    manifest = importer.import_dataset(req, raw_records_override=gsm8k_fixture_data)

    # List manifests
    manifests = temp_storage.list_manifests()
    assert len(manifests) == 1
    assert manifests[0].manifest_id == manifest.manifest_id
    assert manifests[0].validation_status == DatasetValidationStatus.VERIFIED

    # Get single manifest
    fetched = temp_storage.get_manifest(manifest.manifest_id)
    assert fetched is not None
    assert fetched.dataset_name == manifest.dataset_name

    # Read records pagination
    records_page_1 = temp_storage.get_records(manifest.manifest_id, limit=1, offset=0)
    assert len(records_page_1) == 1
    records_page_2 = temp_storage.get_records(manifest.manifest_id, limit=1, offset=1)
    assert len(records_page_2) == 1
    assert records_page_1[0].record_id != records_page_2[0].record_id

    # Delete dataset
    assert temp_storage.delete_dataset(manifest.manifest_id) is True
    assert temp_storage.get_manifest(manifest.manifest_id) is None
    assert temp_storage.get_records(manifest.manifest_id) == []
