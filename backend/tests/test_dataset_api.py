"""Integration tests for Benchmark Dataset Registry and Import API endpoints."""
import json
from pathlib import Path
from unittest.mock import patch
import pytest
from starlette.testclient import TestClient
from app.main import app
from app.services.dataset.storage import dataset_storage
from app.services.dataset.templates import GSM8K_PINNED_REVISION

client = TestClient(app)
FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def gsm8k_fixture_data():
    with open(FIXTURES_DIR / "gsm8k_fixture.json", "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def humaneval_fixture_data():
    with open(FIXTURES_DIR / "humaneval_fixture.json", "r", encoding="utf-8") as f:
        return json.load(f)


def test_get_dataset_templates():
    response = client.get("/api/datasets/templates")
    assert response.status_code == 200
    templates = response.json()
    assert len(templates) >= 2

    ids = [t["id"] for t in templates]
    assert "gsm8k" in ids
    assert "humaneval" in ids

    gsm8k = next(t for t in templates if t["id"] == "gsm8k")
    assert gsm8k["task_type"] == "math_reasoning"
    assert gsm8k["license"] == "MIT"
    assert gsm8k["license_verified"] is True
    assert gsm8k["pinned_revision"] == GSM8K_PINNED_REVISION
    assert len(gsm8k["sample_records"]) > 0

    humaneval = next(t for t in templates if t["id"] == "humaneval")
    assert humaneval["task_type"] == "code_generation"
    assert "test" in humaneval["available_splits"]


def test_get_dataset_template_detail():
    response = client.get("/api/datasets/templates/gsm8k")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == "gsm8k"
    assert "available_splits" in data

    # 404 for unknown template
    res_404 = client.get("/api/datasets/templates/unknown_ds")
    assert res_404.status_code == 404


def test_import_dataset_endpoint_success(gsm8k_fixture_data):
    # Mock upstream fetch to return deterministic fixture rows
    with patch(
        "app.services.dataset.importer.DatasetImporter.fetch_upstream_rows",
        return_value=(gsm8k_fixture_data, 1319),
    ):
        payload = {
            "dataset_id": "gsm8k",
            "split": "test",
            "subset_size": 2,
            "seed": 42,
            "evaluation_role": "held_out_test",
        }
        res = client.post("/api/datasets/import", json=payload)
        assert res.status_code == 200
        manifest = res.json()
        assert manifest["dataset_id"] == "gsm8k"
        assert manifest["imported_record_count"] == 2
        assert manifest["validation_status"] == "verified"
        assert manifest["is_benchmarked"] is False
        manifest_id = manifest["manifest_id"]

        try:
            # Check listing contains newly imported manifest
            list_res = client.get("/api/datasets")
            assert list_res.status_code == 200
            manifest_ids = [m["manifest_id"] for m in list_res.json()]
            assert manifest_id in manifest_ids

            # Check manifest detail
            detail_res = client.get(f"/api/datasets/{manifest_id}")
            assert detail_res.status_code == 200
            assert detail_res.json()["manifest_id"] == manifest_id

            # Check paginated records
            rec_res = client.get(f"/api/datasets/{manifest_id}/records?limit=10&offset=0")
            assert rec_res.status_code == 200
            records = rec_res.json()
            assert len(records) == 2
            assert records[0]["task_type"] == "math_reasoning"
            assert "Janet" in records[0]["input_messages"][0]["content"]

        finally:
            # Clean up created dataset
            del_res = client.delete(f"/api/datasets/{manifest_id}")
            assert del_res.status_code == 200


def test_import_dataset_endpoint_split_role_violation():
    payload = {
        "dataset_id": "humaneval",
        "split": "test",
        "evaluation_role": "dev_train",  # DISALLOWED
        "subset_size": 5,
    }
    res = client.post("/api/datasets/import", json=payload)
    assert res.status_code == 422
    assert "reserved for held_out_test" in res.json()["detail"]


def test_import_dataset_unknown_id():
    payload = {
        "dataset_id": "imaginary_dataset",
        "split": "test",
        "evaluation_role": "held_out_test",
    }
    res = client.post("/api/datasets/import", json=payload)
    assert res.status_code == 422
    assert "Unknown dataset_id" in res.json()["detail"]


def test_delete_nonexistent_dataset():
    res = client.delete("/api/datasets/ds-nonexistent-12345")
    assert res.status_code == 404
