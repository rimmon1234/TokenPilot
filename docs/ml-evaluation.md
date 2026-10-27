# ML Evaluation & Router Training Methodology

TokenPilot uses supervised Machine Learning to dynamically route incoming requests to the lowest-cost model capable of answering with high fidelity.

---

## 1. The Intelligent Routing Problem

Given an incoming prompt $x$, a candidate pool of models $M = \{m_1, m_2, \dots, m_k\}$, and user constraints $C$ (max cost, allowed locations):

$$\text{Select } m^* \in M \quad \text{such that } \text{Cost}(m^*, x) \text{ is minimized subject to } \hat{Q}(m^*, x) \ge \tau$$

Where:
- $\hat{Q}(m, x) \in [0, 1]$ is the predicted quality or probability of a successful answer by model $m$.
- $\tau$ is the user's quality threshold (e.g. 0.85 for "Quality" or 0.50 for "Economy").

---

## 2. Feature Extraction Pipeline

1. **Syntactic & Heuristic Features**:
   - Estimated prompt token length.
   - Code token indicators (`def `, `class `, `import `, `{`, `}`, SQL keywords).
   - Reasoning complexity markers (`prove`, `calculate`, `step-by-step`, `explain why`).
   - Structural indicators (markdown tables, JSON schemas, bullet lists).
2. **Semantic Representation**:
   - Dense embeddings extracted via lightweight embedding models (`sentence-transformers/all-MiniLM-L6-v2`) or TF-IDF n-grams for ultra-low latency routing.

---

## 3. Classifier Candidates & Comparison

- **Baseline 1**: Rule-based heuristic router (token length + code presence).
- **Baseline 2**: `scikit-learn` Logistic Regression / Random Forest with calibrated probabilities.
- **Advanced Candidate**: `CatBoostClassifier` handling tabular features combined with dense embeddings.

### Metrics Evaluated:
- **Quality Preservation Ratio**: Percent of responses where the routed model met or exceeded benchmark reference quality.
- **Cost Reduction Factor**: Total token cost under routing vs. routing 100% of queries to top-tier frontier model.
- **Router Overhead Latency**: P50 and P99 latency of the ML router itself (target: $< 15\text{ms}$).

---

## 4. Benchmark Datasets & Reproducibility (Milestone M4)

Milestone M4 introduces reproducible evaluation harnesses and standardized benchmark datasets:
- **M4.1 — Benchmark Dataset Registry & Import Pipeline** (Implemented):
  - Pre-registered benchmark templates:
    - **GSM8K** (`openai/gsm8k`): 8.5K grade-school math word problems; evaluated via exact numeric answer extraction (`extract_gsm8k_final_answer`).
    - **HumanEval** (`openai/openai_humaneval`): 164 Python programming challenges; evaluated via functional unit tests (untrusted code execution deferred to isolated sandboxes in M4.2).
  - Provenance & Licenses: MIT license verified via Hugging Face Hub metadata; pinned commit SHAs recorded.
  - Split Discipline & Roles:
    - `held_out_test`: Upstream test sets (HumanEval test, GSM8K test) reserved strictly for evaluation; never contaminated into training sets.
    - `dev_train` / `validation`: Derived exclusively from upstream train splits.
  - Deterministic Sampling: Configurable subset limits (e.g. 5, 10, 25, 50, 100) sampled with fixed random seed (default `42`) to produce identical prompt sets across evaluation runs.
  - Local Storage: Manifests (`.manifest.json`) and canonical records (`.jsonl`) stored locally under `data/datasets/` outside Git tracking.
- **M4.2.1 — Multi-Model Benchmark Execution Engine** (Implemented):
  - In-process execution runner reusing existing gateway provider adapters without HTTP loopback.
  - Multi-model evaluation across canonical imported GSM8K records with deterministic subsets.
  - Transient credentials policy (zero secrets serialized to disk or exposed in API logs).
  - Telemetry capture: TTFT, total latency, input/output tokens, finish reason, and pricing snapshot cost accounting.
  - State machine lifecycle (`pending`, `running`, `completed`, `completed_with_errors`, `failed`, `cancelled`).
  - Strict untrusted code execution guard rejecting HumanEval until sandboxed runtimes are available in M4.3+.
  - Benchmark Lab execution modal, active progress bar polling, and canonical results viewer.
- **M4.2.2 — GSM8K Evaluation & Scoring** (Implemented):
  - In-process deterministic scoring of saved GSM8K completions without additional LLM API calls or LLM judges.
  - Multi-priority deterministic answer extraction hierarchy:
    1. Canonical delimiter `#### <number>` (with multi-match conflict detection).
    2. LaTeX notation `\boxed{<number>}` (with multi-match conflict detection).
    3. Explicit natural language answer phrases (e.g. `(final|correct)?\s*answer\s*(is|:)\s*<number>`, `result/total/value/sum/weight is <number>`).
    4. Discourse-introduced answer statements (e.g. `Therefore / So, the answer is <number>`).
    5. Natural-language concluding sentences in terminal lines:
       - Modal/recommendation verbs with indirect objects (e.g. `So, Julie should read 42 pages tomorrow`, `Wendi needs to give her chickens 20 cups`).
       - Time taken (e.g. `Therefore, it takes Carla 120 minutes`).
       - Quantity/topic nouns with linking verbs (e.g. `The final weight is 16 pounds`, `The total cost is $64`).
       - Spending & cost verbs (e.g. `Albert spends $40 on food`).
       - Existentials (e.g. `In total, there were 121 people`).
       - Passive constructions (e.g. `So, 1080 beetles are eaten each day`).
       - Action verbs with discourse markers or ending adverbials (e.g. `Albert eats 48 slices of pizza that day`, `Bella bought 38 stamps in all`).
    6. Concluding equations (`= <number>` optionally followed by units).
    7. Standalone terminal line numbers.
  - Deterministic disambiguation & safety guarantees:
    - Intermediate calculation avoidance: intermediate equations within reasoning chains (e.g. `84 / 2 = 42 pages.`) do not override final conclusion sentences or trigger unanchored number extraction.
    - Multi-candidate conflict resolution: when multiple answer markers or conclusion candidates are found, their normalized decimal values are compared; if they disagree, the response is safely kept as `unparseable` (`unparseable_conflicting_answers`) rather than guessing.
    - Trailing modifiers protection: non-target quantities in trailing prepositional phrases (e.g. `in 3 days`, `for 20 guests`) are not extracted in place of the target quantity.
    - Truly truncated or ambiguous completions (e.g. cut off mid-sentence) remain `unparseable`.
  - Number normalization & exact comparison:
    - Strips markdown formatting (`**`, `__`), unicode minus (`−`), currency symbols (`$`, `€`, `£`, `¥`), and thousands commas (`1,000`).
    - Python `Decimal` quantization and comparison for exact mathematical equivalence (e.g. `12` == `12.0`).
  - Mutually exclusive evaluation outcomes:
    - `correct`: Parsed answer matches canonical ground truth (`score = 1.0`).
    - `incorrect`: Parsed answer does not match ground truth (`score = 0.0`).
    - `unparseable`: Successful generation, but no confident answer could be extracted (`score = 0.0`).
    - `failed`: Underlying inference failed, timed out, or was aborted (`score = None`).
    - `unevaluated`: Pre-scoring default state (`score = None`).
  - Standardized metric definitions:
    - **Scorable Accuracy**: $\text{correct} / (\text{correct} + \text{incorrect})$. Evaluates accuracy across parseable responses; returns `null` if denominator is 0.
    - **End-to-End Correct-Answer Rate**: $\text{correct} / \text{attempted\_questions}$. Penalizes generation failures and unparseable outputs; returns `null` if denominator is 0.
  - Atomic persistence: Writes to temporary files (`.jsonl.tmp`) and replaces via atomic file operations (`os.replace`) to prevent corruption during partial writes.
  - Telemetry preservation: Scoring never alters original latency, TTFT, token counts, or pricing snapshot cost calculations.
- **M4.2.3 — Model Comparison UI and Benchmark Reports** (Implemented):
  - **Controlled Intra-Run Comparison Baseline**:
    - Direct head-to-head comparisons are scientifically valid only when models are evaluated against the exact same dataset manifest, source split, resolved Git commit revision, test record IDs, sampling seed, and generation temperature.
    - Prevents misleading cross-ranking between runs with disparate prompt sets, sampling configurations, or versions.
  - **Model Comparison Matrix**:
    - Per-model attempted questions, successful generations, correct answers, incorrect answers, unparseable answers, and failed requests.
    - **Scorable Accuracy**: $\text{correct} / (\text{correct} + \text{incorrect})$. Reflects algorithmic reasoning capability on parseable responses.
    - **End-to-End Correct-Answer Rate**: $\text{correct} / \text{attempted\_questions}$. Reflects real-world operational reliability, penalizing API network errors and formatting drops.
    - **Mean and Median Latency**: Millisecond timing calculated via `statistics.median` with safe handling when observations are insufficient.
    - **Token Usage and Provenance**: Sum of prompt and completion tokens with provenance classification (`provider_reported`, `estimated`, `unavailable`) and missing-usage counters.
    - **Estimated Cost per Question and Total Cost**: Dollar billing per question and per run with unpriced request counts explicitly displayed.
    - **Distinct State Tracking**: Explicitly separates `0.0`, `unknown`, and `unavailable`. Missing costs are not converted into artificial zeroes, and failed requests are not converted into incorrect answers.
  - **Quality vs. Cost Trade-Off & Pareto Frontier**:
    - **Pareto Dominance**: A model $A$ strictly dominates model $B$ ($A \succ B$) if and only if:
      $$\text{Cost}(A) \le \text{Cost}(B) \quad \land \quad \text{Accuracy}(A) \ge \text{Accuracy}(B)$$
      with at least one strict inequality ($\text{Cost}(A) < \text{Cost}(B)$ or $\text{Accuracy}(A) > \text{Accuracy}(B)$).
    - **Pareto Efficiency**: A model is non-dominated (Pareto-efficient) if no other model in the measured set dominates it.
    - **Relativity**: Pareto efficiency is strictly relative to the measured candidate set and chosen metrics; it does not constitute a universal optimality claim.
    - **Local & Unpriced Models**: Local hardware execution (e.g. Ollama `llama3.2:3b`) does not incur per-token cloud billing. Rather than assigning an artificial $0.00 coordinate (which would falsely dominate commercial cloud models), TokenPilot isolates unpriced models onto a dedicated "Local Hardware & Unpriced Models" shelf.
    - **Single-Model Evaluation**: Runs with only 1 evaluated model display a dedicated notice explaining that Pareto dominance and head-to-head trade-off curves require at least 2 comparable models.
  - **Detailed Model-Result Inspector**:
    - Verbatim prompt viewer, model output completion, reference answer, extracted numerical answer, evaluation status, latency, TTFT, token counts, pricing basis, and sanitized error messages.
    - Multi-dimensional filtering by model and outcome (`All`, `Correct`, `Incorrect`, `Unparseable`, `Failed`).
    - Full-text search across prompts, model completions, model names, and numerical answers.
  - **Exportable Benchmark Reports**:
    - `GET /api/benchmarks/runs/{run_id}/export?format=json|csv`
    - **JSON Export**: Complete run metadata, configuration snapshots, per-model scoring summaries, latency percentiles, and individual evaluation records.
    - **CSV Export**: Clean RFC 4180 compliant CSV format with run metadata comments, Model Performance Summary table, and Detailed Evaluation Records table. Escapes quotes, commas, and line breaks safely.
    - **Secret Exclusion Guarantee**: Excludes API tokens, transient credentials, and workspace secrets. Missing values are represented as explicit `null` / `Unknown` states without synthetic inflation.
  - **Custom Benchmark Names, Renaming & Selector Labels**:
    - **Display Name (`display_name`)**: Optional user-defined human-readable label stored in `.run.json` (max 80 chars, whitespace trimmed, empty/whitespace-only strings rejected).
    - **Default Generation**: When omitted, auto-generates `<Short Dataset Alias> · <Timestamp>` (e.g. `GSM8K · Oct 26, 8:59 PM`).
    - **Rename API**: `PATCH /api/benchmarks/runs/{run_id}` updates only `display_name` without re-running models or altering result files.
    - **Selection Dropdowns**: Controls render concise `<Short Benchmark Name> · <Timestamp>` format, truncating long names with an ellipsis while keeping the timestamp fixed and visible. Options use the immutable `run_id` as their value and sort newest first.
    - **Legacy Compatibility**: Older run files without `display_name` seamlessly fallback to the concise dataset alias and timestamp without manual migration.

---

## 5. Model Source and Execution Metadata Disambiguation

TokenPilot strictly distinguishes between the origin of a model and the runtime executing it:

1. **Model Source (`model_source`)**: Where the weights or model card were discovered (e.g. `huggingface_hub`, `ollama_library`, `google_ai_studio`, `custom`).
2. **Source Repository ID (`source_repo_id`)**: Upstream repository identifier (e.g. `Qwen/Qwen2.5-Coder-7B-Instruct`).
3. **Execution Provider (`execution_provider`)**: Service actively running inference (e.g. `ollama`, `vllm`, `huggingface_inference_providers`, `openai`, `gemini`).
4. **Execution Mode (`execution_mode`)**: Gateway adapter type (`local_openai_compatible`, `huggingface_inference_providers`, etc.).
5. **Execution Location (`execution_location`)**: Boundary locality (`local` or `remote`).
6. **Runtime Model ID (`provider_model_id`)**: Specific identifier passed to the runtime engine (e.g. `qwen2.5-coder:7b`).

**Concrete Example (Qwen 2.5 Coder 7B)**:
- **Display Name**: Qwen 2.5 Coder 7B Instruct
- **Model Source**: Hugging Face Hub (`huggingface_hub`)
- **Source Repo ID**: `Qwen/Qwen2.5-Coder-7B-Instruct`
- **Execution Provider**: Ollama (`ollama`)
- **Execution Location**: Local (`local`)
- **Runtime Model ID**: `qwen2.5-coder:7b`

Execution metadata is resolved from the effective configuration snapshot captured at benchmark execution time, not guessed from the display name.

---

## 6. Truthful Local-Model Cost Accounting & Pareto Integrity

A local model executed via Ollama has no per-token cloud inference invoice. However, this does **not** mean total inference cost is zero.

### Cost Model Dimensions

TokenPilot separates three distinct cost dimensions:

1. **Provider API Cost (`provider_api_cost_usd`)**:
   - Billable API invoice charge from the provider.
   - For local Ollama inference, this is a **known $0.00**.
   - For remote providers, calculated as:
     $$\text{API Cost} = \frac{\text{Prompt Tokens} \times \text{Input Price}}{1{,}000{,}000} + \frac{\text{Completion Tokens} \times \text{Output Price}}{1{,}000{,}000}$$
2. **Local Compute Cost (`local_compute_cost_usd`)**:
   - Estimated hardware and electricity cost.
   - Configurable in Model Studio via:
     - `local_compute_cost_per_second` (USD per second of inference latency)
     - Or `local_compute_price_per_million` (amortized USD per 1M total tokens)
   - If unconfigured, this remains **strictly unknown (`null`)**. TokenPilot never invents electricity or hardware depreciation figures.
3. **Estimated Total Inference Cost (`total_cost_usd`)**:
   - For local models: $\text{Provider API Cost} + \text{Local Compute Cost}$ **only when compute cost is known**. If local compute is unconfigured, total cost remains **strictly null**.
   - For remote models: Equals the Provider API Cost.
   - **Crucial Rule**: Unknown costs are never coerced to $0.00.

### Pareto Frontier Handling

- **Exclusion of Unpriced Models**: Models with unknown total cost are excluded from participating in the priced Pareto frontier (`is_pareto_efficient = None`).
- **Unpriced Tier Shelf**: Unpriced local models are displayed in a dedicated, clearly labeled "Unpriced Tier" shelf above the comparison chart, allowing quality and latency evaluation without granting an artificial, unearned advantage on the cost frontier.
- **Priced Models Only**: The Pareto frontier connects only models with known, valid total cost measurements and comparable accuracy metrics.

---

## 7. M5 Supervised ML Router Training-Data Preparation

Milestone M5 will train a supervised machine learning quality predictor $\hat{Q}(m, x)$ that estimates whether candidate model $m$ will produce a correct answer for incoming prompt $x$.

### Target Candidate Models

The development pilot dataset is designed for:
1. `llama3.2:3b` through local Ollama (`local`, `ollama`).
2. `qwen2.5-coder:7b` through local Ollama (`local`, `ollama`).
3. Google Gemini through the user's free-tier API key (only when explicitly selected; zero paid API calls permitted).

### Split Discipline & Anti-Contamination Rules

1. **Strict Upstream Split Isolation**:
   - The M5 development pilot **must strictly use the GSM8K upstream `train` split**.
   - The GSM8K upstream `test` split is permanently reserved as a held-out test evaluation benchmark and must **never** be used for training or fine-tuning the router.
2. **Evaluation Role**:
   - When importing the training subset, assign `evaluation_role = "dev_train"`.
3. **Group-K Prompt Partitioning**:
   - Partitioning into train and validation sets is strictly grouped by `prompt_id` (`record_id`).
   - All candidate model evaluation outputs for a given prompt reside in the **same partition**.
   - Zero prompt leakage: no question appearing in the training fold may ever appear in the held-out validation fold.

### Manual Data Collection Procedure (Step-by-Step Runbook)

To collect the M5 development pilot dataset without automated mass execution:

#### Step 1: Import the GSM8K Training Subset
1. Open TokenPilot UI and navigate to the **Dataset Lab** (`/datasets`).
2. Click **Import Benchmark Dataset**.
3. Select **GSM8K (Grade School Math 8K)**.
4. Set **Source Split** to `train` (do **not** select `test`).
5. Set **Evaluation Role** to `dev_train`.
6. Set **Subset Size** to `25` (or `50` for extended pilot).
7. Keep default **Sampling Seed** `42`.
8. Click **Import & Verify**.
9. Confirm that the manifest is created with `validation_status = "verified"` and role `dev_train`.

*Alternative via Backend API / curl*:
```bash
curl -X POST http://localhost:8000/api/datasets/import \
  -H "Content-Type: application/json" \
  -d '{
    "dataset_id": "gsm8k",
    "split": "train",
    "subset_size": 25,
    "seed": 42,
    "evaluation_role": "dev_train"
  }'
```

#### Step 2: Verify Local Runtime Availability
1. Ensure Ollama is active on `http://localhost:11434`.
2. Verify both candidate models are loaded in Ollama:
   ```bash
   ollama list
   ```
   Confirm `llama3.2:3b` and `qwen2.5-coder:7b` are present.
3. In TokenPilot **Model Studio**, verify both models are enabled and report `Connected`.

#### Step 3: Run Sequential Benchmark Evaluation
1. Navigate to **Benchmark Lab** (`/benchmarks`).
2. Click **New Benchmark Run**.
3. Select the imported `GSM8K (train)` dataset manifest (verify role: `dev_train`).
4. Select the two candidate local models:
   - `Llama 3.2 3B`
   - `Qwen 2.5 Coder 7B Instruct`
5. Set **Concurrency** to `1` (sequential execution ensures fair latency telemetry without GPU contention).
6. Set **Temperature** to `0.0` (deterministic evaluation).
7. Click **Launch Benchmark Run**.
8. Monitor progress in the execution modal until 100% completed.

#### Step 4: Evaluate and Score Run
1. Click **Evaluate & Score** in the Benchmark Lab.
2. The deterministic GSM8K evaluator parses model answers, extracts numbers, and verifies exact match against the canonical reference.
3. Export the scored results:
   ```bash
   curl http://localhost:8000/api/benchmarks/runs/{run_id}/export?format=json -o m5_pilot_run.json
   ```

#### Step 5: Convert and Partition for M5 Router Training
Use the `app.services.benchmark.m5_collector` pipeline:
```python
from app.services.benchmark.m5_collector import prepare_m5_pilot_dataset

# End-to-end extraction, Group-K 80/20 partitioning, and file export
manifest, train_records, val_records = prepare_m5_pilot_dataset(
    run_id=run_id,
    train_ratio=0.8,
    seed=42,
)
```

Alternatively, invoke via API:
```bash
curl -X POST "http://localhost:8000/api/benchmarks/runs/{run_id}/prepare-m5-pilot?train_ratio=0.8&seed=42"
```

The resulting artifacts are saved under `data/m5_pilot/`:
- `train.jsonl` (40 records for 25-prompt pilot)
- `val.jsonl` (10 records for 25-prompt pilot)
- `m5_pilot_all.jsonl` (50 canonical records)
- `m5_pilot_manifest.json` (metadata manifest with SHA256 hashes and data-quality metrics)

### Collection Record Integrity Requirements

Every collected record stored for M5 model training strictly enforces:
- `prompt_id`: Cluster key for Group-K validation.
- `model_source` & `execution_provider`: Snapshots of origin and runtime.
- `runtime_model_id` & `execution_location`: Precise deployment target.
- `quality_score`: $1.0$ for `correct`, $0.0$ for `incorrect` or `unparseable`, `null` for `failed`.
- Unparseable answers are never scored as correct.
- Failed network requests are not treated as math reasoning failures.
- Zero secrets: API keys and transient tokens are strictly barred from prompt text and serialized records.
- Costs: Unpriced local compute is preserved as `null`, never coerced to zero.


