# Issue: Milestone M5 — Training Data Preparation, Group-K Partitioning & Pilot Collection Protocol

## Description
Establish a rigorous, reproducible data-collection foundation for Milestone M5: training the supervised machine learning quality predictor $\hat{Q}(m, x)$ to route prompts to the lowest-cost capable model.

## Implementation Steps & Architecture

### 1. Split Discipline & Anti-Contamination Rules
- **Exclusive Upstream Split**: M5 development-data collection strictly targets the **GSM8K upstream `train` split**.
- **Permanent Held-Out Reserve**: The GSM8K upstream `test` split is permanently reserved for benchmark evaluation and must **never** be used for training or fine-tuning the router.
- **Evaluation Role**: Imported datasets for router training must carry `evaluation_role = "dev_train"`.

### 2. Group-K Prompt Partitioning (Zero Prompt Leakage)
- Evaluated prompt samples are clustered by `prompt_id` (`record_id`).
- All candidate model responses (`llama3.2:3b`, `qwen2.5-coder:7b`, `gemini`) for a specific question must reside in the **same partition**.
- Zero prompt leakage: No prompt appearing in the training fold may ever appear in the held-out validation fold.
- Implemented in `app.services.benchmark.m5_collector.partition_m5_records_by_prompt`.

### 3. Collection Record Schema (`M5PilotRecord`)
Every record captured for the ML pipeline strictly retains:
- **Dataset Provenance**: `dataset_id`, `dataset_revision`, `source_split`, `record_id`.
- **Model Provenance**: `model_source`, `source_repo_id`, `execution_provider`, `execution_location`, `runtime_model_id`.
- **Prompt Features**: Verbatim `prompt_text`, `prompt_char_length`, `prompt_word_count`.
- **Generation Parameters**: `temperature`, `max_tokens`.
- **Target Metrics**:
  - `quality_score`: 1.0 for `correct`, 0.0 for `incorrect` or `unparseable`, `None` for `failed`.
  - `is_correct`: True for `correct`, False for `incorrect` or `unparseable`, `None` for `failed`.
- **Cost & Telemetry**:
  - `latency_ms`, `ttft_ms`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `token_provenance`.
  - `provider_api_cost_usd`, `local_compute_cost_usd`, `total_cost_usd`, `cost_provenance`.
- **Zero Secrets Validation**: Pydantic regex validator rejecting API keys, bearer tokens, and credentials.
- **Integrity Invariants**:
  - Unparseable answers are never scored as correct.
  - Failed network/inference requests are not treated as math reasoning errors.
  - Unknown costs are never coerced to zero.

### 4. Manual Sequential Execution Protocol
Documented exact step-by-step CLI and UI procedure in [`docs/ml-evaluation.md`](file:///d:/Projects/token_pilot/docs/ml-evaluation.md):
1. Import 25–50 samples from GSM8K `train` split with role `dev_train` and seed `42`.
2. Verify local Ollama is running with `llama3.2:3b` and `qwen2.5-coder:7b`.
3. Launch sequential benchmark run with concurrency=1 and temperature=0.0.
4. Score run using deterministic GSM8K evaluator and export JSON report.
5. Partition records using `m5_collector.partition_m5_records_by_prompt(seed=42)`.

## Acceptance Criteria
- [x] Canonical `M5PilotRecord` schema implemented and validated against secret leakage.
- [x] Deterministic Group-K prompt partitioning implemented and tested with zero prompt leakage.
- [x] Rejection of null-as-zero and unparseable-as-correct verified in automated tests (`test_m5_data_preparation.py`).
- [x] Step-by-step manual execution protocol documented in `docs/ml-evaluation.md`.
- [x] No automated inference executed, no remote quota consumed, and no models trained during this preparatory phase.
