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
  - Multi-priority answer extraction hierarchy:
    1. Canonical delimiter `#### <number>`
    2. LaTeX notation `\boxed{<number>}`
    3. Explicit natural language phrases: `(The|the)?\s*(final\s+)?answer\s*(is|:)\s*<number>`
    4. Concluding sentences with target quantities (`Total cost is $64`, `makes $18 every day`)
    5. Concluding equations (`= <number>`)
    6. Standalone terminal line numbers
  - Intermediate number avoidance: reasoning chains containing intermediate calculations are not parsed by blindly picking the first or last number.
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

