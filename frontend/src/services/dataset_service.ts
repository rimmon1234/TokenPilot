import {
  DatasetTemplate,
  DatasetManifest,
  DatasetRecord,
  DatasetImportRequest,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

export async function fetchDatasetTemplates(): Promise<DatasetTemplate[]> {
  try {
    const res = await fetch(`${API_BASE}/datasets/templates`);
    if (!res.ok) {
      throw new Error(`Failed to load templates (HTTP ${res.status})`);
    }
    return await res.json();
  } catch (err) {
    console.warn('Error fetching dataset templates:', err);
    throw err;
  }
}

export async function fetchDatasetTemplate(id: string): Promise<DatasetTemplate | null> {
  try {
    const res = await fetch(`${API_BASE}/datasets/templates/${encodeURIComponent(id)}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Failed to load template (HTTP ${res.status})`);
    }
    return await res.json();
  } catch (err) {
    console.warn(`Error fetching dataset template '${id}':`, err);
    throw err;
  }
}

export async function importDataset(
  request: DatasetImportRequest
): Promise<DatasetManifest> {
  const res = await fetch(`${API_BASE}/datasets/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    let errorDetail = `Import failed with HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson && errJson.detail) {
        errorDetail = errJson.detail;
      }
    } catch {
      // fallback to status text
    }
    throw new Error(errorDetail);
  }

  return await res.json();
}

export async function fetchImportedDatasets(): Promise<DatasetManifest[]> {
  try {
    const res = await fetch(`${API_BASE}/datasets`);
    if (!res.ok) {
      throw new Error(`Failed to load imported datasets (HTTP ${res.status})`);
    }
    return await res.json();
  } catch (err) {
    console.warn('Error fetching imported datasets:', err);
    throw err;
  }
}

export async function fetchDatasetRecords(
  manifestId: string,
  limit: number = 50,
  offset: number = 0
): Promise<DatasetRecord[]> {
  const url = `${API_BASE}/datasets/${encodeURIComponent(manifestId)}/records?limit=${limit}&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch records (HTTP ${res.status})`);
  }
  return await res.json();
}

export async function deleteImportedDataset(manifestId: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/datasets/${encodeURIComponent(manifestId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Failed to delete dataset (HTTP ${res.status})`);
  }
  return true;
}
