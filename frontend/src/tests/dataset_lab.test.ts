import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchDatasetTemplates,
  fetchDatasetTemplate,
  importDataset,
  fetchImportedDatasets,
  fetchDatasetRecords,
  deleteImportedDataset,
} from '../services/dataset_service';
import { DatasetTemplate, DatasetManifest, DatasetRecord } from '../types';

describe('Benchmark Dataset Service Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockTemplate: DatasetTemplate = {
    id: 'gsm8k',
    name: 'GSM8K',
    description: 'Math reasoning dataset',
    task_type: 'math_reasoning',
    hf_repo_id: 'openai/gsm8k',
    available_splits: ['test', 'train'],
    allowed_roles_per_split: {
      test: ['held_out_test'],
      train: ['dev_train', 'validation'],
    },
    license: 'MIT',
    license_verified: true,
    pinned_revision: '740312add88f781978c0658806c59bc2815b9866',
    recommended_subsets: [5, 10, 25],
    sample_records: [{ question: '2+2=?', answer: '4' }],
  };

  const mockManifest: DatasetManifest = {
    manifest_id: 'ds-gsm8k-test-held_out_test-sub5-123456',
    dataset_id: 'gsm8k',
    dataset_name: 'GSM8K',
    task_type: 'math_reasoning',
    hf_repo_id: 'openai/gsm8k',
    source_url: 'https://huggingface.co/datasets/openai/gsm8k',
    source_revision: '740312add88f781978c0658806c59bc2815b9866',
    license: 'MIT',
    license_verified: true,
    source_split: 'test',
    evaluation_role: 'held_out_test',
    total_upstream_records: 1319,
    imported_record_count: 5,
    subset_size: 5,
    sampling_seed: 42,
    content_fingerprint: 'sha256:abc123456',
    imported_at: new Date().toISOString(),
    validation_status: 'verified',
    storage_path: '/data/datasets/ds-gsm8k.jsonl',
    status_detail: 'Verified',
    is_benchmarked: false,
  };

  it('fetchDatasetTemplates resolves templates array', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [mockTemplate],
    } as Response);

    const templates = await fetchDatasetTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0].id).toBe('gsm8k');
    expect(templates[0].task_type).toBe('math_reasoning');
  });

  it('fetchDatasetTemplate returns null on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const tmpl = await fetchDatasetTemplate('unknown');
    expect(tmpl).toBeNull();
  });

  it('importDataset posts request and returns verified manifest', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockManifest,
    } as Response);

    const manifest = await importDataset({
      dataset_id: 'gsm8k',
      split: 'test',
      evaluation_role: 'held_out_test',
      subset_size: 5,
      seed: 42,
    });

    expect(manifest.manifest_id).toContain('ds-gsm8k');
    expect(manifest.imported_record_count).toBe(5);
    expect(manifest.is_benchmarked).toBe(false);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/datasets/import'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('importDataset handles 422 validation errors with diagnostic detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        detail: "Invalid evaluation_role 'dev_train' for 'humaneval' split 'test'. Upstream test splits are reserved for held_out_test.",
      }),
    } as Response);

    await expect(
      importDataset({
        dataset_id: 'humaneval',
        split: 'test',
        evaluation_role: 'dev_train',
        subset_size: 5,
      })
    ).rejects.toThrow("reserved for held_out_test");
  });

  it('fetchImportedDatasets returns saved manifests', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [mockManifest],
    } as Response);

    const manifests = await fetchImportedDatasets();
    expect(manifests).toHaveLength(1);
    expect(manifests[0].validation_status).toBe('verified');
  });

  it('fetchDatasetRecords queries paginated records', async () => {
    const mockRecord: DatasetRecord = {
      record_id: 'rec-1',
      dataset_id: 'gsm8k',
      dataset_revision: 'rev',
      source_split: 'test',
      evaluation_role: 'held_out_test',
      task_type: 'math_reasoning',
      input_messages: [{ role: 'user', content: '2+2=?' }],
      reference_answer: '4',
      reference_metadata: { extracted_answer: '4' },
      license: 'MIT',
      source_url: 'https://huggingface.co/datasets/openai/gsm8k',
      content_hash: 'hash123',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [mockRecord],
    } as Response);

    const records = await fetchDatasetRecords('ds-123', 10, 0);
    expect(records).toHaveLength(1);
    expect(records[0].record_id).toBe('rec-1');
  });

  it('deleteImportedDataset executes DELETE request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
    } as Response);

    const res = await deleteImportedDataset('ds-123');
    expect(res).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/datasets/ds-123'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
