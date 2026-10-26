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
  source_repo_id?: string;
  model_source?: string;
  execution_provider?: string;
  base_url?: string;
  license: string;
  gated_status: GatedStatus;
  capabilities: ModelCapabilities;
  context_window: number;
  quantization?: string;
  input_price_per_million: number;
  output_price_per_million: number;
  local_compute_price_per_million?: number;
  local_compute_cost_per_second?: number;
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
  source_repo_id?: string;
  model_source?: string;
  execution_provider?: string;
  base_url?: string;
  license: string;
  gated_status: GatedStatus;
  capabilities: ModelCapabilities;
  context_window: number;
  quantization?: string;
  input_price_per_million: number;
  output_price_per_million: number;
  local_compute_cost_per_second?: number;
  local_compute_price_per_million?: number;
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

export type RequestStatus = 'success' | 'failed' | 'cancelled';
export type CostStatus = 'known' | 'unknown';
export type PricingProvenance = 'configured' | 'verified' | 'unknown';

export interface PricingSnapshot {
  input_price_per_million: number | null;
  output_price_per_million: number | null;
  pricing_source: string;
  is_free_tier?: boolean;
  local_compute_cost_per_second?: number | null;
  local_compute_price_per_million?: number | null;
}

export type TokenProvenance = 'provider_reported' | 'estimated' | 'unavailable';

export interface UsageEvent {
  id: string;
  request_id: string;
  conversation_id?: string;
  workspace_model_id: string;
  model_display_name_snapshot: string;
  provider_type: string;
  provider_model_id: string;
  execution_location: ExecutionLocation;
  execution_mode: ExecutionMode;
  routing_pool_id?: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  token_provenance: TokenProvenance;
  pricing_snapshot: PricingSnapshot;
  pricing_provenance: PricingProvenance;
  cost_status: CostStatus;
  estimated_cost_usd: number | null;
  latency_ms: number;
  time_to_first_token_ms?: number | null;
  finish_reason?: string | null;
  success: boolean;
  status: RequestStatus;
  error_message?: string | null;
  error_category?: string | null;
  routed_by: string;
  timestamp: string;
}

// Gateway Chat & Streaming Types
export type MessageRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  id?: string;
  role: MessageRole;
  content: string;
  timestamp?: string;
  model_display_name?: string;
  usage_event_id?: string;
  status?: 'success' | 'failed' | 'cancelled';
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  model_id?: string;
  model_display_name_snapshot?: string;
  messages: ChatMessage[];
  last_status?: 'completed' | 'failed' | 'cancelled' | 'in_progress';
  usage_event_ids?: string[];
}

export interface WorkspaceSettings {
  retain_prompts: boolean;
}

export interface GatewayChatRequest {
  model_id?: string;
  model_display_name?: string;
  provider_type: string;
  execution_mode: ExecutionMode;
  execution_location?: ExecutionLocation;
  provider_model_id: string;
  base_url?: string;
  huggingface_repo_id?: string;
  provider_selection?: string;
  messages: { role: MessageRole; content: string }[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  transient_credential?: string;
  input_price_per_million?: number;
  output_price_per_million?: number;
  pricing_source?: string;
  request_id?: string;
}

export interface StreamMetaEvent {
  type: 'meta';
  request_id: string;
  model_id?: string;
  provider_model_id: string;
  provider_type: string;
  execution_mode: string;
}

export interface StreamTokenEvent {
  type: 'token';
  text: string;
}

export interface StreamUsageEvent {
  type: 'usage';
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  provenance: TokenProvenance;
  estimated_cost_usd?: number | null;
}

export interface StreamDoneEvent {
  type: 'done';
  finish_reason?: string;
  latency_ms: number;
  ttft_ms?: number | null;
}

export interface StreamErrorEvent {
  type: 'error';
  error: string;
  code?: string;
}

export type StreamEvent =
  | StreamMetaEvent
  | StreamTokenEvent
  | StreamUsageEvent
  | StreamDoneEvent
  | StreamErrorEvent;

export interface StreamCallbacks {
  onMeta?: (meta: StreamMetaEvent) => void;
  onToken?: (token: string) => void;
  onUsage?: (usage: StreamUsageEvent) => void;
  onDone?: (done: StreamDoneEvent) => void;
  onError?: (error: string, code?: string) => void;
}

// Benchmark Dataset Registry & Import Types (M4.1)
export type DatasetTaskType = 'math_reasoning' | 'code_generation';
export type DatasetEvaluationRole = 'dev_train' | 'validation' | 'held_out_test';
export type DatasetValidationStatus = 'verified' | 'unverified' | 'failed';

export interface DatasetRecord {
  record_id: string;
  dataset_id: string;
  dataset_revision: string;
  source_split: string;
  evaluation_role: DatasetEvaluationRole;
  task_type: DatasetTaskType;
  input_messages: { role: string; content: string }[];
  reference_answer: string;
  reference_metadata: Record<string, any>;
  license: string;
  source_url: string;
  content_hash: string;
}

export interface DatasetTemplate {
  id: string;
  name: string;
  description: string;
  task_type: DatasetTaskType;
  hf_repo_id: string;
  default_config?: string;
  available_splits: string[];
  allowed_roles_per_split: Record<string, DatasetEvaluationRole[]>;
  license: string;
  license_verified: boolean;
  pinned_revision: string;
  recommended_subsets: number[];
  sample_records: Record<string, any>[];
}

export interface DatasetImportRequest {
  dataset_id: string;
  split: string;
  revision?: string;
  subset_size?: number | null;
  seed?: number;
  evaluation_role: DatasetEvaluationRole;
}

export interface DatasetManifest {
  manifest_id: string;
  dataset_id: string;
  dataset_name: string;
  task_type: DatasetTaskType;
  hf_repo_id: string;
  source_url: string;
  source_revision: string;
  license: string;
  license_verified: boolean;
  source_split: string;
  evaluation_role: DatasetEvaluationRole;
  total_upstream_records?: number | null;
  imported_record_count: number;
  subset_size?: number | null;
  sampling_seed?: number | null;
  content_fingerprint: string;
  imported_at: string;
  validation_status: DatasetValidationStatus;
  storage_path: string;
  status_detail?: string | null;
  is_benchmarked: boolean;
}

// Benchmark Execution & Evaluation Types (M4.2.1)
export type BenchmarkRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled';

export interface BenchmarkModelConfig {
  model_id: string;
  display_name: string;
  provider_type: string;
  execution_mode: ExecutionMode;
  provider_model_id: string;
  model_source?: string;
  source_repo_id?: string;
  execution_provider?: string;
  execution_location?: ExecutionLocation;
  base_url?: string;
  huggingface_repo_id?: string;
  input_price_per_million?: number;
  output_price_per_million?: number;
  local_compute_cost_per_second?: number;
  local_compute_price_per_million?: number;
  pricing_source?: string;
  pricing_snapshot?: PricingSnapshot;
  transient_credential?: string;
}

export interface BenchmarkGenerationSettings {
  temperature: number;
  max_tokens?: number;
  top_p?: number;
}

export interface BenchmarkRunProgress {
  total_items: number;
  completed_items: number;
  failed_items: number;
  current_model_id?: string;
  current_record_id?: string;
}

export interface BenchmarkRunCreate {
  dataset_manifest_id: string;
  models: BenchmarkModelConfig[];
  subset_size?: number | null;
  seed?: number;
  generation_settings?: BenchmarkGenerationSettings;
  concurrency?: number;
}

export type EvaluationOutcome =
  | 'correct'
  | 'incorrect'
  | 'unparseable'
  | 'failed'
  | 'unevaluated';

export interface ModelScoringSummary {
  model_id: string;
  display_name: string;
  provider_type?: string | null;
  provider_model_id?: string | null;
  model_source?: string | null;
  source_repo_id?: string | null;
  execution_provider?: string | null;
  execution_location?: string | null;
  attempted_questions: number;
  successful_generations: number;
  correct_answers: number;
  incorrect_answers: number;
  unparseable_answers: number;
  failed_requests: number;
  unevaluated_results: number;
  scorable_accuracy?: number | null;
  end_to_end_accuracy?: number | null;
  avg_latency_ms?: number | null;
  median_latency_ms?: number | null;
  avg_ttft_ms?: number | null;
  total_prompt_tokens?: number | null;
  total_completion_tokens?: number | null;
  total_tokens?: number | null;
  token_provenance?: string;
  missing_usage_count?: number;
  provider_api_cost_usd?: number | null;
  local_compute_cost_usd?: number | null;
  total_cost_usd?: number | null;
  cost_per_question_usd?: number | null;
  unknown_cost_count?: number;
  pricing_source?: string | null;
  is_pareto_efficient?: boolean | null;
}

export interface BenchmarkRunScoringSummary {
  evaluation_metric: string;
  evaluated_at: string;
  total_attempted: number;
  total_successful: number;
  total_correct: number;
  total_incorrect: number;
  total_unparseable: number;
  total_failed: number;
  total_unevaluated: number;
  scorable_accuracy?: number | null;
  end_to_end_accuracy?: number | null;
  model_metrics: Record<string, ModelScoringSummary>;
}

export interface BenchmarkRun {
  id: string;
  dataset_manifest_id: string;
  dataset_name: string;
  dataset_id: string;
  dataset_revision: string;
  source_split: string;
  task_type: DatasetTaskType;
  model_ids: string[];
  model_configs: BenchmarkModelConfig[];
  status: BenchmarkRunStatus;
  progress: BenchmarkRunProgress;
  generation_settings: BenchmarkGenerationSettings;
  subset_size?: number | null;
  seed: number;
  started_at: string;
  completed_at?: string | null;
  error_message?: string | null;
  results_summary: Record<string, any>;
}

export interface BenchmarkResult {
  id: string;
  run_id: string;
  dataset_manifest_id: string;
  dataset_id: string;
  dataset_revision: string;
  source_split: string;
  record_id: string;
  content_hash: string;
  model_id: string;
  provider_model_id: string;
  model_display_name: string;
  model_source?: string | null;
  source_repo_id?: string | null;
  execution_provider?: string | null;
  execution_location?: string | null;
  status: 'success' | 'failed' | 'cancelled';
  prompt_text: string;
  reference_answer: string;
  reference_metadata: Record<string, any>;
  output_text?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  token_provenance: string;
  latency_ms: number;
  ttft_ms?: number | null;
  finish_reason?: string | null;
  pricing_snapshot?: PricingSnapshot | null;
  provider_api_cost_usd?: number | null;
  local_compute_cost_usd?: number | null;
  cost_usd?: number | null;
  error_message?: string | null;
  error_category?: string | null;
  evaluation_status?: EvaluationOutcome;
  extracted_answer?: string | null;
  evaluation_details?: Record<string, any>;
  score?: number | null;
  metric_name?: string | null;
  created_at: string;
}



