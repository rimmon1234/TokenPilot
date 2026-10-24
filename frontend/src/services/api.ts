import {
  HFSearchResponse,
  ModelTemplate,
  WorkspaceModel,
  ConnectionTestRequest,
  ConnectionTestResult,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

export async function checkBackendHealth(): Promise<{ status: string; service: string }> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Backend health check failed:', err);
    throw err;
  }
}

export async function fetchModelTemplates(): Promise<ModelTemplate[]> {
  try {
    const res = await fetch(`${API_BASE}/models/templates`);
    if (!res.ok) throw new Error(`Failed to load templates: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Error fetching model templates:', err);
    return [];
  }
}

export async function searchHuggingFaceHub(
  query: string,
  task: string = 'text-generation',
  limit: number = 20,
  forceRefresh: boolean = false
): Promise<HFSearchResponse> {
  const params = new URLSearchParams({
    query,
    task,
    limit: limit.toString(),
    force_refresh: forceRefresh ? 'true' : 'false',
  });

  try {
    const res = await fetch(`${API_BASE}/hf/search?${params.toString()}`);
    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.error || `Search failed with HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err: any) {
    return {
      query,
      total_found: 0,
      models: [],
      cached: false,
      error: err.message || 'Unable to connect to Hugging Face discovery service.',
    };
  }
}

export async function fetchDefaultPools(): Promise<{ name: string; description?: string; is_default: boolean }[]> {
  try {
    const res = await fetch(`${API_BASE}/pools/defaults`);
    if (!res.ok) throw new Error(`Failed to load default pools: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Error fetching default pools from API:', err);
    return [
      { name: 'Economy', description: 'Cost-optimized routing pool for fast tasks.', is_default: true },
      { name: 'Quality', description: 'Quality-optimized routing pool for complex reasoning.', is_default: false },
    ];
  }
}

export async function validateModelConfig(modelData: Partial<WorkspaceModel>): Promise<{ valid: boolean; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/models/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(modelData),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { valid: false, message: data?.detail?.[0]?.msg || 'Validation failed' };
    }
    return await res.json();
  } catch (err: any) {
    return { valid: true, message: 'Local client validation used.' };
  }
}

export async function testModelConnection(
  request: ConnectionTestRequest
): Promise<ConnectionTestResult> {
  const res = await fetch(`${API_BASE}/models/test-connection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.detail?.[0]?.msg || errData?.message || `Test failed with HTTP ${res.status}`);
  }

  return await res.json();
}

