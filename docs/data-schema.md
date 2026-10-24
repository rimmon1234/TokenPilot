# Data Schemas & Entities

This document defines the schema contracts for TokenPilot, unified across the Python backend (Pydantic / SQLAlchemy) and TypeScript frontend.

---

## 1. Domain Entities

### A. ModelTemplate
Suggested configurations maintained by the application or verified catalog.
- `id`: string (slug e.g., `hf-qwen-2.5-coder-7b`)
- `display_name`: string
- `source_type`: `'huggingface_hub' | 'custom'`
- `provider_type`: string
- `execution_mode`: `'huggingface_inference_providers' | 'huggingface_inference_endpoint' | 'huggingface_local_transformers' | 'local_openai_compatible' | 'remote_openai_compatible'`
- `execution_location`: `'local' | 'remote'`
- `provider_model_id`: string
- `huggingface_repo_id`: optional string
- `base_url`: optional string
- `license`: string (e.g. `apache-2.0`, `mit`, `unknown`)
- `gated_status`: `'none' | 'auto' | 'manual' | 'unknown'`
- `capabilities`: object (`{ supports_tools: bool, supports_vision: bool, supports_streaming: bool, supports_json_mode: bool }`)
- `context_window`: integer (default e.g. 8192)
- `quantization`: optional string (e.g. `4bit`, `8bit`, `none`)
- `input_price_per_million`: number (USD)
- `output_price_per_million`: number (USD)
- `pricing_source`: string (`official_docs`, `estimated`, `unknown`)
- `default_pool_hint`: optional string (`Economy`, `Quality`)

### B. WorkspaceModel
The active, user-configurable model instance inside a user's workspace.
- `id`: string (UUID v4)
- `display_name`: string
- `source_type`: `'huggingface_hub' | 'custom'`
- `provider_type`: string
- `execution_mode`: ExecutionMode enum
- `execution_location`: `'local' | 'remote'`
- `provider_model_id`: string
- `huggingface_repo_id`: optional string
- `base_url`: optional string
- `credential_reference_id`: optional string (opaque reference, NEVER secret text)
- `license`: string
- `gated_status`: `'none' | 'auto' | 'manual' | 'unknown'`
- `capabilities`: object
- `context_window`: integer
- `quantization`: optional string
- `input_price_per_million`: number
- `output_price_per_million`: number
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

---

## 2. Multi-Tenant Future Proofing

All entity definitions include an optional `workspace_id` and `user_id` in their database mapping layer. In Milestone M7 (Authentication & Cloud Sync), row-level tenancy will be enforced via JWT session claims without breaking frontend contracts.

