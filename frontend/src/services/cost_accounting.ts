import {
  CostStatus,
  ExecutionLocation,
  PricingSnapshot,
  PricingProvenance,
} from '../types';

export interface CostCalculationResult {
  estimatedCostUsd: number | null;
  costStatus: CostStatus;
  pricingProvenance: PricingProvenance;
}

/**
 * Calculates estimated API cost for a request.
 *
 * Rules:
 * 1. For local models: Hardware and electricity have real costs. Unless an explicit
 *    local compute-cost model is configured, cost is marked as 'unknown' (null),
 *    never falsely claimed as 0.00 / free.
 * 2. For remote models:
 *    - Both input and output token counts must be valid non-negative numbers.
 *    - Both input and output prices must be valid numbers (can be 0.0 if explicitly configured free tier).
 *    - If prices are null, undefined, or negative, cost is marked as 'unknown' (null).
 *    - Explicit 0.0 price is preserved as $0.00 with costStatus 'known'.
 * 3. Formula:
 *    (input_tokens * input_price_per_million + output_tokens * output_price_per_million) / 1,000,000
 */
export function calculateUsageCost(params: {
  promptTokens: number | null | undefined;
  completionTokens: number | null | undefined;
  pricingSnapshot: PricingSnapshot | null | undefined;
  executionLocation: ExecutionLocation;
}): CostCalculationResult {
  const { promptTokens, completionTokens, pricingSnapshot, executionLocation } = params;

  // Rule 1: Local execution without explicit compute pricing
  if (executionLocation === 'local') {
    const hasComputeRate =
      pricingSnapshot &&
      typeof pricingSnapshot.local_compute_price_per_million === 'number' &&
      pricingSnapshot.local_compute_price_per_million >= 0;

    const hasExplicitInputRate =
      pricingSnapshot &&
      typeof pricingSnapshot.input_price_per_million === 'number' &&
      pricingSnapshot.input_price_per_million > 0;

    if (!hasComputeRate && !hasExplicitInputRate) {
      return {
        estimatedCostUsd: null,
        costStatus: 'unknown',
        pricingProvenance: 'unknown',
      };
    }

    if (hasComputeRate && pricingSnapshot) {
      const pTokens = typeof promptTokens === 'number' && promptTokens >= 0 ? promptTokens : 0;
      const cTokens = typeof completionTokens === 'number' && completionTokens >= 0 ? completionTokens : 0;
      if (promptTokens === null && completionTokens === null) {
        return {
          estimatedCostUsd: null,
          costStatus: 'unknown',
          pricingProvenance: 'configured',
        };
      }
      const computeRate = pricingSnapshot.local_compute_price_per_million || 0;
      const totalCost = Number((((pTokens + cTokens) * computeRate) / 1_000_000).toFixed(8));
      return {
        estimatedCostUsd: totalCost,
        costStatus: 'known',
        pricingProvenance: 'configured',
      };
    }
  }

  // Rule 2: Remote execution or explicit local compute pricing
  if (!pricingSnapshot) {
    return {
      estimatedCostUsd: null,
      costStatus: 'unknown',
      pricingProvenance: 'unknown',
    };
  }

  const { input_price_per_million, output_price_per_million, pricing_source } = pricingSnapshot;

  // Check if pricing is missing / unknown
  const isInputPriceValid =
    typeof input_price_per_million === 'number' && !isNaN(input_price_per_million) && input_price_per_million >= 0;
  const isOutputPriceValid =
    typeof output_price_per_million === 'number' && !isNaN(output_price_per_million) && output_price_per_million >= 0;

  if (!isInputPriceValid || !isOutputPriceValid) {
    return {
      estimatedCostUsd: null,
      costStatus: 'unknown',
      pricingProvenance: 'unknown',
    };
  }

  // Token counts must be available
  const pTokens = typeof promptTokens === 'number' && promptTokens >= 0 ? promptTokens : 0;
  const cTokens = typeof completionTokens === 'number' && completionTokens >= 0 ? completionTokens : 0;

  // If token counts are completely unavailable (e.g. streaming failed before usage)
  if (promptTokens === null && completionTokens === null) {
    return {
      estimatedCostUsd: null,
      costStatus: 'unknown',
      pricingProvenance: pricing_source === 'official_docs' ? 'verified' : 'configured',
    };
  }

  const inputCost = (pTokens * input_price_per_million) / 1_000_000;
  const outputCost = (cTokens * output_price_per_million) / 1_000_000;
  const totalCost = Number((inputCost + outputCost).toFixed(8));

  const pricingProvenance: PricingProvenance =
    pricing_source === 'official_docs' || pricing_source === 'verified'
      ? 'verified'
      : pricing_source === 'unknown'
      ? 'unknown'
      : 'configured';

  return {
    estimatedCostUsd: totalCost,
    costStatus: 'known',
    pricingProvenance,
  };
}

/**
 * Format USD cost with micro-dollar precision where needed.
 */
export function formatCost(
  costUsd: number | null | undefined,
  costStatus?: CostStatus
): string {
  if (costStatus === 'unknown' || costUsd === null || costUsd === undefined) {
    return 'Unknown';
  }
  if (costUsd === 0) {
    return '$0.00';
  }
  if (costUsd < 0.0001) {
    return `$${costUsd.toFixed(6)}`;
  }
  if (costUsd < 0.01) {
    return `$${costUsd.toFixed(4)}`;
  }
  return `$${costUsd.toFixed(3)}`;
}

/**
 * Format token counts with commas or unavailable fallback.
 */
export function formatTokens(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined) {
    return 'Unavailable';
  }
  return tokens.toLocaleString();
}

/**
 * Calculate statistical percentile (e.g. 50, 90, 95) from a list of numbers.
 */
export function calculatePercentile(values: number[], percentile: number): number | null {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) return Math.round(sorted[lower] * 10) / 10;
  return Math.round((sorted[lower] * (1 - weight) + sorted[upper] * weight) * 10) / 10;
}
