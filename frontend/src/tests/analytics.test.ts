import { describe, it, expect } from 'vitest';
import { UsageEvent } from '../types';

describe('Analytics Metrics and Filtering Logic', () => {
  const sampleEvents: UsageEvent[] = [
    {
      id: 'e1',
      request_id: 'e1',
      workspace_model_id: 'm1',
      model_display_name_snapshot: 'Qwen 2.5 Coder',
      provider_type: 'huggingface',
      provider_model_id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
      execution_location: 'remote',
      execution_mode: 'huggingface_inference_providers',
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      token_provenance: 'provider_reported',
      pricing_snapshot: {
        input_price_per_million: 0.15,
        output_price_per_million: 0.2,
        pricing_source: 'official_docs',
      },
      pricing_provenance: 'verified',
      cost_status: 'known',
      estimated_cost_usd: 0.000025,
      latency_ms: 120,
      success: true,
      status: 'success',
      routed_by: 'direct',
      timestamp: new Date().toISOString(),
    },
    {
      id: 'e2',
      request_id: 'e2',
      workspace_model_id: 'm2',
      model_display_name_snapshot: 'Ollama Llama 3.2',
      provider_type: 'ollama',
      provider_model_id: 'llama3.2:3b',
      execution_location: 'local',
      execution_mode: 'local_openai_compatible',
      prompt_tokens: 200,
      completion_tokens: 80,
      total_tokens: 280,
      token_provenance: 'provider_reported',
      pricing_snapshot: {
        input_price_per_million: 0,
        output_price_per_million: 0,
        pricing_source: 'free_local',
      },
      pricing_provenance: 'unknown',
      cost_status: 'unknown',
      estimated_cost_usd: null,
      latency_ms: 250,
      success: true,
      status: 'success',
      routed_by: 'direct',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), // 2 days ago
    },
    {
      id: 'e3',
      request_id: 'e3',
      workspace_model_id: 'm1',
      model_display_name_snapshot: 'Qwen 2.5 Coder',
      provider_type: 'huggingface',
      provider_model_id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
      execution_location: 'remote',
      execution_mode: 'huggingface_inference_providers',
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      token_provenance: 'unavailable',
      pricing_snapshot: {
        input_price_per_million: 0.15,
        output_price_per_million: 0.2,
        pricing_source: 'official_docs',
      },
      pricing_provenance: 'verified',
      cost_status: 'unknown',
      estimated_cost_usd: null,
      latency_ms: 90,
      success: false,
      status: 'failed',
      error_message: 'Rate limit reached',
      error_category: 'upstream_rate_limit',
      routed_by: 'direct',
      timestamp: new Date().toISOString(),
    },
  ];

  it('filters events by execution location (local vs remote)', () => {
    const localEvents = sampleEvents.filter((e) => e.execution_location === 'local');
    const remoteEvents = sampleEvents.filter((e) => e.execution_location === 'remote');

    expect(localEvents.length).toBe(1);
    expect(localEvents[0].provider_type).toBe('ollama');

    expect(remoteEvents.length).toBe(2);
  });

  it('filters events by status (success vs failed)', () => {
    const successEvents = sampleEvents.filter((e) => e.status === 'success');
    const failedEvents = sampleEvents.filter((e) => e.status === 'failed');

    expect(successEvents.length).toBe(2);
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].error_message).toBe('Rate limit reached');
  });

  it('filters events by model ID', () => {
    const m1Events = sampleEvents.filter((e) => e.workspace_model_id === 'm1');
    expect(m1Events.length).toBe(2);
  });

  it('aggregates tokens and costs without treating unpriced local compute as 0.00 spend', () => {
    let knownSpend = 0;
    let pricedCount = 0;
    let unpricedCount = 0;

    sampleEvents.forEach((e) => {
      if (e.cost_status === 'known' && e.estimated_cost_usd !== null) {
        knownSpend += e.estimated_cost_usd;
        pricedCount++;
      } else {
        unpricedCount++;
      }
    });

    expect(knownSpend).toBe(0.000025);
    expect(pricedCount).toBe(1);
    expect(unpricedCount).toBe(2); // e2 is local compute, e3 is failed
  });

  it('handles empty dataset gracefully with zero totals', () => {
    const emptyEvents: UsageEvent[] = [];
    const totalRequests = emptyEvents.length;
    const totalTokens = emptyEvents.reduce((acc, cur) => acc + (cur.total_tokens || 0), 0);
    const avgLatency =
      emptyEvents.length > 0
        ? emptyEvents.reduce((acc, cur) => acc + cur.latency_ms, 0) / emptyEvents.length
        : null;

    expect(totalRequests).toBe(0);
    expect(totalTokens).toBe(0);
    expect(avgLatency).toBeNull();
  });
});
