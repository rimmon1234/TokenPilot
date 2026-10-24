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
      id: 'req-event-1',
      request_id: 'req-event-1',
      workspace_model_id: modelId,
      model_display_name_snapshot: 'Temporary Model',
      provider_type: 'ollama',
      provider_model_id: 'llama3:8b',
      execution_location: 'local',
      execution_mode: 'local_openai_compatible',
      prompt_tokens: 120,
      completion_tokens: 45,
      total_tokens: 165,
      token_provenance: 'provider_reported',
      pricing_snapshot: {
        input_price_per_million: 0,
        output_price_per_million: 0,
        pricing_source: 'free',
      },
      pricing_provenance: 'configured',
      cost_status: 'unknown',
      estimated_cost_usd: null,
      latency_ms: 180,
      success: true,
      status: 'success',
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

  it('saves, renames, reloads, and deletes conversations', async () => {
    const convId = 'conv-123';
    const conv = {
      id: convId,
      title: 'Initial Title',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      model_id: 'm1',
      model_display_name_snapshot: 'Qwen 2.5 Coder',
      messages: [
        { role: 'user' as const, content: 'Hello there' },
        { role: 'assistant' as const, content: 'General Kenobi' },
      ],
      last_status: 'completed' as const,
    };

    await repo.saveConversation(conv);

    const loaded = await repo.getConversation(convId);
    expect(loaded).toBeDefined();
    expect(loaded?.title).toBe('Initial Title');
    expect(loaded?.messages.length).toBe(2);

    // Rename
    await repo.saveConversation({
      ...loaded!,
      title: 'Renamed Conversation',
      updated_at: new Date().toISOString(),
    });

    const updated = await repo.getConversation(convId);
    expect(updated?.title).toBe('Renamed Conversation');

    // Delete
    await repo.deleteConversation(convId);
    const deleted = await repo.getConversation(convId);
    expect(deleted).toBeUndefined();
  });

  it('deleting a conversation preserves unrelated usage events', async () => {
    const convId = 'conv-to-delete';
    await repo.saveConversation({
      id: convId,
      title: 'Chat with usage',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      messages: [{ role: 'user', content: 'What is 2+2?' }],
    });

    const usageEvent: UsageEvent = {
      id: 'req-conv-1',
      request_id: 'req-conv-1',
      conversation_id: convId,
      workspace_model_id: 'm1',
      model_display_name_snapshot: 'Qwen 2.5 Coder',
      provider_type: 'huggingface',
      provider_model_id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
      execution_location: 'remote',
      execution_mode: 'huggingface_inference_providers',
      prompt_tokens: 15,
      completion_tokens: 5,
      total_tokens: 20,
      token_provenance: 'provider_reported',
      pricing_snapshot: {
        input_price_per_million: 0.15,
        output_price_per_million: 0.20,
        pricing_source: 'provider_averages',
      },
      pricing_provenance: 'configured',
      cost_status: 'known',
      estimated_cost_usd: 0.00000325,
      latency_ms: 120,
      success: true,
      status: 'success',
      routed_by: 'direct',
      timestamp: new Date().toISOString(),
    };
    await repo.recordUsageEvent(usageEvent);

    // Delete conversation
    await repo.deleteConversation(convId);
    const conv = await repo.getConversation(convId);
    expect(conv).toBeUndefined();

    // Verify usage event remains intact
    const events = await repo.getUsageEvents();
    expect(events.length).toBe(1);
    expect(events[0].request_id).toBe('req-conv-1');
  });

  it('prevents duplicate usage events by updating idempotently on same request ID', async () => {
    const reqId = 'req-stream-unique';
    const initialEvent: UsageEvent = {
      id: reqId,
      request_id: reqId,
      workspace_model_id: 'm1',
      model_display_name_snapshot: 'Test Model',
      provider_type: 'openai',
      provider_model_id: 'gpt-4o',
      execution_location: 'remote',
      execution_mode: 'remote_openai_compatible',
      prompt_tokens: 10,
      completion_tokens: 0,
      total_tokens: 10,
      token_provenance: 'provider_reported',
      pricing_snapshot: {
        input_price_per_million: 2.5,
        output_price_per_million: 10.0,
        pricing_source: 'official_docs',
      },
      pricing_provenance: 'verified',
      cost_status: 'known',
      estimated_cost_usd: 0.000025,
      latency_ms: 50,
      success: true,
      status: 'success',
      routed_by: 'direct',
      timestamp: new Date().toISOString(),
    };

    // First arrival (e.g. usage event)
    await repo.recordUsageEvent(initialEvent);

    // Second arrival for same request (e.g. done event with final latency)
    const finalizedEvent: UsageEvent = {
      ...initialEvent,
      completion_tokens: 25,
      total_tokens: 35,
      latency_ms: 220,
      estimated_cost_usd: 0.000275,
    };
    await repo.recordUsageEvent(finalizedEvent);

    const allEvents = await repo.getUsageEvents();
    expect(allEvents.length).toBe(1);
    expect(allEvents[0].completion_tokens).toBe(25);
    expect(allEvents[0].latency_ms).toBe(220);
  });

  it('stores and updates workspace retention settings', async () => {
    const defaultSettings = await repo.getSettings();
    expect(defaultSettings.retain_prompts).toBe(true);

    await repo.saveSettings({ retain_prompts: false });
    const updatedSettings = await repo.getSettings();
    expect(updatedSettings.retain_prompts).toBe(false);
  });

  it('preserves historical pricing snapshots when a model configuration price is edited', async () => {
    const modelId = 'dynamic-price-model';
    const initialModel: WorkspaceModel = {
      id: modelId,
      display_name: 'Dynamic Model',
      source_type: 'custom',
      provider_type: 'openai',
      execution_mode: 'remote_openai_compatible',
      execution_location: 'remote',
      provider_model_id: 'gpt-4o',
      license: 'proprietary',
      gated_status: 'none',
      capabilities: {
        supports_tools: true,
        supports_vision: true,
        supports_streaming: true,
        supports_json_mode: true,
      },
      context_window: 128000,
      input_price_per_million: 2.5,
      output_price_per_million: 10.0,
      pricing_source: 'official_docs',
      enabled: true,
      evaluation_status: 'unbenchmarked',
      assigned_pool_ids: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await repo.saveWorkspaceModel(initialModel);

    // Record request with initial pricing snapshot
    const initialSnapshot = {
      input_price_per_million: initialModel.input_price_per_million,
      output_price_per_million: initialModel.output_price_per_million,
      pricing_source: initialModel.pricing_source,
    };
    const historicalUsage: UsageEvent = {
      id: 'req-history-1',
      request_id: 'req-history-1',
      workspace_model_id: modelId,
      model_display_name_snapshot: initialModel.display_name,
      provider_type: initialModel.provider_type,
      provider_model_id: initialModel.provider_model_id,
      execution_location: 'remote',
      execution_mode: 'remote_openai_compatible',
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
      token_provenance: 'provider_reported',
      pricing_snapshot: initialSnapshot,
      pricing_provenance: 'verified',
      cost_status: 'known',
      estimated_cost_usd: (1000 * 2.5 + 500 * 10.0) / 1_000_000,
      latency_ms: 350,
      success: true,
      status: 'success',
      routed_by: 'direct',
      timestamp: new Date().toISOString(),
    };
    await repo.recordUsageEvent(historicalUsage);

    // Later: Model price changes in workspace (e.g. price drops or increases)
    await repo.saveWorkspaceModel({
      ...initialModel,
      input_price_per_million: 1.25,
      output_price_per_million: 5.0,
      updated_at: new Date().toISOString(),
    });

    // Verify historical record still retains original snapshot and calculated cost
    const records = await repo.getUsageEvents();
    const recorded = records.find((r) => r.id === 'req-history-1');
    expect(recorded).toBeDefined();
    expect(recorded?.pricing_snapshot.input_price_per_million).toBe(2.5);
    expect(recorded?.pricing_snapshot.output_price_per_million).toBe(10.0);
    expect(recorded?.estimated_cost_usd).toBe(0.0075);
  });

  it('records failed and cancelled streaming requests with correct statuses', async () => {
    const failedEvent: UsageEvent = {
      id: 'req-failed-1',
      request_id: 'req-failed-1',
      workspace_model_id: 'm1',
      model_display_name_snapshot: 'Test Model',
      provider_type: 'huggingface',
      provider_model_id: 'meta-llama/Llama-3.1-8B-Instruct',
      execution_location: 'remote',
      execution_mode: 'huggingface_inference_providers',
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      token_provenance: 'unavailable',
      pricing_snapshot: {
        input_price_per_million: 0.15,
        output_price_per_million: 0.2,
        pricing_source: 'provider_averages',
      },
      pricing_provenance: 'configured',
      cost_status: 'unknown',
      estimated_cost_usd: null,
      latency_ms: 125,
      finish_reason: 'error',
      success: false,
      status: 'failed',
      error_message: 'Hugging Face rate limit exceeded',
      error_category: 'upstream_rate_limit',
      routed_by: 'direct',
      timestamp: new Date().toISOString(),
    };
    await repo.recordUsageEvent(failedEvent);

    const cancelledEvent: UsageEvent = {
      id: 'req-cancel-1',
      request_id: 'req-cancel-1',
      workspace_model_id: 'm1',
      model_display_name_snapshot: 'Test Model',
      provider_type: 'ollama',
      provider_model_id: 'llama3:8b',
      execution_location: 'local',
      execution_mode: 'local_openai_compatible',
      prompt_tokens: 50,
      completion_tokens: 12,
      total_tokens: 62,
      token_provenance: 'provider_reported',
      pricing_snapshot: {
        input_price_per_million: 0,
        output_price_per_million: 0,
        pricing_source: 'free',
      },
      pricing_provenance: 'unknown',
      cost_status: 'unknown',
      estimated_cost_usd: null,
      latency_ms: 80,
      finish_reason: 'cancelled',
      success: false,
      status: 'cancelled',
      error_message: 'Request cancelled by user.',
      routed_by: 'direct',
      timestamp: new Date().toISOString(),
    };
    await repo.recordUsageEvent(cancelledEvent);

    const all = await repo.getUsageEvents();
    const fail = all.find((e) => e.id === 'req-failed-1');
    const cancel = all.find((e) => e.id === 'req-cancel-1');

    expect(fail?.status).toBe('failed');
    expect(fail?.error_category).toBe('upstream_rate_limit');
    expect(cancel?.status).toBe('cancelled');
    expect(cancel?.finish_reason).toBe('cancelled');
  });

  it('guarantees credentials never enter persisted records', async () => {
    const sensitiveToken = 'hf_secret_token_never_persist_12345';
    const convId = 'conv-audit-zero-secret';

    await repo.saveConversation({
      id: convId,
      title: 'Secret check',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      messages: [{ role: 'user', content: 'Tell me a secret' }],
    });

    const usage: UsageEvent = {
      id: 'req-sec-1',
      request_id: 'req-sec-1',
      conversation_id: convId,
      workspace_model_id: 'm1',
      model_display_name_snapshot: 'Qwen 2.5 Coder',
      provider_type: 'huggingface',
      provider_model_id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
      execution_location: 'remote',
      execution_mode: 'huggingface_inference_providers',
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      token_provenance: 'provider_reported',
      pricing_snapshot: {
        input_price_per_million: 0.15,
        output_price_per_million: 0.2,
        pricing_source: 'official_docs',
      },
      pricing_provenance: 'verified',
      cost_status: 'known',
      estimated_cost_usd: 0.0000025,
      latency_ms: 100,
      success: true,
      status: 'success',
      routed_by: 'direct',
      timestamp: new Date().toISOString(),
    };
    await repo.recordUsageEvent(usage);

    const savedConv = await repo.getConversation(convId);
    const savedUsage = (await repo.getUsageEvents()).find((u) => u.id === 'req-sec-1');

    const convJson = JSON.stringify(savedConv);
    const usageJson = JSON.stringify(savedUsage);

    expect(convJson).not.toContain(sensitiveToken);
    expect(usageJson).not.toContain(sensitiveToken);
    expect((savedUsage as any).transient_credential).toBeUndefined();
    expect((savedUsage as any).api_key).toBeUndefined();
  });
});
