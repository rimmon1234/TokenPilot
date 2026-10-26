import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createBenchmarkRun,
  fetchBenchmarkRuns,
  fetchBenchmarkRun,
  fetchBenchmarkResults,
  cancelBenchmarkRun,
  scoreBenchmarkRun,
  updateBenchmarkRun,
} from '../services/benchmark_service';
import {
  formatBenchmarkTimestamp,
  getBenchmarkRunDisplayTitle,
  getBenchmarkRunSelectOption,
} from '../pages/BenchmarkLabPage';
import {
  BenchmarkRun,
  BenchmarkResult,
  BenchmarkRunCreate,
  BenchmarkModelConfig,
  BenchmarkRunScoringSummary,
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

  it('scoreBenchmarkRun triggers scoring and returns run with scoring summary', async () => {
    const mockSummary: BenchmarkRunScoringSummary = {
      evaluation_metric: 'exact_match',
      evaluated_at: new Date().toISOString(),
      total_attempted: 1,
      total_successful: 1,
      total_correct: 1,
      total_incorrect: 0,
      total_unparseable: 0,
      total_failed: 0,
      total_unevaluated: 0,
      scorable_accuracy: 1.0,
      end_to_end_accuracy: 1.0,
      model_metrics: {
        'local-llama3': {
          model_id: 'local-llama3',
          display_name: 'Llama 3 8B',
          attempted_questions: 1,
          successful_generations: 1,
          correct_answers: 1,
          incorrect_answers: 0,
          unparseable_answers: 0,
          failed_requests: 0,
          unevaluated_results: 0,
          scorable_accuracy: 1.0,
          end_to_end_accuracy: 1.0,
        },
      },
    };

    const scoredRun: BenchmarkRun = {
      ...mockRun,
      status: 'completed',
      results_summary: mockSummary as unknown as Record<string, unknown>,
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => scoredRun,
    } as Response);

    const result = await scoreBenchmarkRun('run-gsm8k-12345678');
    expect(result.id).toBe('run-gsm8k-12345678');
    expect(result.results_summary?.total_correct).toBe(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/benchmarks/runs/run-gsm8k-12345678/score'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('scoreBenchmarkRun throws descriptive error on 422 incompatibility', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        detail: 'Task type code_generation does not support GSM8K scoring.',
      }),
    } as Response);

    await expect(scoreBenchmarkRun('run-humaneval-123')).rejects.toThrow(
      'does not support GSM8K scoring'
    );
  });

  it('createBenchmarkRun includes display_name when supplied', async () => {
    const runWithCustomName: BenchmarkRun = {
      ...mockRun,
      display_name: 'Custom Math Benchmark Round 1',
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => runWithCustomName,
    } as Response);

    const payload: BenchmarkRunCreate = {
      display_name: 'Custom Math Benchmark Round 1',
      dataset_manifest_id: 'ds-gsm8k-test-held_out_test-sub5-123456',
      models: [mockModel],
    };

    const res = await createBenchmarkRun(payload);
    expect(res.display_name).toBe('Custom Math Benchmark Round 1');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/benchmarks/runs'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"display_name":"Custom Math Benchmark Round 1"'),
      })
    );
  });

  it('updateBenchmarkRun calls PATCH and updates display_name', async () => {
    const renamedRun: BenchmarkRun = {
      ...mockRun,
      display_name: 'Renamed Qwen vs Llama Pilot',
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => renamedRun,
    } as Response);

    const res = await updateBenchmarkRun('run-gsm8k-12345678', {
      display_name: 'Renamed Qwen vs Llama Pilot',
    });
    expect(res.display_name).toBe('Renamed Qwen vs Llama Pilot');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/benchmarks/runs/run-gsm8k-12345678'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ display_name: 'Renamed Qwen vs Llama Pilot' }),
      })
    );
  });

  it('updateBenchmarkRun throws descriptive error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        detail: 'Benchmark name cannot be empty or whitespace-only.',
      }),
    } as Response);

    await expect(
      updateBenchmarkRun('run-gsm8k-12345678', { display_name: '   ' })
    ).rejects.toThrow('Benchmark name cannot be empty or whitespace-only.');
  });
});

describe('Benchmark Run Labeling & Timestamp Selector Formatting', () => {
  const baseRun: BenchmarkRun = {
    id: 'run-test-123',
    dataset_manifest_id: 'ds-gsm8k',
    dataset_name: 'GSM8K (Grade School Math 8K)',
    dataset_id: 'gsm8k',
    dataset_revision: 'rev',
    source_split: 'train',
    task_type: 'math_reasoning',
    model_ids: ['m1'],
    model_configs: [],
    status: 'completed',
    progress: { total_items: 10, completed_items: 10, failed_items: 0 },
    generation_settings: { temperature: 0.0 },
    seed: 42,
    started_at: '2026-10-26T15:29:00.000Z',
    results_summary: {},
  };

  it('formats benchmark timestamps cleanly', () => {
    const formatted = formatBenchmarkTimestamp('2026-10-26T15:29:00.000Z');
    expect(formatted).toMatch(/Oct 26/);
    expect(formatBenchmarkTimestamp(null)).toBe('Unknown date');
    expect(formatBenchmarkTimestamp('invalid-date')).toBe('Unknown date');
  });

  it('displays custom name and timestamp in selector label format <Name> · <Timestamp>', () => {
    const run: BenchmarkRun = {
      ...baseRun,
      display_name: 'Qwen vs Llama — Math Pilot',
    };
    const { label, fullTitle } = getBenchmarkRunSelectOption(run);
    expect(label).toContain('Qwen vs Llama — Math Pilot · ');
    expect(label).toMatch(/Oct 26/);
    expect(fullTitle).toContain('Qwen vs Llama — Math Pilot · ');
    expect(fullTitle).toContain('(run-test-123)');
  });

  it('generates fallback label from short dataset alias when custom name is missing', () => {
    const runWithoutName: BenchmarkRun = {
      ...baseRun,
      display_name: undefined,
    };
    const { label, fullTitle } = getBenchmarkRunSelectOption(runWithoutName);
    expect(label).toMatch(/^GSM8K · /);
    expect(fullTitle).toContain('GSM8K · ');
    expect(fullTitle).toContain('(run-test-123)');

    const titleOnly = getBenchmarkRunDisplayTitle(runWithoutName);
    expect(titleOnly).toMatch(/^GSM8K · /);
  });

  it('truncates long names with ellipsis while keeping timestamp visible', () => {
    const longName = 'Very Long Benchmark Run Name That Exceeds The Maximum Allowed Selector Characters';
    const run: BenchmarkRun = {
      ...baseRun,
      display_name: longName,
    };
    const { label, fullTitle } = getBenchmarkRunSelectOption(run, 30);
    // Name is truncated with ellipsis
    expect(label).toContain('…');
    // Timestamp is intact and visible
    expect(label).toMatch(/Oct 26/);
    // Full title preserves untruncated name
    expect(fullTitle).toContain(longName);
  });

  it('supports sorting benchmark runs newest first', () => {
    const runA: BenchmarkRun = {
      ...baseRun,
      id: 'run-a',
      started_at: '2026-10-26T10:00:00.000Z',
    };
    const runB: BenchmarkRun = {
      ...baseRun,
      id: 'run-b',
      started_at: '2026-10-26T12:00:00.000Z',
    };
    const runC: BenchmarkRun = {
      ...baseRun,
      id: 'run-c',
      started_at: '2026-10-26T11:00:00.000Z',
    };

    const sorted = [runA, runB, runC].sort(
      (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    );
    expect(sorted.map((r) => r.id)).toEqual(['run-b', 'run-c', 'run-a']);
  });
});


