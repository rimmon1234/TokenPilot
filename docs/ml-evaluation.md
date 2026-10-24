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
- **M4.2.2 — GSM8K Evaluation & Scoring** (Upcoming):
  - Automated extraction of model numeric answers from GSM8K completions.
  - Exact match scoring against canonical reference answers.
  - Evaluation metric aggregation (accuracy, latency distributions, cost-per-correct-solution).
- **M4.2.3 — Benchmark Lab Results & Model Comparison UI** (Upcoming):
  - Model comparison matrix, quality vs. cost Pareto frontier curves, and exportable reports.

