import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamChatCompletion } from '../services/api';
import { GatewayChatRequest, StreamMetaEvent, StreamDoneEvent, StreamUsageEvent } from '../types';

describe('Frontend Gateway Streaming Service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const baseRequest: GatewayChatRequest = {
    provider_type: 'ollama',
    execution_mode: 'local_openai_compatible',
    provider_model_id: 'llama3.2:3b',
    base_url: 'http://localhost:11434/v1',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: true,
  };

  it('correctly processes incremental streaming events from gateway', async () => {
    const ssePayload = [
      'data: {"type":"meta","request_id":"req-123","model_id":"m1","provider_model_id":"llama3.2:3b","provider_type":"ollama","execution_mode":"local_openai_compatible"}\n\n',
      'data: {"type":"token","text":"Hello"}\n\n',
      'data: {"type":"token","text":" there!"}\n\n',
      'data: {"type":"usage","prompt_tokens":8,"completion_tokens":2,"total_tokens":10,"provenance":"provider_reported","estimated_cost_usd":0.000002}\n\n',
      'data: {"type":"done","finish_reason":"stop","latency_ms":125.4,"ttft_ms":45.2}\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(ssePayload));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    }));

    let receivedMeta: StreamMetaEvent | null = null;
    let accumulatedText = '';
    let receivedUsage: StreamUsageEvent | null = null;
    let receivedDone: StreamDoneEvent | null = null;

    await streamChatCompletion(baseRequest, {
      onMeta: (meta) => { receivedMeta = meta; },
      onToken: (t) => { accumulatedText += t; },
      onUsage: (u) => { receivedUsage = u; },
      onDone: (d) => { receivedDone = d; },
    });

    expect(receivedMeta).toEqual({
      type: 'meta',
      request_id: 'req-123',
      model_id: 'm1',
      provider_model_id: 'llama3.2:3b',
      provider_type: 'ollama',
      execution_mode: 'local_openai_compatible',
    });
    expect(accumulatedText).toBe('Hello there!');
    expect(receivedUsage).not.toBeNull();
    expect((receivedUsage as any)?.total_tokens).toBe(10);
    expect((receivedUsage as any)?.provenance).toBe('provider_reported');
    expect(receivedDone).not.toBeNull();
    expect((receivedDone as any)?.finish_reason).toBe('stop');
    expect((receivedDone as any)?.latency_ms).toBe(125.4);
  });

  it('handles fragmented network chunks across buffer boundaries', async () => {
    const chunk1 = 'data: {"type":"token","text":"Frag';
    const chunk2 = 'mented"}\n\ndata: {"type":"done","finish_reason":"stop","latency_ms":50}\n\n';

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(chunk1));
        setTimeout(() => {
          controller.enqueue(encoder.encode(chunk2));
          controller.close();
        }, 10);
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    }));

    let text = '';
    let isDone = false;

    await streamChatCompletion(baseRequest, {
      onToken: (t) => { text += t; },
      onDone: () => { isDone = true; },
    });

    expect(text).toBe('Fragmented');
    expect(isDone).toBe(true);
  });

  it('handles HTTP error responses before stream initiation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'Execution mode huggingface_local_transformers is not supported' }),
    }));

    let reportedError = '';
    let reportedCode = '';

    await expect(
      streamChatCompletion(baseRequest, {
        onError: (err, code) => {
          reportedError = err;
          reportedCode = code || '';
        },
      })
    ).rejects.toThrow('Execution mode huggingface_local_transformers is not supported');

    expect(reportedError).toBe('Execution mode huggingface_local_transformers is not supported');
    expect(reportedCode).toBe('http_422');
  });

  it('handles in-stream error events emitted by the gateway', async () => {
    const ssePayload = 'data: {"type":"error","error":"Upstream rate limit reached","code":"http_429"}\n\n';
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(ssePayload));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    }));

    let reportedError = '';
    let reportedCode = '';

    await streamChatCompletion(baseRequest, {
      onError: (err, code) => {
        reportedError = err;
        reportedCode = code || '';
      },
    });

    expect(reportedError).toBe('Upstream rate limit reached');
    expect(reportedCode).toBe('http_429');
  });

  it('aborts stream cleanly when AbortSignal fires', async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(streamController) {
        streamController.enqueue(encoder.encode('data: {"type":"token","text":"Part 1"}\n\n'));
      },
      cancel() {
        // Mock stream cleanup
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    }));

    let receivedText = '';
    const promise = streamChatCompletion(
      baseRequest,
      {
        onToken: (t) => {
          receivedText += t;
          controller.abort();
        },
      },
      controller.signal
    );

    await promise;
    expect(receivedText).toBe('Part 1');
  });
});
