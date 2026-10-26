import {
  BenchmarkModelConfig,
  BenchmarkResult,
  ModelScoringSummary,
  WorkspaceModel,
} from '../types';

export interface ResolvedModelMeta {
  displayName: string;
  source: string;
  sourceRepoId?: string;
  runtime: string;
  location: 'Local' | 'Remote' | 'Unknown';
  runtimeModelId: string;
  source_display: string;
  runtime_display: string;
  runtime_model_id: string;
  execution_location: 'local' | 'remote' | 'unknown';
}

/**
 * Format system identifiers into polished human-readable labels.
 */
export function formatRuntimeProvider(provider: string | null | undefined): string {
  if (!provider) return 'Unknown';
  const p = provider.toLowerCase().trim();
  switch (p) {
    case 'ollama':
      return 'Ollama';
    case 'vllm':
      return 'vLLM';
    case 'huggingface':
      return 'Hugging Face';
    case 'huggingface_inference_providers':
      return 'HF Inference Providers';
    case 'huggingface_inference_endpoint':
      return 'HF Dedicated Endpoint';
    case 'huggingface_local_transformers':
      return 'HF Local Transformers';
    case 'openai':
      return 'OpenAI';
    case 'gemini':
      return 'Google Gemini';
    case 'groq':
      return 'Groq';
    case 'local_openai_compatible':
      return 'Local Runtime';
    case 'remote_openai_compatible':
      return 'Remote Provider';
    default:
      return provider;
  }
}

export function formatModelSource(source: string | null | undefined): string {
  if (!source) return 'Custom';
  const s = source.toLowerCase().trim();
  switch (s) {
    case 'huggingface_hub':
    case 'huggingface':
      return 'Hugging Face Hub';
    case 'ollama_library':
      return 'Ollama Library';
    case 'custom':
      return 'Custom';
    default:
      return source;
  }
}

/**
 * Resolve disambiguated model source, runtime provider, location, and runtime model ID.
 * Respects effective configuration snapshots from benchmark runs and safely handles legacy runs.
 * Rule: Never guesses execution provider from display name alone.
 */
export function resolveModelMetadata(
  summaryOrModel: ModelScoringSummary | WorkspaceModel | BenchmarkResult | Partial<BenchmarkModelConfig>,
  modelConfig?: BenchmarkModelConfig
): ResolvedModelMeta {
  const cfg = modelConfig;
  const anyObj = summaryOrModel as any;

  const displayName = anyObj.display_name || anyObj.model_display_name || cfg?.display_name || anyObj.model_id || 'Unknown Model';
  const rawRuntimeModelId =
    anyObj.provider_model_id || cfg?.provider_model_id || anyObj.runtime_model_id || anyObj.model_id || 'unknown';

  const baseUrl = (cfg?.base_url || anyObj.base_url || '').toLowerCase();
  const execMode = cfg?.execution_mode || anyObj.execution_mode;
  const rawProviderType = (cfg?.provider_type || anyObj.provider_type || '').toLowerCase();
  const rawExecProvider = (anyObj.execution_provider || cfg?.execution_provider || '').toLowerCase();
  const rawLocation = (anyObj.execution_location || cfg?.execution_location || '').toLowerCase();

  // 1. Resolve Location
  let location: 'Local' | 'Remote' | 'Unknown' = 'Unknown';
  if (rawLocation === 'local') {
    location = 'Local';
  } else if (rawLocation === 'remote') {
    location = 'Remote';
  } else if (
    execMode === 'local_openai_compatible' ||
    execMode === 'huggingface_local_transformers' ||
    baseUrl.includes('11434') ||
    baseUrl.includes('localhost') ||
    baseUrl.includes('127.0.0.1') ||
    rawProviderType === 'ollama' ||
    rawExecProvider === 'ollama'
  ) {
    location = 'Local';
  } else if (
    execMode === 'huggingface_inference_providers' ||
    execMode === 'huggingface_inference_endpoint' ||
    execMode === 'remote_openai_compatible'
  ) {
    location = 'Remote';
  }

  // 2. Resolve Runtime Provider
  let runtime = 'Unknown';
  if (rawExecProvider) {
    runtime = formatRuntimeProvider(rawExecProvider);
  } else if (baseUrl.includes('11434') || rawProviderType === 'ollama') {
    runtime = 'Ollama';
  } else if (execMode === 'huggingface_inference_providers') {
    runtime = 'HF Inference Providers';
  } else if (execMode === 'huggingface_inference_endpoint') {
    runtime = 'HF Dedicated Endpoint';
  } else if (execMode === 'huggingface_local_transformers') {
    runtime = 'HF Local Transformers';
  } else if (execMode === 'local_openai_compatible') {
    if (baseUrl.includes('8000') && rawProviderType.includes('vllm')) {
      runtime = 'vLLM';
    } else if (baseUrl.includes('11434') || rawProviderType === 'huggingface' || !rawProviderType) {
      runtime = 'Ollama';
    } else {
      runtime = formatRuntimeProvider(rawProviderType);
    }
  } else if (execMode === 'remote_openai_compatible') {
    runtime = rawProviderType ? formatRuntimeProvider(rawProviderType) : 'Remote Provider';
  } else if (rawProviderType && rawProviderType !== 'huggingface') {
    runtime = formatRuntimeProvider(rawProviderType);
  } else if (rawProviderType === 'huggingface') {
    runtime = location === 'Local' ? 'Ollama' : 'HF Inference Providers';
  }

  // 3. Resolve Source Repository ID & Model Source
  const sourceRepoId =
    anyObj.source_repo_id ||
    cfg?.source_repo_id ||
    anyObj.huggingface_repo_id ||
    cfg?.huggingface_repo_id ||
    undefined;

  let source = 'Custom';
  const rawModelSource = anyObj.model_source || cfg?.model_source;
  if (rawModelSource) {
    source = formatModelSource(rawModelSource);
  } else if (sourceRepoId || rawProviderType === 'huggingface' || anyObj.source_type === 'huggingface_hub') {
    source = 'Hugging Face Hub';
  } else if (runtime === 'Ollama' && !sourceRepoId) {
    source = 'Ollama Library';
  } else {
    source = 'Custom';
  }

  return {
    displayName,
    source,
    sourceRepoId,
    runtime,
    location,
    runtimeModelId: rawRuntimeModelId,
    source_display: source,
    runtime_display: runtime,
    runtime_model_id: rawRuntimeModelId,
    execution_location: location.toLowerCase() as 'local' | 'remote' | 'unknown',
  };
}
