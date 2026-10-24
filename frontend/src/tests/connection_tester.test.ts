import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testModelConnection } from '../services/api';
import { ConnectionTestRequest, ConnectionTestResult } from '../types';

describe('Frontend Connection Testing Service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('successfully returns connection test result from backend', async () => {
    const mockResult: ConnectionTestResult = {
      status: 'connected',
      provider_type: 'ollama',
      sanitized_model_id: 'llama3.2:3b',
      endpoint_reachable: true,
      auth_status: 'not_required',
      inference_verified: false,
      latency_ms: 45.2,
      tested_at: new Date().toISOString(),
      diagnostic_message: "Endpoint reachable and model 'llama3.2:3b' confirmed.",
      retryable: false,
      safe_details: { model_matched: true },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResult,
    }));

    const request: ConnectionTestRequest = {
      provider_type: 'ollama',
      execution_mode: 'local_openai_compatible',
      provider_model_id: 'llama3.2:3b',
      base_url: 'http://localhost:11434/v1',
    };

    const res = await testModelConnection(request);
    expect(res.status).toBe('connected');
    expect(res.endpoint_reachable).toBe(true);
    expect(res.latency_ms).toBe(45.2);
    expect(res.inference_verified).toBe(false);
    expect(res.safe_details?.model_matched).toBe(true);
  });

  it('handles authentication failure response cleanly', async () => {
    const mockResult: ConnectionTestResult = {
      status: 'authentication_failed',
      provider_type: 'openai',
      sanitized_model_id: 'gpt-4o',
      endpoint_reachable: true,
      auth_status: 'invalid',
      inference_verified: false,
      latency_ms: 120.0,
      tested_at: new Date().toISOString(),
      diagnostic_message: 'Authentication rejected (HTTP 401).',
      retryable: true,
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResult,
    }));

    const request: ConnectionTestRequest = {
      provider_type: 'openai',
      execution_mode: 'remote_openai_compatible',
      provider_model_id: 'gpt-4o',
      base_url: 'https://api.openai.com/v1',
      transient_credential: 'sk-bad-token',
    };

    const res = await testModelConnection(request);
    expect(res.status).toBe('authentication_failed');
    expect(res.auth_status).toBe('invalid');
    expect(res.retryable).toBe(true);
  });

  it('throws structured error message on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Internal diagnostic probe exception' }),
    }));

    const request: ConnectionTestRequest = {
      provider_type: 'ollama',
      execution_mode: 'local_openai_compatible',
      provider_model_id: 'test',
    };

    await expect(testModelConnection(request)).rejects.toThrow('Internal diagnostic probe exception');
  });
});
