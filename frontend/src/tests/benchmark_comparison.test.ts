import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  exportBenchmarkRun,
  downloadBenchmarkReport,
} from '../services/benchmark_service';
import {
  BenchmarkRunScoringSummary,
} from '../types';

describe('Benchmark Comparison & Reports Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockMultiModelSummary: BenchmarkRunScoringSummary = {
    evaluation_metric: 'exact_match',
    evaluated_at: new Date().toISOString(),
    total_attempted: 20,
    total_successful: 20,
    total_correct: 15,
    total_incorrect: 3,
    total_unparseable: 2,
    total_failed: 0,
    total_unevaluated: 0,
    scorable_accuracy: 0.8333,
    end_to_end_accuracy: 0.75,
    model_metrics: {
      'model-alpha': {
        model_id: 'model-alpha',
        display_name: 'Alpha 7B',
        provider_type: 'ollama',
        provider_model_id: 'alpha:7b',
        attempted_questions: 10,
        successful_generations: 10,
        correct_answers: 8,
        incorrect_answers: 2,
        unparseable_answers: 0,
        failed_requests: 0,
        unevaluated_results: 0,
        scorable_accuracy: 0.8,
        end_to_end_accuracy: 0.8,
        avg_latency_ms: 1250.4,
        median_latency_ms: 1200.0,
        avg_ttft_ms: 350.2,
        total_tokens: 2500,
        token_provenance: 'provider_reported',
        missing_usage_count: 0,
        total_cost_usd: null,  // local hardware unknown cost
        cost_per_question_usd: null,
        unknown_cost_count: 10,
        is_pareto_efficient: null,
      },
      'model-beta': {
        model_id: 'model-beta',
        display_name: 'Beta Cloud',
        provider_type: 'openai',
        provider_model_id: 'gpt-4o-mini',
        attempted_questions: 10,
        successful_generations: 10,
        correct_answers: 7,
        incorrect_answers: 1,
        unparseable_answers: 2,
        failed_requests: 0,
        unevaluated_results: 0,
        scorable_accuracy: 0.875,
        end_to_end_accuracy: 0.7,
        avg_latency_ms: 820.0,
        median_latency_ms: 800.0,
        avg_ttft_ms: 150.0,
        total_tokens: 2200,
        token_provenance: 'provider_reported',
        missing_usage_count: 0,
        total_cost_usd: 0.0033,
        cost_per_question_usd: 0.00033,
        unknown_cost_count: 0,
        is_pareto_efficient: true,
      },
    },
  };

  it('exportBenchmarkRun calls export endpoint with json format', async () => {
    const mockBlob = new Blob([JSON.stringify({ report_type: 'tokenpilot_benchmark_report' })], {
      type: 'application/json',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      blob: async () => mockBlob,
    } as Response);

    const blob = await exportBenchmarkRun('run-test-123', 'json');
    expect(blob).toBeDefined();
    expect(blob.type).toBe('application/json');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/benchmarks/runs/run-test-123/export?format=json')
    );
  });

  it('exportBenchmarkRun calls export endpoint with csv format', async () => {
    const mockBlob = new Blob(['# TokenPilot Benchmark Report\n'], { type: 'text/csv' });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      blob: async () => mockBlob,
    } as Response);

    const blob = await exportBenchmarkRun('run-test-123', 'csv');
    expect(blob).toBeDefined();
    expect(blob.type).toBe('text/csv');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/benchmarks/runs/run-test-123/export?format=csv')
    );
  });

  it('exportBenchmarkRun throws descriptive error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Benchmark run 'nonexistent' not found." }),
    } as Response);

    await expect(exportBenchmarkRun('nonexistent', 'json')).rejects.toThrow(
      "Benchmark run 'nonexistent' not found"
    );
  });

  it('downloadBenchmarkReport triggers link download and cleanup in DOM', async () => {
    const mockBlob = new Blob(['{}'], { type: 'application/json' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      blob: async () => mockBlob,
    } as Response);

    const createObjectURLMock = vi.fn().mockReturnValue('blob:http://localhost/mock-blob-url');
    const revokeObjectURLMock = vi.fn();
    const clickSpy = vi.fn();
    const appendChildSpy = vi.fn();
    const removeChildSpy = vi.fn();

    const mockAnchor = {
      href: '',
      download: '',
      click: clickSpy,
    };

    const originalWindow = (globalThis as any).window;
    const originalDocument = (globalThis as any).document;

    (globalThis as any).window = {
      URL: {
        createObjectURL: createObjectURLMock,
        revokeObjectURL: revokeObjectURLMock,
      },
    };
    (globalThis as any).document = {
      createElement: vi.fn().mockReturnValue(mockAnchor),
      body: {
        appendChild: appendChildSpy,
        removeChild: removeChildSpy,
      },
    };

    try {
      await downloadBenchmarkReport('run-test-123', 'json');
      expect(createObjectURLMock).toHaveBeenCalledWith(mockBlob);
      expect(clickSpy).toHaveBeenCalled();
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost/mock-blob-url');
    } finally {
      (globalThis as any).window = originalWindow;
      (globalThis as any).document = originalDocument;
    }
  });

  it('correctly handles multi-model scoring summary metrics', () => {
    const metrics = mockMultiModelSummary.model_metrics;
    expect(Object.keys(metrics)).toHaveLength(2);

    const alpha = metrics['model-alpha'];
    expect(alpha.display_name).toBe('Alpha 7B');
    expect(alpha.scorable_accuracy).toBe(0.8);
    expect(alpha.total_cost_usd).toBeNull();
    expect(alpha.unknown_cost_count).toBe(10);
    expect(alpha.is_pareto_efficient).toBeNull(); // Local unknown cost

    const beta = metrics['model-beta'];
    expect(beta.display_name).toBe('Beta Cloud');
    expect(beta.scorable_accuracy).toBe(0.875);
    expect(beta.cost_per_question_usd).toBe(0.00033);
    expect(beta.is_pareto_efficient).toBe(true);
  });
});
