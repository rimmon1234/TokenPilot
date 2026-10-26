import { describe, it, expect } from 'vitest';
import {
  resolveModelMetadata,
  formatRuntimeProvider,
  formatModelSource,
} from '../services/metadata_resolver';
import { WorkspaceModel, ModelScoringSummary } from '../types';

describe('Metadata Resolver & Label Formatting', () => {
  it('correctly disambiguates Qwen: Hugging Face Hub origin with local Ollama runtime', () => {
    const qwenModel: Partial<WorkspaceModel> = {
      display_name: 'Qwen 2.5 Coder 7B Instruct',
      provider_model_id: 'qwen2.5-coder:7b',
      huggingface_repo_id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
      provider_type: 'huggingface',
      execution_mode: 'local_openai_compatible',
      execution_location: 'local',
      base_url: 'http://localhost:11434/v1',
    };

    const resolved = resolveModelMetadata(qwenModel as WorkspaceModel);

    expect(resolved.source).toBe('Hugging Face Hub');
    expect(resolved.sourceRepoId).toBe('Qwen/Qwen2.5-Coder-7B-Instruct');
    expect(resolved.runtime).toBe('Ollama');
    expect(resolved.location).toBe('Local');
    expect(resolved.runtimeModelId).toBe('qwen2.5-coder:7b');
    expect(resolved.runtime_display).toBe('Ollama');
  });

  it('correctly resolves Llama from Ollama library on local runtime', () => {
    const llamaModel: Partial<WorkspaceModel> = {
      display_name: 'Llama 3.2 3B',
      provider_model_id: 'llama3.2:3b',
      provider_type: 'ollama',
      execution_mode: 'local_openai_compatible',
      execution_location: 'local',
      base_url: 'http://localhost:11434/v1',
    };

    const resolved = resolveModelMetadata(llamaModel as WorkspaceModel);

    expect(resolved.source).toBe('Ollama Library');
    expect(resolved.sourceRepoId).toBeUndefined();
    expect(resolved.runtime).toBe('Ollama');
    expect(resolved.location).toBe('Local');
    expect(resolved.runtimeModelId).toBe('llama3.2:3b');
  });

  it('correctly resolves hosted Hugging Face Inference Providers', () => {
    const hfHostedModel: Partial<WorkspaceModel> = {
      display_name: 'Remote Llama 3',
      provider_model_id: 'meta-llama/Llama-3.2-3B-Instruct',
      huggingface_repo_id: 'meta-llama/Llama-3.2-3B-Instruct',
      provider_type: 'huggingface',
      execution_mode: 'huggingface_inference_providers',
      execution_location: 'remote',
    };

    const resolved = resolveModelMetadata(hfHostedModel as WorkspaceModel);

    expect(resolved.source).toBe('Hugging Face Hub');
    expect(resolved.runtime).toBe('HF Inference Providers');
    expect(resolved.location).toBe('Remote');
    expect(resolved.runtimeModelId).toBe('meta-llama/Llama-3.2-3B-Instruct');
  });

  it('resolves ModelScoringSummary with snapshot model config override', () => {
    const summary: Partial<ModelScoringSummary> = {
      model_id: 'custom-123',
      display_name: 'Qwen Local',
      provider_model_id: 'qwen2.5-coder:7b',
      model_source: 'huggingface_hub',
      source_repo_id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
      execution_provider: 'ollama',
      execution_location: 'local',
    };

    const resolved = resolveModelMetadata(summary as ModelScoringSummary);

    expect(resolved.source).toBe('Hugging Face Hub');
    expect(resolved.runtime).toBe('Ollama');
    expect(resolved.location).toBe('Local');
    expect(resolved.runtimeModelId).toBe('qwen2.5-coder:7b');
  });

  it('formats provider and source names consistently', () => {
    expect(formatRuntimeProvider('ollama')).toBe('Ollama');
    expect(formatRuntimeProvider('vllm')).toBe('vLLM');
    expect(formatRuntimeProvider('huggingface_inference_providers')).toBe('HF Inference Providers');
    expect(formatRuntimeProvider('openai')).toBe('OpenAI');
    expect(formatRuntimeProvider('gemini')).toBe('Google Gemini');
    expect(formatRuntimeProvider(undefined)).toBe('Unknown');

    expect(formatModelSource('huggingface_hub')).toBe('Hugging Face Hub');
    expect(formatModelSource('ollama_library')).toBe('Ollama Library');
    expect(formatModelSource('custom')).toBe('Custom');
    expect(formatModelSource(null)).toBe('Custom');
  });
});
