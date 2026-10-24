# TokenPilot 🚀

> **Intelligent, customizable ML-powered LLM gateway that slashes inference costs while preserving high-tier response quality.**

---

## 🌟 What is TokenPilot?

TokenPilot solves a fundamental challenge for developers and AI teams: **frontier models are expensive and often unnecessary for simple queries, while smaller models can fail on complex reasoning.**

TokenPilot acts as an intelligent router and model manager. Instead of hardcoding model choices or routing blindly:
- It lets you discover, configure, and curate models across **Hugging Face Hub**, **local runtimes** (Ollama, vLLM, LM Studio), and **remote providers**.
- It organizes models into dynamic, user-defined **Routing Pools** (e.g., *Economy*, *Quality*, *Local Only*, *Code*).
- It provides a **Model Studio** to manage capabilities, verified licensing, and transparent token pricing.
- In later milestones, it uses a **supervised ML classifier** trained on benchmark datasets to automatically dispatch each prompt to the cheapest capable model.

---

## 🏛️ Core Architectural Principles

TokenPilot maintains strict decoupling across 7 distinct dimensions:
1. **Model Source**: Hugging Face Hub, local weights, or custom registry.
2. **Provider or Runtime**: Hugging Face Inference Providers, deployed endpoints, local OpenAI-compatible servers (Ollama, vLLM), or remote APIs.
3. **Execution Location**: Physical locality (`local` vs. `remote`) is independent of cost.
4. **Model Configuration**: Concrete instances with configured limits, pricing, and capabilities.
5. **Routing Pool**: User-defined dynamic groups with many-to-many model assignment.
6. **Routing Policy**: Hard constraints (budget, location, latency) and optimization targets.
7. **Model Evaluation Profile**: Empirical benchmark metrics, not fabricated claims.

---

## 💻 Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Lucide Icons, React Router v6, IndexedDB (`idb` storage abstraction).
- **Backend**: Python 3.10+, FastAPI, Pydantic v2, `huggingface_hub` / HTTP discovery proxy, pytest.
- **Future ML Engine (M4-M6)**: scikit-learn, sentence-transformers, CatBoost.

---

## 🚀 Quickstart Guide

### Prerequisites
- Node.js (v18+ recommended)
- Python 3.10+

### 1. Clone & Configure Environment
```bash
git clone https://github.com/rimmon1234/TokenPilot.git
cd TokenPilot
cp .env.example .env
```

### 2. Backend Setup
```bash
cd backend
python -m venv .venv

# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Backend will start at `http://localhost:8000`. API documentation is available at `http://localhost:8000/docs`.

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Frontend will be accessible at `http://localhost:5173`.

---

## 🧪 Testing

### Backend Tests
```bash
cd backend
.venv\Scripts\pytest -v
```

### Frontend Typecheck & Build
```bash
cd frontend
npm run build
```

---

## 🗺️ Milestone Roadmap

- [x] **M0 — Architecture, Documentation & Repo Setup**
- [x] **M1 — Frontend/Backend Skeleton & Core Contracts**
- [x] **M2 — Model Studio, Hugging Face Discovery & Dynamic Pools**
- [x] **M3 — Direct Gateway Execution, Credentials & Telemetry**
  - [x] **M3.1 — Model Connection Testing & Diagnostics**
  - [x] **M3.2 — Chat Completion Gateway & Stream Telemetry**
  - [x] **M3.3 — Usage Persistence, History & Cost Auditing**
- [ ] **M4 — Evaluation Harness & Benchmark Datasets**
  - [x] **M4.1 — Benchmark Dataset Registry & Import Pipeline** (Current)
  - [ ] **M4.2 — Multi-Model Benchmark Execution Engine & Quality Scoring**
- [ ] **M5 — Supervised ML Router Training**
- [ ] **M6 — Automatic Routing & Cost Analytics**
- [ ] **M7 — Auth, Sessions & Encrypted Cloud Sync**
- [ ] **M8 — Production Hardening & Deployment**

See [`docs/roadmap.md`](./docs/roadmap.md) for full details.

---

## 🔒 Security & Privacy Notice

TokenPilot strictly enforces a **Zero-Secret Local Storage Policy**:
- API tokens and private keys are **never** stored in browser `localStorage` or `IndexedDB`.
- Workspace models and pools are persisted locally on the client without uploading proprietary configurations to untrusted servers.
- See [`docs/security.md`](./docs/security.md) for our threat model and credential handling guidelines.
