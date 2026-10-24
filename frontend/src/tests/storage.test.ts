import { describe, it, expect, beforeEach } from 'vitest';
import { IndexedDBWorkspaceRepository } from '../storage/indexeddb_repository';
import { WorkspaceModel, RoutingPool, UsageEvent } from '../types';

describe('IndexedDBWorkspaceRepository', () => {
  let repo: IndexedDBWorkspaceRepository;

  beforeEach(() => {
    repo = new IndexedDBWorkspaceRepository();
  });

  it('saves and retrieves workspace models', async () => {
    const model: WorkspaceModel = {
      id: 'model-1',
      display_name: 'Qwen 2.5 Coder',
      source_type: 'huggingface_hub',
      provider_type: 'huggingface',
      execution_mode: 'huggingface_inference_providers',
      execution_location: 'remote',
      provider_model_id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
      license: 'apache-2.0',
      gated_status: 'none',
      capabilities: {
        supports_tools: true,
        supports_vision: false,
        supports_streaming: true,
        supports_json_mode: true,
      },
      context_window: 32768,
      input_price_per_million: 0.15,
      output_price_per_million: 0.2,
      pricing_source: 'provider_averages',
      enabled: true,
      evaluation_status: 'unbenchmarked',
      assigned_pool_ids: ['pool-economy', 'pool-coding'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await repo.saveWorkspaceModel(model);
    const retrieved = await repo.getWorkspaceModel('model-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.display_name).toBe('Qwen 2.5 Coder');
    expect(retrieved?.assigned_pool_ids).toContain('pool-economy');
    expect(retrieved?.assigned_pool_ids).toContain('pool-coding');
  });

  it('allows model to belong to multiple routing pools', async () => {
    const pool1: RoutingPool = {
      id: 'pool-economy',
      name: 'Economy',
      is_default: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const pool2: RoutingPool = {
      id: 'pool-quality',
      name: 'Quality',
      is_default: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await repo.saveRoutingPool(pool1);
    await repo.saveRoutingPool(pool2);

    const pools = await repo.getRoutingPools();
    expect(pools.length).toBe(2);
  });

  it('deleting a model preserves historical usage events', async () => {
    const modelId = 'model-to-delete';
    const model: WorkspaceModel = {
      id: modelId,
      display_name: 'Temporary Model',
      source_type: 'custom',
      provider_type: 'ollama',
      execution_mode: 'local_openai_compatible',
      execution_location: 'local',
      provider_model_id: 'llama3:8b',
      license: 'llama3',
      gated_status: 'none',
      capabilities: {
        supports_tools: false,
        supports_vision: false,
        supports_streaming: true,
        supports_json_mode: false,
      },
      context_window: 8192,
      input_price_per_million: 0,
      output_price_per_million: 0,
      pricing_source: 'free',
      enabled: true,
      evaluation_status: 'unbenchmarked',
      assigned_pool_ids: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await repo.saveWorkspaceModel(model);

    const usageEvent: UsageEvent = {
      id: 'event-1',
      workspace_model_id: modelId,
      model_display_name_snapshot: 'Temporary Model',
      prompt_tokens: 120,
      completion_tokens: 45,
      total_tokens: 165,
      pricing_snapshot: {
        input_price_per_million: 0,
        output_price_per_million: 0,
        pricing_source: 'free',
      },
      estimated_cost_usd: 0,
      latency_ms: 180,
      success: true,
      routed_by: 'direct',
      timestamp: new Date().toISOString(),
    };
    await repo.recordUsageEvent(usageEvent);

    // Now delete the model
    await repo.deleteWorkspaceModel(modelId);

    // Verify model is deleted
    const deletedModel = await repo.getWorkspaceModel(modelId);
    expect(deletedModel).toBeUndefined();

    // Verify usage event remains preserved!
    const events = await repo.getUsageEvents();
    expect(events.length).toBe(1);
    expect(events[0].workspace_model_id).toBe(modelId);
  });
});
