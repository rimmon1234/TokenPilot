# Data Schemas & Entities

This document defines the schema contracts for TokenPilot, unified across the Python backend (Pydantic / SQLAlchemy) and TypeScript frontend.

---

## 1. Domain Entities

### A. ModelTemplate
Suggested configurations maintained by the application or verified catalog.
- `id`: string (slug e.g., `hf-qwen-2.5-coder-7b`)
- `display_name`: string
- `source_type`: `'huggingface_hub' | 'custom'`
- `model_source`: optional string (`'huggingface_hub' | 'ollama_library' | 'custom' | 'google_ai_studio' | 'openai'`)
- `source_repo_id`: optional string (e.g. `Qwen/Qwen2.5-Coder-7B-Instruct`)
- `execution_provider`: optional string (`'ollama' | 'vllm' | 'huggingface_inference_providers' | 'openai' | 'gemini'`)
- `provider_type`: string
- `execution_mode`: `'huggingface_inference_providers' | 'huggingface_inference_endpoint' | 'huggingface_local_transformers' | 'local_openai_compatible' | 'remote_openai_compatible'`
- `execution_location`: `'local' | 'remote'`
- `provider_model_id`: string (runtime model tag sent to execution provider, e.g. `qwen2.5-coder:7b`)
- `huggingface_repo_id`: optional string
- `base_url`: optional string
- `license`: string (e.g. `apache-2.0`, `mit`, `unknown`)
- `gated_status`: `'none' | 'auto' | 'manual' | 'unknown'`
- `capabilities`: object (`{ supports_tools: bool, supports_vision: bool, supports_streaming: bool, supports_json_mode: bool }`)
- `context_window`: integer (default e.g. 8192)
- `quantization`: optional string (e.g. `4bit`, `8bit`, `none`)
- `input_price_per_million`: number (USD per 1M tokens)
- `output_price_per_million`: number (USD per 1M tokens)
- `local_compute_price_per_million`: optional number (configured amortized hardware compute cost per 1M tokens)
- `local_compute_cost_per_second`: optional number (configured hardware compute cost per second of inference)
- `pricing_source`: string (`official_docs`, `estimated`, `unknown`)
- `default_pool_hint`: optional string (`Economy`, `Quality`)

### B. WorkspaceModel
The active, user-configurable model instance inside a user's workspace.
- `id`: string (UUID v4)
- `display_name`: string
- `source_type`: `'huggingface_hub' | 'custom'`
- `model_source`: optional string (`'huggingface_hub' | 'ollama_library' | 'custom' | 'google_ai_studio' | 'openai'`)
- `source_repo_id`: optional string (e.g. `Qwen/Qwen2.5-Coder-7B-Instruct`)
- `execution_provider`: optional string (`'ollama' | 'vllm' | 'huggingface_inference_providers' | 'openai' | 'gemini'`)
- `provider_type`: string
- `execution_mode`: ExecutionMode enum
- `execution_location`: `'local' | 'remote'`
- `provider_model_id`: string (runtime model identifier)
- `huggingface_repo_id`: optional string
- `base_url`: optional string
- `credential_reference_id`: optional string (opaque reference, NEVER secret text)
- `license`: string
- `gated_status`: `'none' | 'auto' | 'manual' | 'unknown'`
- `capabilities`: object
- `context_window`: integer
- `quantization`: optional string
- `input_price_per_million`: number (provider API invoice price)
- `output_price_per_million`: number (provider API invoice price)
- `local_compute_price_per_million`: optional number (amortized hardware compute price)
- `local_compute_cost_per_second`: optional number (hardware compute rate per second)
- `pricing_source`: string
- `pricing_verified_at`: optional string (ISO 8601)
- `enabled`: boolean (default `true`)
- `evaluation_status`: `'unbenchmarked' | 'benchmarking' | 'benchmarked'`
- `created_at`: string (ISO 8601)
- `updated_at`: string (ISO 8601)

### C. RoutingPool
A named, user-defined grouping of models.
- `id`: string (UUID v4)
- `name`: string (e.g. `Economy`, `Quality`, `Local Only`)
- `description`: optional string
- `is_default`: boolean
- `created_at`: string (ISO 8601)
- `updated_at`: string (ISO 8601)

### D. PoolMembership
Many-to-many link between a model and a pool.
- `id`: string (UUID v4)
- `pool_id`: string (FK to `RoutingPool.id`)
- `model_id`: string (FK to `WorkspaceModel.id`)
- `priority`: integer (1-100)
- `is_fallback`: boolean
- `created_at`: string (ISO 8601)

### E. RoutingPolicy
Routing configuration rules per pool.
- `id`: string (UUID v4)
- `pool_id`: string (FK to `RoutingPool.id`)
- `name`: string
- `routing_strategy`: `'cost_optimized' | 'quality_optimized' | 'ml_predicted' | 'round_robin' | 'manual_priority'`
- `min_quality_threshold`: optional float
- `max_cost_per_million_input`: optional float
- `max_cost_per_million_output`: optional float
- `max_acceptable_latency_ms`: optional integer
- `allowed_locations`: array of `'local' | 'remote'`
- `fallback_model_id`: optional string
- `retry_on_failure`: boolean
- `max_retries`: integer

### F. UsageEvent (M3.3)
Request auditing, cost accounting, and latency telemetry. Each gateway interaction produces an immutable, idempotent usage event:
- `id`: string (UUID or matching `request_id`)
- `request_id`: string (unique client/server correlation ID)
- `conversation_id`: optional string (foreign key to `Conversation.id`)
- `workspace_model_id`: string (ID of selected model configuration)
- `model_display_name_snapshot`: string (immutable snapshot of model name)
- `provider_type`: string (`ollama`, `huggingface`, `openai`, `vllm`)
- `provider_model_id`: string (target upstream model identifier)
- `execution_location`: `'local' | 'remote'`
- `execution_mode`: ExecutionMode enum
- `routing_pool_id`: optional string
- `prompt_tokens`: integer or null
- `completion_tokens`: integer or null
- `total_tokens`: integer or null
- `token_provenance`: `'provider_reported' | 'estimated' | 'unavailable'`
- `pricing_snapshot`: object:
  - `input_price_per_million`: number or null
  - `output_price_per_million`: number or null
  - `pricing_source`: string (`official_docs`, `provider_averages`, `free_local`, `unknown`)
  - `is_free_tier`: optional boolean
- `pricing_provenance`: `'configured' | 'verified' | 'unknown'`
- `cost_status`: `'known' | 'unknown'`
- `estimated_cost_usd`: number or null
- `latency_ms`: number
- `time_to_first_token_ms`: optional number or null
- `finish_reason`: optional string (`stop`, `length`, `cancelled`, `error`)
- `success`: boolean
- `status`: `'success' | 'failed' | 'cancelled'`
- `error_message`: optional string
- `error_category`: optional string
- `routed_by`: string (`'direct' | 'ml_router' | 'fallback' | 'cost_rule'`)
- `timestamp`: string (ISO 8601)

#### Cost Accounting Formula
$$\text{estimated\_cost} = \frac{\text{prompt\_tokens} \times \text{input\_price\_per\_million} + \text{completion\_tokens} \times \text{output\_price\_per\_million}}{1,000,000}$$
- **Remote Models**: Calculated only when token counts and price card rates are non-negative numbers.
- **Local Models**: Marked as `cost_status: 'unknown'` and `estimated_cost_usd: null` by default, because local compute has real electricity/hardware costs and must not be falsely claimed as $0.00 free spend.
- **Promotional Free Tier**: Explicitly configured zero pricing is preserved as $0.00 with `cost_status: 'known'`, distinct from missing prices.

### G. Conversation and ChatMessage (M3.3)
Interactive conversation threads persisted locally in browser IndexedDB:
- **`Conversation`**:
  - `id`: string (UUID e.g. `conv-1730000000000`)
  - `title`: string (auto-derived from initial prompt or user-edited)
  - `created_at`: string (ISO 8601)
  - `updated_at`: string (ISO 8601)
  - `model_id`: optional string (reference to last active model)
  - `model_display_name_snapshot`: optional string (model name attribution snapshot)
  - `messages`: array of `ChatMessage`
  - `last_status`: optional `'completed' | 'failed' | 'cancelled' | 'in_progress'`
  - `usage_event_ids`: optional array of string IDs linking to associated `UsageEvent` records
- **`ChatMessage`**:
  - `id`: optional string
  - `role`: `'system' | 'user' | 'assistant'`
  - `content`: string (or masked if prompt retention is disabled)
  - `timestamp`: optional string
  - `model_display_name`: optional string (assistant model attribution)
  - `usage_event_id`: optional string
  - `status`: optional `'success' | 'failed' | 'cancelled'`
- **`WorkspaceSettings`**:
  - `retain_prompts`: boolean (default `true`). When toggled to `false`, raw prompts are excluded from persistence to protect sensitive queries.

### H. BenchmarkRun & BenchmarkResult
Reproducible evaluation of models and routing policies.
- `BenchmarkRun`: `id`, `dataset_name`, `dataset_version`, `model_ids` (array), `status`, `started_at`, `completed_at`
- `BenchmarkResult`: `id`, `run_id`, `model_id`, `prompt_id`, `score`, `metric_name`, `latency_ms`, `cost_usd`, `output_text`

### I. Gateway Chat & Streaming Events (M3.2)
Schemas governing `POST /api/gateway/chat/completions` and Server-Sent Events:
- **`GatewayChatRequest`**:
  - `model_id`: optional string (workspace reference)
  - `model_display_name`: optional string
  - `provider_type`: string (`ollama`, `vllm`, `huggingface`, `openai`)
  - `execution_mode`: ExecutionMode enum
  - `provider_model_id`: string (e.g. `llama3.2:3b`, `Qwen/Qwen2.5-Coder-7B-Instruct`)
  - `base_url`: optional string (validated against SSRF)
  - `messages`: array of `ChatMessage` (`role: 'system' | 'user' | 'assistant'`, `content: string`)
  - `temperature`: float (`0.0` - `2.0`)
  - `max_tokens`: optional integer (`1` - `128000`)
  - `top_p`: optional float (`0.0` - `1.0`)
  - `stream`: boolean (default `true`)
  - `transient_credential`: optional `SecretStr` (held in memory only; never persisted or logged)
  - `input_price_per_million`: optional float
  - `output_price_per_million`: optional float
  - `pricing_source`: optional string
  - `request_id`: optional string
- **Server-Sent Events (`text/event-stream`)**:
  - `meta`: `{"type": "meta", "request_id": string, "model_id": string, "provider_model_id": string, "provider_type": string, "execution_mode": string}`
  - `token`: `{"type": "token", "text": string}`
  - `usage`: `{"type": "usage", "prompt_tokens": int, "completion_tokens": int, "total_tokens": int, "provenance": "provider_reported" | "estimated" | "unavailable", "estimated_cost_usd": float}`
  - `done`: `{"type": "done", "finish_reason": string, "latency_ms": float, "ttft_ms": float}`
  - `error`: `{"type": "error", "error": string, "code": string}`

### J. Benchmark Dataset Registry & Canonical Records (M4.1)
Reproducible ground-truth dataset schemas for offline benchmarking and ML router training:
- **`DatasetRecord`**:
  - `record_id`: string (deterministic identifier, e.g. `rec-gsm8k-test-0-4a8b...`)
  - `dataset_id`: string (`gsm8k` | `humaneval`)
  - `dataset_revision`: string (resolved Hugging Face commit SHA)
  - `source_split`: string (`test` | `train`)
  - `evaluation_role`: `'dev_train' | 'validation' | 'held_out_test'` (enforces strict split discipline)
  - `task_type`: `'math_reasoning' | 'code_generation'`
  - `input_messages`: array of `{ role: string, content: string }`
  - `reference_answer`: string (unaltered upstream reference ground truth)
  - `reference_metadata`: object (e.g. `extracted_answer`, `entry_point`, `test`, `execution_policy`)
  - `license`: string (recorded from dataset card, e.g. `MIT`)
  - `source_url`: string (upstream Hugging Face repository URL)
  - `content_hash`: string (SHA-256 fingerprint of prompt + reference)
- **`DatasetTemplate`**:
  - `id`: string (`gsm8k`, `humaneval`)
  - `name`: string
  - `description`: string
  - `task_type`: TaskType
  - `hf_repo_id`: string
  - `available_splits`: array of strings
  - `allowed_roles_per_split`: map of split -> allowed roles (prevents leaking test records into training)
  - `license`: string
  - `license_verified`: boolean
  - `pinned_revision`: string (verified commit SHA fallback)
  - `recommended_subsets`: array of integers (e.g. `[5, 10, 25, 50, 100]`)
  - `sample_records`: array of sample preview records
- **`DatasetManifest`**:
  - `manifest_id`: string (unique import identifier, e.g. `ds-gsm8k-test-held_out_test-sub10-a1b2c3`)
  - `dataset_id`: string
  - `dataset_name`: string
  - `task_type`: TaskType
  - `hf_repo_id`: string
  - `source_url`: string
  - `source_revision`: string
  - `license`: string
  - `source_split`: string
  - `evaluation_role`: EvaluationRole
  - `total_upstream_records`: optional integer
  - `imported_record_count`: integer
  - `subset_size`: optional integer (null if full split imported)
  - `sampling_seed`: optional integer (pinned seed for reproducible sampling, e.g. `42`)
  - `content_fingerprint`: string (SHA-256 hash over sorted canonical record content hashes)
  - `imported_at`: datetime / ISO timestamp
  - `validation_status`: `'verified' | 'unverified' | 'failed'`
  - `storage_path`: string (local file path to `.jsonl` lines)
  - `is_benchmarked`: boolean (always `false` upon import; updated upon M4.2 evaluation)

### K. BenchmarkRun & BenchmarkResult (Evaluation Engine — M4.2.1 & M4.2.2)

#### `EvaluationOutcome` Enum
- `correct`: Parsed candidate answer exactly matches canonical ground truth (`score = 1.0`).
- `incorrect`: Parsed candidate answer differs from canonical ground truth (`score = 0.0`).
- `unparseable`: Generation succeeded, but no confident numeric answer could be extracted (`score = 0.0`).
- `failed`: Inference request timed out, threw an error, or was cancelled (`score = None`). Inference status is decoupled from math correctness.
- `unevaluated`: Pre-scoring default status (`score = None`).

#### `ModelScoringSummary` & `BenchmarkRunScoringSummary`
Persisted inside `BenchmarkRun.results_summary`:
- `evaluation_metric`: string (`'exact_match'`)
- `evaluated_at`: datetime (ISO 8601)
- `total_attempted`: integer (records × models)
- `total_successful`: integer (successful inference generations)
- `total_correct`: integer
- `total_incorrect`: integer
- `total_unparseable`: integer
- `total_failed`: integer (inference failures)
- `total_unevaluated`: integer
- `scorable_accuracy`: float or null (`correct / (correct + incorrect)`; null if denominator is 0)
- `end_to_end_accuracy`: float or null (`correct / attempted`; null if denominator is 0)
- `model_metrics`: map of `model_id` to `ModelScoringSummary`:
  - `model_id`: string
  - `display_name`: string
  - `model_source`: optional string (`'huggingface_hub' | 'ollama_library' | 'custom' | 'google_ai_studio' | 'openai'`)
  - `source_repo_id`: optional string (e.g. `Qwen/Qwen2.5-Coder-7B-Instruct`)
  - `execution_provider`: optional string (`'ollama' | 'vllm' | 'huggingface_inference_providers' | 'openai' | 'gemini'`)
  - `execution_location`: optional string (`'local' | 'remote'`)
  - `provider_type`: optional string (`ollama`, `hf_serverless`, `custom_openai`)
  - `provider_model_id`: optional string (actual provider model identifier used at execution)
  - `attempted_questions`: integer
  - `successful_generations`: integer
  - `correct_answers`: integer
  - `incorrect_answers`: integer
  - `unparseable_answers`: integer
  - `failed_requests`: integer
  - `unevaluated_results`: integer
  - `scorable_accuracy`: float or null
  - `end_to_end_accuracy`: float or null
  - `avg_latency_ms`: optional float (mean end-to-end latency in milliseconds)
  - `median_latency_ms`: optional float (median latency via `statistics.median`)
  - `avg_ttft_ms`: optional float (mean time to first token in milliseconds)
  - `total_prompt_tokens`: optional integer
  - `total_completion_tokens`: optional integer
  - `total_tokens`: optional integer
  - `token_provenance`: string (`provider_reported`, `estimated`, `unavailable`)
  - `missing_usage_count`: integer (records with missing or unavailable token usage)
  - `provider_api_cost_usd`: optional float (actual provider API charge; known $0.00 for local Ollama)
  - `local_compute_cost_usd`: optional float (estimated local compute hardware cost; null if unconfigured)
  - `total_cost_usd`: optional float (total estimated inference cost; strictly null if compute is unconfigured)
  - `cost_per_question_usd`: optional float (average cost per attempted question; null if unpriced)
  - `unknown_cost_count`: integer (records with unknown or unmetered pricing)
  - `pricing_source`: optional string
  - `is_pareto_efficient`: optional boolean (True if non-dominated in quality vs cost; False if dominated; None if unpriced)

#### `BenchmarkRunExportReport`
Structure returned by `GET /api/benchmarks/runs/{run_id}/export?format=json`:
- `report_type`: string (`tokenpilot_benchmark_report`)
- `exported_at`: datetime (ISO 8601)
- `run_id`: string
- `dataset`: object (`manifest_id`, `dataset_name`, `dataset_id`, `resolved_revision`, `source_split`, `tested_record_count`, `sampling_seed`)
- `generation_config`: object (`temperature`, `max_tokens`, `top_p`)
- `model_configurations`: list of `BenchmarkModelConfig` (secrets strictly excluded)
- `scoring_summary`: `BenchmarkRunScoringSummary` (with Pareto frontier and telemetry aggregates)
- `results`: list of `BenchmarkResult` (per-record prompt, output, ground truth, extracted answer, status, and telemetry)
Represents an empirical evaluation run against an imported dataset manifest across a set of workspace models.
- **Fields**:
  - `id`: string (e.g., `run-gsm8k-1741520000`)
  - `dataset_manifest_id`: string (references `DatasetManifest.manifest_id`)
  - `dataset_name`: string
  - `dataset_id`: string
  - `dataset_revision`: string (pinned upstream commit SHA)
  - `source_split`: string (`test`, `train`)
  - `task_type`: TaskType (`math_reasoning`, `code_generation`)
  - `model_ids`: list of string
  - `model_configs`: list of `BenchmarkModelConfig` (model snapshots with baseline pricing)
  - `status`: `BenchmarkRunStatus` (`pending`, `running`, `completed`, `completed_with_errors`, `failed`, `cancelled`)
  - `progress`: `BenchmarkRunProgress` (`total_items`, `completed_items`, `failed_items`, `current_model_id`, `current_record_id`)
  - `generation_settings`: `BenchmarkGenerationSettings` (`temperature`, `max_tokens`, `top_p`)
  - `subset_size`: optional integer
  - `seed`: integer (default `42`)
  - `started_at`: datetime
  - `completed_at`: optional datetime
  - `error_message`: optional string
  - `results_summary`: dict (populated with `BenchmarkRunScoringSummary` upon scoring)

#### `BenchmarkResult`
Canonical evaluation result record for an individual prompt executed against a specific model.
- **Fields**:
  - `id`: string (deterministic: `res-{run_id}-{record_id}-{model_id}`)
  - `run_id`: string
  - `dataset_manifest_id`: string
  - `dataset_id`: string
  - `dataset_revision`: string
  - `source_split`: string
  - `record_id`: string (references `DatasetRecord.record_id`)
  - `content_hash`: string
  - `model_id`: string
  - `provider_model_id`: string
  - `model_display_name`: string
  - `model_source`: optional string (`huggingface_hub`, `ollama_library`, `custom`)
  - `source_repo_id`: optional string (e.g. `Qwen/Qwen2.5-Coder-7B-Instruct`)
  - `execution_provider`: optional string (`ollama`, `vllm`, `huggingface_inference_providers`, `openai`)
  - `execution_location`: optional string (`local`, `remote`)
  - `status`: `'success' | 'failed' | 'cancelled'`
  - `prompt_text`: string (canonical formatted benchmark question)
  - `reference_answer`: string (ground truth answer)
  - `reference_metadata`: dict (extracted numeric answer for scoring)
  - `output_text`: optional string (raw assistant response)
  - `prompt_tokens`: optional integer
  - `completion_tokens`: optional integer
  - `total_tokens`: optional integer
  - `token_provenance`: `'provider_reported' | 'estimated' | 'unavailable'`
  - `latency_ms`: float (measured elapsed time)
  - `ttft_ms`: optional float (time to first SSE chunk)
  - `finish_reason`: optional string (`stop`, `length`, etc.)
  - `pricing_snapshot`: optional `PricingSnapshot`
  - `provider_api_cost_usd`: optional float (known API charge; $0.00 for local)
  - `local_compute_cost_usd`: optional float (hardware compute cost; null if unpriced)
  - `total_cost_usd`: optional float (total estimated inference cost; null if unpriced)
  - `cost_usd`: optional float (alias for total cost)
  - `error_message`: optional string
  - `error_category`: optional string (`timeout`, `rate_limit`, `auth_error`, `upstream_error`, `validation_error`)
  - `evaluation_status`: `EvaluationOutcome` (`'correct' | 'incorrect' | 'unparseable' | 'failed' | 'unevaluated'`)
  - `extracted_answer`: optional string (normalized candidate number extracted from output text)
  - `evaluation_details`: dict (evaluation metadata: matched pattern, clean candidate, clean target)
  - `score`: optional float (`1.0` if correct, `0.0` if incorrect or unparseable, `None` if failed or unevaluated)
  - `metric_name`: optional string (`'exact_match'`)
  - `created_at`: datetime

#### `M5PilotRecord` (Phase E / M5 Data Preparation)
Normalized training-data record for the upcoming M5 supervised ML quality router:
- `sample_id`: string (`m5-{dataset_id}-{record_id}-{model_id}`)
- `prompt_id`: string (cluster key for Group-K cross validation; guarantees zero prompt leakage)
- `record_id`: string
- `dataset_id`: string (`gsm8k`)
- `dataset_revision`: string
- `source_split`: string (`train`)
- `evaluation_role`: string (`dev_train`)
- `model_id`: string
- `model_source`: string
- `source_repo_id`: optional string
- `execution_provider`: string
- `execution_location`: string
- `runtime_model_id`: string
- `prompt_text`: string (sanitized, zero secrets)
- `prompt_char_length`: integer
- `prompt_word_count`: integer
- `temperature`: float
- `max_tokens`: optional integer
- `output_text`: optional string
- `extracted_answer`: optional string
- `reference_answer`: string
- `evaluation_status`: string (`correct`, `incorrect`, `unparseable`, `failed`)
- `quality_score`: optional float (`1.0` for correct, `0.0` for incorrect or unparseable, `None` for failed)
- `is_correct`: optional boolean (`True` for correct, `False` for incorrect or unparseable, `None` for failed)
- `latency_ms`: float
- `ttft_ms`: optional float
- `prompt_tokens`: optional integer
- `completion_tokens`: optional integer
- `total_tokens`: optional integer
- `token_provenance`: string
- `provider_api_cost_usd`: optional float
- `local_compute_cost_usd`: optional float
- `total_cost_usd`: optional float (strictly null if unpriced)
- `cost_provenance`: string
- `request_status`: string
- `error_category`: optional string
- `dataset_pilot_label`: string (`m5_supervised_pilot_v1`)

---


## 2. Multi-Tenant Future Proofing

All entity definitions include an optional `workspace_id` and `user_id` in their database mapping layer. In Milestone M7 (Authentication & Cloud Sync), row-level tenancy will be enforced via JWT session claims without breaking frontend contracts.

