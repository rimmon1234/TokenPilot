"""FastAPI router for Benchmark Dataset Registry and Import Pipeline."""
import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, status
from app.schemas.dataset import (
    DatasetTemplate,
    DatasetManifest,
    DatasetRecord,
    DatasetImportRequest,
)
from app.services.dataset import (
    list_dataset_templates,
    get_dataset_template,
    dataset_importer,
    DatasetImportError,
    dataset_storage,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/datasets", tags=["Benchmark Datasets"])


@router.get("/templates", response_model=List[DatasetTemplate])
async def get_templates():
    """List all supported benchmark dataset templates with metadata, splits, and sample records."""
    return list_dataset_templates()


@router.get("/templates/{dataset_id}", response_model=DatasetTemplate)
async def get_template_detail(dataset_id: str):
    """Retrieve metadata and sample records for a specific dataset template."""
    template = get_dataset_template(dataset_id)
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset template '{dataset_id}' not found."
        )
    return template


@router.post("/import", response_model=DatasetManifest)
async def import_dataset(request: DatasetImportRequest):
    """
    Import and validate a benchmark dataset into the local reproducible registry.
    Enforces split discipline, deterministic sampling, and canonical normalization.
    """
    try:
        manifest = dataset_importer.import_dataset(request)
        return manifest
    except DatasetImportError as err:
        logger.warning("Dataset import failed: %s", err)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(err)
        )
    except Exception as err:
        logger.error("Unexpected error during dataset import: %s", err, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import dataset: {str(err)}"
        )


@router.get("", response_model=List[DatasetManifest])
async def list_imported_datasets():
    """List all locally imported benchmark datasets and their validation status."""
    return dataset_storage.list_manifests()


@router.get("/{manifest_id}", response_model=DatasetManifest)
async def get_imported_dataset(manifest_id: str):
    """Retrieve details for a specific locally imported dataset manifest."""
    manifest = dataset_storage.get_manifest(manifest_id)
    if not manifest:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Imported dataset '{manifest_id}' not found."
        )
    return manifest


@router.get("/{manifest_id}/records", response_model=List[DatasetRecord])
async def get_dataset_records(
    manifest_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Read paginated canonical records for an imported dataset."""
    manifest = dataset_storage.get_manifest(manifest_id)
    if not manifest:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Imported dataset '{manifest_id}' not found."
        )

    records = dataset_storage.get_records(manifest_id, limit=limit, offset=offset)
    return records


@router.delete("/{manifest_id}")
async def delete_imported_dataset(manifest_id: str):
    """Delete a locally imported benchmark dataset manifest and its stored records."""
    success = dataset_storage.delete_dataset(manifest_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Imported dataset '{manifest_id}' not found or could not be deleted."
        )
    return {"status": "deleted", "manifest_id": manifest_id}
