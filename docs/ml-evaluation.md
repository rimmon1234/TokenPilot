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

## 4. Benchmark Datasets & Reproducibility

Milestone M4 introduces reproducible evaluation harnesses:
- Standard task samples: Coding (HumanEval/MBPP subset), Reasoning (GSM8K subset), General Knowledge (MMLU subset).
- Standardized judge scoring (LLM-as-a-judge or exact match checks).
- Versioned benchmark runs stored in `BenchmarkRun` and `BenchmarkResult` entities.
