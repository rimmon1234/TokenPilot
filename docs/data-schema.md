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

### F. UsageEvent
Request auditing, cost accounting, and latency telemetry.
- `id`: string (UUID v4)
- `workspace_model_id`: string
- `model_display_name_snapshot`: string
- `routing_pool_id`: optional string
- `prompt_tokens`: integer
- `completion_tokens`: integer
- `total_tokens`: integer
- `pricing_snapshot`: object (`{ input_price_per_million: number, output_price_per_million: number }`)
- `estimated_cost_usd`: number
- `latency_ms`: number
- `time_to_first_token_ms`: optional number
- `success`: boolean
- `error_message`: optional string
- `routed_by`: string (`'direct' | 'ml_router' | 'fallback' | 'cost_rule'`)
- `timestamp`: string (ISO 8601)

### G. Conversation and Message
Conversation structures for interactive chat.
- `Conversation`: `id`, `title`, `workspace_id`, `created_at`, `updated_at`
- `Message`: `id`, `conversation_id`, `role` (`'system' | 'user' | 'assistant'`), `content`, `usage_event_id`, `timestamp`

### H. BenchmarkRun & BenchmarkResult
Reproducible evaluation of models and routing policies.
- `BenchmarkRun`: `id`, `dataset_name`, `dataset_version`, `model_ids` (array), `status`, `started_at`, `completed_at`
- `BenchmarkResult`: `id`, `run_id`, `model_id`, `prompt_id`, `score`, `metric_name`, `latency_ms`, `cost_usd`, `output_text`

---

## 2. Multi-Tenant Future Proofing

All entity definitions include an optional `workspace_id` and `user_id` in their database mapping layer. In Milestone M7 (Authentication & Cloud Sync), row-level tenancy will be enforced via JWT session claims without breaking frontend contracts.
