import { describe, it, expect } from 'vitest';
import {
  calculateUsageCost,
  formatCost,
  formatTokens,
  calculatePercentile,
} from '../services/cost_accounting';
import { PricingSnapshot } from '../types';

describe('Cost Accounting and Metrics Engine', () => {
  it('correctly calculates known cost using the standard formula', () => {
    // 1000 input tokens at $1.50/M + 500 output tokens at $2.00/M
    // (1000 * 1.5 + 500 * 2.0) / 1,000,000 = (1500 + 1000) / 1,000,000 = 0.0025
    const snapshot: PricingSnapshot = {
      input_price_per_million: 1.5,
      output_price_per_million: 2.0,
      pricing_source: 'official_docs',
    };

    const result = calculateUsageCost({
      promptTokens: 1000,
      completionTokens: 500,
      pricingSnapshot: snapshot,
      executionLocation: 'remote',
    });

    expect(result.costStatus).toBe('known');
    expect(result.estimatedCostUsd).toBe(0.0025);
    expect(result.pricingProvenance).toBe('verified');
  });

  it('marks local execution cost as unknown by default rather than claiming 0.00 free', () => {
    const snapshot: PricingSnapshot = {
      input_price_per_million: 0,
      output_price_per_million: 0,
      pricing_source: 'free_local',
    };

    const result = calculateUsageCost({
      promptTokens: 500,
      completionTokens: 250,
      pricingSnapshot: snapshot,
      executionLocation: 'local',
    });

    // Must NOT claim local compute is free (0.00)
    expect(result.costStatus).toBe('unknown');
    expect(result.estimatedCostUsd).toBeNull();
  });

  it('distinguishes explicitly configured zero price from missing/unknown price', () => {
    // Explicit remote free tier (e.g. promotional API tier)
    const zeroSnapshot: PricingSnapshot = {
      input_price_per_million: 0.0,
      output_price_per_million: 0.0,
      pricing_source: 'promotional_free_tier',
      is_free_tier: true,
    };

    const zeroResult = calculateUsageCost({
      promptTokens: 200,
      completionTokens: 100,
      pricingSnapshot: zeroSnapshot,
      executionLocation: 'remote',
    });

    expect(zeroResult.costStatus).toBe('known');
    expect(zeroResult.estimatedCostUsd).toBe(0.0);

    // Missing / unknown price
    const missingSnapshot: PricingSnapshot = {
      input_price_per_million: null,
      output_price_per_million: null,
      pricing_source: 'unknown',
    };

    const missingResult = calculateUsageCost({
      promptTokens: 200,
      completionTokens: 100,
      pricingSnapshot: missingSnapshot,
      executionLocation: 'remote',
    });

    expect(missingResult.costStatus).toBe('unknown');
    expect(missingResult.estimatedCostUsd).toBeNull();
  });

  it('marks cost as unknown when token counts are unavailable', () => {
    const snapshot: PricingSnapshot = {
      input_price_per_million: 5.0,
      output_price_per_million: 15.0,
      pricing_source: 'official_docs',
    };

    const result = calculateUsageCost({
      promptTokens: null,
      completionTokens: null,
      pricingSnapshot: snapshot,
      executionLocation: 'remote',
    });

    expect(result.costStatus).toBe('unknown');
    expect(result.estimatedCostUsd).toBeNull();
  });

  it('formats costs and tokens accurately', () => {
    expect(formatCost(null, 'unknown')).toBe('Unknown');
    expect(formatCost(0, 'known')).toBe('$0.00');
    expect(formatCost(0.000035, 'known')).toBe('$0.000035');
    expect(formatCost(0.0052, 'known')).toBe('$0.0052');
    expect(formatCost(1.254, 'known')).toBe('$1.254');

    expect(formatTokens(null)).toBe('Unavailable');
    expect(formatTokens(1250000)).toBe('1,250,000');
  });

  it('calculates percentiles correctly for latency metrics', () => {
    const latencies = [100, 150, 200, 250, 300, 350, 400, 450, 500, 1000];
    const p50 = calculatePercentile(latencies, 50);
    const p95 = calculatePercentile(latencies, 95);

    expect(p50).toBe(325);
    expect(p95).toBe(775);
    expect(calculatePercentile([], 50)).toBeNull();
  });
});
