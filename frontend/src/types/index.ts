export type ExecutionMode =
  | 'huggingface_inference_providers'
  | 'huggingface_inference_endpoint'
  | 'huggingface_local_transformers'
  | 'local_openai_compatible'
  | 'remote_openai_compatible';

export type ExecutionLocation = 'local' | 'remote';
export type SourceType = 'huggingface_hub' | 'custom';
export type GatedStatus = 'none' | 'auto' | 'manual' | 'unknown';
export type EvaluationStatus = 'unbenchmarked' | 'benchmarking' | 'benchmarked';

export interface ModelCapabilities {
  supports_tools: boolean;
  supports_vision: boolean;
  supports_streaming: boolean;
  supports_json_mode: boolean;
}

export interface ModelTemplate {
  id: string;
  display_name: string;
  description?: string;
  source_type: SourceType;
  provider_type: string;
  execution_mode: ExecutionMode;
  execution_location: ExecutionLocation;
  provider_model_id: string;
  huggingface_repo_id?: string;
  base_url?: string;
  license: string;
  gated_status: GatedStatus;
  capabilities: ModelCapabilities;
  context_window: number;
  quantization?: string;
  input_price_per_million: number;
  output_price_per_million: number;
  pricing_source: string;
  default_pool_hint?: string;
}

export type ConnectionTestStatus =
  | 'connected'
  | 'authentication_failed'
  | 'unreachable'
  | 'unsupported'
  | 'configuration_error'
  | 'inconclusive'
  | 'untested';

export interface WorkspaceModel {
  id: string;
  display_name: string;
  source_type: SourceType;
  provider_type: string;
  execution_mode: ExecutionMode;
  execution_location: ExecutionLocation;
  provider_model_id: string;
  huggingface_repo_id?: string;
  base_url?: string;
  license: string;
  gated_status: GatedStatus;
  capabilities: ModelCapabilities;
  context_window: number;
  quantization?: string;
  input_price_per_million: number;
  output_price_per_million: number;
  pricing_source: string;
  pricing_verified_at?: string;
  enabled: boolean;
  evaluation_status: EvaluationStatus;
  assigned_pool_ids: string[];
  connection_status?: ConnectionTestStatus;
  last_tested_at?: string;
  last_latency_ms?: number;
  last_diagnostic_message?: string;
  created_at: string;
  updated_at: string;
}

export interface ConnectionTestRequest {
  model_id?: string;
  provider_type: string;
  execution_mode: ExecutionMode;
  provider_model_id: string;
  huggingface_repo_id?: string;
  base_url?: string;
  transient_credential?: string;
  provider_selection?: string;
}

export interface ConnectionTestResult {
  status: ConnectionTestStatus;
  provider_type: string;
  sanitized_model_id: string;
  endpoint_reachable?: boolean;
  auth_status?: string;
  inference_verified: boolean;
  latency_ms?: number;
  tested_at: string;
  diagnostic_message: string;
  retryable: boolean;
  safe_details?: Record<string, any>;
}


export interface RoutingPool {
  id: string;
  name: string;
  description?: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface PoolMembership {
  id: string;
  pool_id: string;
  model_id: string;
  priority: number;
  is_fallback: boolean;
  created_at: string;
}

export interface HuggingFaceDiscoveredModel {
  repo_id: string;
  name: string;
  author?: string;
  likes: number;
  downloads: number;
  license: string;
  is_license_verified: boolean;
  gated_status: GatedStatus;
  is_chat_verified: boolean;
  is_inference_provider_available: boolean;
  context_window?: number;
  parameters_raw?: string;
  quantization?: string;
  tags: string[];
  model_card_url: string;
  supported_providers: string[];
  suggested_execution_mode: ExecutionMode;
  suggested_location: ExecutionLocation;
}

export interface HFSearchResponse {
  query: string;
  total_found: number;
  models: HuggingFaceDiscoveredModel[];
  cached: boolean;
  error?: string;
}

export interface UsageEvent {
  id: string;
  workspace_model_id: string;
  model_display_name_snapshot: string;
  routing_pool_id?: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  pricing_snapshot: {
    input_price_per_million: number;
    output_price_per_million: number;
    pricing_source: string;
  };
  estimated_cost_usd: number;
  latency_ms: number;
  time_to_first_token_ms?: number;
  success: boolean;
  error_message?: string;
  routed_by: string;
  timestamp: string;
}
