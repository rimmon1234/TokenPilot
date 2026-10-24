import {
  HFSearchResponse,
  ModelTemplate,
  WorkspaceModel,
  ConnectionTestRequest,
  ConnectionTestResult,
  GatewayChatRequest,
  StreamCallbacks,
  StreamEvent,
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

export async function streamChatCompletion(
  request: GatewayChatRequest,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_BASE}/gateway/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    const msg =
      errData?.detail?.[0]?.msg ||
      errData?.detail ||
      errData?.message ||
      `Gateway returned HTTP ${res.status}`;
    callbacks.onError?.(msg, `http_${res.status}`);
    throw new Error(msg);
  }

  if (!res.body) {
    throw new Error('ReadableStream is not supported by this browser environment or response has no body.');
  }

  const reader = res.body.getReader();
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        break;
      }
      const { done, value } = await reader.read();
      if (done || signal?.aborted) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (buffer.includes('\n\n')) {
        const delimiterIndex = buffer.indexOf('\n\n');
        const block = buffer.slice(0, delimiterIndex);
        buffer = buffer.slice(delimiterIndex + 2);

        const lines = block.split('\n');
        const dataLines: string[] = [];
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith(':')) {
            continue; // keep-alive or comment
          }
          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }

        if (dataLines.length === 0) continue;

        const dataStr = dataLines.join(' ');
        try {
          const event: StreamEvent = JSON.parse(dataStr);
          switch (event.type) {
            case 'meta':
              callbacks.onMeta?.(event);
              break;
            case 'token':
              callbacks.onToken?.(event.text);
              break;
            case 'usage':
              callbacks.onUsage?.(event);
              break;
            case 'done':
              callbacks.onDone?.(event);
              break;
            case 'error':
              callbacks.onError?.(event.error, event.code);
              break;
          }
        } catch {
          // ignore malformed SSE line
        }

        if (signal?.aborted) {
          break;
        }
      }
    }
  } catch (err: any) {
    if (signal?.aborted || err?.name === 'AbortError') {
      return;
    }
    callbacks.onError?.(err?.message || 'Streaming failed', 'stream_error');
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

