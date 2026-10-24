import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createBenchmarkRun,
  fetchBenchmarkRuns,
  fetchBenchmarkRun,
  fetchBenchmarkResults,
  cancelBenchmarkRun,
} from '../services/benchmark_service';
import {
  BenchmarkRun,
  BenchmarkResult,
  BenchmarkRunCreate,
  BenchmarkModelConfig,
} from '../types';

describe('Benchmark Execution Service Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockModel: BenchmarkModelConfig = {
    model_id: 'local-llama3',
    display_name: 'Llama 3 8B',
    provider_type: 'ollama',
    execution_mode: 'local_openai_compatible',
    provider_model_id: 'llama3:8b',
    base_url: 'http://localhost:11434',
    input_price_per_million: 0,
    output_price_per_million: 0,
    pricing_source: 'local_zero',
  };

  const mockRun: BenchmarkRun = {
    id: 'run-gsm8k-12345678',
    dataset_manifest_id: 'ds-gsm8k-test-held_out_test-sub5-123456',
    dataset_name: 'GSM8K',
    dataset_id: 'gsm8k',
    dataset_revision: '740312add88f781978c0658806c59bc2815b9866',
    source_split: 'test',
    task_type: 'math_reasoning',
    model_ids: ['local-llama3'],
    model_configs: [mockModel],
    status: 'running',
    progress: {
      total_items: 5,
      completed_items: 2,
      failed_items: 0,
      current_model_id: 'local-llama3',
      current_record_id: 'rec-2',
    },
    generation_settings: {
      temperature: 0.0,
      max_tokens: 512,
    },
    subset_size: 5,
    seed: 42,
    started_at: new Date().toISOString(),
    results_summary: {},
  };

  const mockResult: BenchmarkResult = {
    id: 'res-run-1-rec-1-mod-1',
    run_id: 'run-gsm8k-12345678',
    dataset_manifest_id: 'ds-gsm8k-test-held_out_test-sub5-123456',
    dataset_id: 'gsm8k',
    dataset_revision: '740312add88f781978c0658806c59bc2815b9866',
    source_split: 'test',
    record_id: 'rec-1',
    content_hash: 'hash123',
    model_id: 'local-llama3',
    provider_model_id: 'llama3:8b',
    model_display_name: 'Llama 3 8B',
    status: 'success',
    prompt_text: 'What is 5 + 7?',
    reference_answer: '12',
    reference_metadata: { extracted_answer: '12' },
    output_text: '5 + 7 = 12\n#### 12',
    finish_reason: 'stop',
    prompt_tokens: 18,
    completion_tokens: 24,
    total_tokens: 42,
    token_provenance: 'provider_reported',
    latency_ms: 450.2,
    ttft_ms: 120.5,
    cost_usd: 0.0,
    created_at: new Date().toISOString(),
  };

  it('createBenchmarkRun posts payload and returns pending/running BenchmarkRun', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockRun,
    } as Response);

    const payload: BenchmarkRunCreate = {
      dataset_manifest_id: 'ds-gsm8k-test-held_out_test-sub5-123456',
      models: [mockModel],
      subset_size: 5,
      seed: 42,
      generation_settings: {
        temperature: 0.0,
        max_tokens: 512,
      },
    };

    const run = await createBenchmarkRun(payload);
    expect(run.id).toBe('run-gsm8k-12345678');
    expect(run.status).toBe('running');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/benchmarks/runs'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('createBenchmarkRun throws descriptive error on 422 validation failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        detail: 'HumanEval code execution is not supported in M4.2.1.',
      }),
    } as Response);

    await expect(
      createBenchmarkRun({
        dataset_manifest_id: 'ds-humaneval-manifest',
        models: [mockModel],
      })
    ).rejects.toThrow('HumanEval code execution is not supported');
  });

  it('fetchBenchmarkRuns retrieves list of runs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [mockRun],
    } as Response);

    const runs = await fetchBenchmarkRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe('run-gsm8k-12345678');
  });

  it('fetchBenchmarkRun retrieves single run by id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockRun,
    } as Response);

    const run = await fetchBenchmarkRun('run-gsm8k-12345678');
    expect(run).not.toBeNull();
    expect(run?.id).toBe('run-gsm8k-12345678');
  });

  it('fetchBenchmarkRun returns null on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const run = await fetchBenchmarkRun('nonexistent');
    expect(run).toBeNull();
  });

  it('fetchBenchmarkResults returns paginated results', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [mockResult],
    } as Response);

    const results = await fetchBenchmarkResults('run-gsm8k-12345678', 50, 0);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');
    expect(results[0].ttft_ms).toBe(120.5);
    expect(results[0].output_text).toContain('#### 12');
  });

  it('cancelBenchmarkRun requests cancellation and returns updated run', async () => {
    const cancelledRun: BenchmarkRun = { ...mockRun, status: 'cancelled' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => cancelledRun,
    } as Response);

    const result = await cancelBenchmarkRun('run-gsm8k-12345678');
    expect(result.status).toBe('cancelled');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/benchmarks/runs/run-gsm8k-12345678/cancel'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});
