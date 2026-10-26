# Issue: Benchmark Metadata Disambiguation, Cost Integrity & Pareto Frontier Rectification

## Description
In recent two-model benchmark evaluations (comparing `llama3.2:3b` and `qwen2.5-coder:7b` on 10 GSM8K questions), two core integrity issues were identified:
1. **Model Origin vs Execution Runtime Conflation**: The UI mislabeled Qwen as `huggingface • qwen2.5-coder:7b` when its actual execution runtime was local Ollama (`http://localhost:11434/v1`).
2. **Artificial Local Model Dominance**: Llama appeared as a priced model with `$0.0000` cost on the Pareto frontier even though local hardware depreciation and electricity costs were unconfigured. A local model incurs no per-token cloud inference invoice, but this does not imply its total inference cost is zero. Coercing unknown hardware cost to $0.00 gave it an artificial, unearned advantage on the Pareto frontier.

## Implemented Solutions

### 1. Decoupled Metadata Dimensions
Separated model identity into distinct orthogonal concepts across backend schemas, evaluation engines, storage, frontend studio, comparison matrix, and exports:
- **Model Source (`model_source`)**: Where the weights or model card were discovered (`huggingface_hub`, `ollama_library`, `custom`, `google_ai_studio`).
- **Source Repository ID (`source_repo_id`)**: The original upstream repository identifier (e.g. `Qwen/Qwen2.5-Coder-7B-Instruct`).
- **Execution Provider (`execution_provider`)**: The engine running inference (`ollama`, `vllm`, `huggingface_inference_providers`, `openai`, `gemini`).
- **Execution Mode (`execution_mode`)**: Adapter interface type (`local_openai_compatible`, `huggingface_inference_providers`, etc.).
- **Execution Location (`execution_location`)**: Network locality (`local` machine or `remote` cloud).
- **Runtime Model ID (`provider_model_id`)**: The model tag expected by the provider (e.g. `qwen2.5-coder:7b`).

### 2. Truthful Multi-Dimensional Cost Accounting
Separated provider API charges from local hardware compute costs:
- **Provider API Cost (`provider_api_cost_usd`)**: Billable API invoice ($0.00 for local Ollama; token-based for remote APIs).
- **Local Compute Cost (`local_compute_cost_usd`)**: Configurable via `local_compute_cost_per_second` ($/s) or `local_compute_price_per_million` ($/1M tokens). When unconfigured, remains strictly `None` / `null`.
- **Estimated Total Cost (`total_cost_usd`)**: Sum of API and compute costs only when both are known. Strictly `None` / `null` when compute cost is unconfigured. Never coerced to zero.

### 3. Pareto Frontier Rectification
- Models with unknown total cost are excluded from participating in the priced Pareto frontier (`is_pareto_efficient = None`).
- Unpriced local models are displayed on a dedicated, clearly labeled "Unpriced Tier" shelf, preserving quality and latency metrics without claiming cost dominance.
- Historical runs and scoring summaries remain completely preserved with backwards compatibility.

## Acceptance Criteria Verified
- [x] Qwen is accurately represented as `Hugging Face Hub • Ollama • qwen2.5-coder:7b (Local)` instead of mislabeled as hosted Hugging Face inference.
- [x] Model source, execution runtime, locality, and runtime model ID are independently represented.
- [x] Local provider API charges ($0.00) are separated from local compute costs.
- [x] Unpriced local models remain unpriced (`null`) and are excluded from the priced Pareto frontier.
- [x] Historical benchmark runs and scores remain intact and render with conservative backwards compatibility.
- [x] Comprehensive backend unit tests pass (12/12 in `test_benchmark_metadata_and_cost.py`, 131/131 full suite).
- [x] Frontend Vitest suite (64/64) and TypeScript production build pass.
