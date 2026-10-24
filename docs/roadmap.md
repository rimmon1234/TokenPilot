# TokenPilot Milestone Roadmap

TokenPilot is developed in deliberate, verifiable milestones. Each milestone delivers functional increments while preserving strict architectural boundaries.

---

## Roadmap Overview

| Milestone | Title | Focus Area | Status |
| :--- | :--- | :--- | :--- |
| **M0** | Architecture & Repo Setup | Architecture docs, schemas, git workflow, issue templates | **Complete** |
| **M1** | Frontend/Backend Skeleton | FastAPI foundation, Vite/React shell, navigation, contracts | **Complete** |
| **M2** | Model Studio & HF Discovery | HF Hub discovery, custom models, pool management, IndexedDB | **In Progress / Current** |
| **M3** | Direct Gateway Calls & Usage | Inference adapters (HF Providers, OpenAI-compatible), usage accounting | Planned |
| **M4** | Benchmarking & Evaluation | Evaluation harness, standard benchmark datasets, quality scoring | Planned |
| **M5** | Supervised ML Router | Feature extraction, scikit-learn / CatBoost training, model serialization | Planned |
| **M6** | Intelligent Gateway Routing | Real-time ML routing, cost constraints, savings analytics | Planned |
| **M7** | Auth & Cloud Workspaces | User auth, encrypted credential vault, multi-device cloud sync | Planned |
| **M8** | Production Hardening | End-to-end integration tests, security audit, Docker deployment | Planned |

---

## Detailed Milestone Breakdown

### Milestone M0: Architecture, Documentation & Repository Setup
- System architecture specification (`docs/architecture.md`)
- Model configuration and execution mode rules (`docs/model-configuration.md`)
- Routing policy & dynamic pools specification (`docs/routing-policy.md`)
- Complete data schema (`docs/data-schema.md`)
- Security and zero-secret credential policy (`docs/security.md`)
- GitHub issue templates and PR guidelines

### Milestone M1: Frontend/Backend Skeleton & Core Contracts
- FastAPI backend scaffold with health checks, Pydantic v2 schemas, and CORS configuration
- React/Vite/TypeScript frontend scaffold with Tailwind CSS and React Router
- Professional developer-tool dark theme layout and full navigation shell:
  - Playground
  - Model Studio
  - Routing
  - Analytics
  - Benchmark Lab
  - Settings
- Initial automated schema validation and contract tests

### Milestone M2: Model Studio, Hugging Face Discovery & Routing Pools
- Hugging Face Hub text-generation model discovery backend proxy
- Resilient error handling, rate limiting handling, and client retry actions
- Verified metadata extraction (licenses, gated status, context window, quantization)
- Model Studio UI:
  - Browse suggested curated templates
  - Live Hugging Face Hub search with filter tags
  - "Add to Workspace" modal with custom parameter overrides
  - "Add Custom Model" modal (for local Ollama/vLLM or remote APIs)
  - Enable/disable toggles per model
  - Model deletion (preserving usage history)
- User-defined Routing Pools:
  - Default "Economy" and "Quality" groups
  - Create, rename, delete custom pools
  - Many-to-many model pool membership configuration
- Client-side persistence using IndexedDB behind `IWorkspaceRepository` abstraction

### Milestone M3: Direct Model Calls, Credentials Handling & Request Telemetry
- Inference adapters:
  - Hugging Face Inference Providers
  - Local OpenAI-compatible server (Ollama, vLLM, LM Studio)
  - Remote OpenAI-compatible API
- Secure execution token passing (memory only, never persisted)
- Playground chat testing UI
- `UsageEvent` recording (token counts, pricing snapshots, measured latency, status)

### Milestone M4: Dataset Construction & Model Benchmarking
- Benchmark dataset ingestion (Reasoning, Coding, Conversational subsets)
- Offline evaluation runner for latency, cost, and quality scoring
- Populating model evaluation profiles (`ModelEvaluationProfile`)

### Milestone M5: Supervised ML Router Training
- Feature engineering on input prompts (syntactic tokens, regex markers, embeddings)
- Training pipeline comparing `scikit-learn` vs `CatBoost`
- Hyperparameter tuning, calibration, and serialization to `.onnx` / `.joblib`

### Milestone M6: Automatic Routing & Savings Analytics
- Gateway policy engine integrating trained ML router
- Cost ceiling and minimum quality threshold constraints
- Analytics dashboard displaying actual cost reduction vs frontier baseline

### Milestone M7: Authentication & Encrypted Cloud Sync
- User accounts and session management (JWT / OAuth)
- Multi-device cloud sync via SQLite/PostgreSQL
- Envelope encryption (AES-256-GCM) for provider keys

### Milestone M8: Testing, Security Hardening & Release
- Comprehensive end-to-end test suite
- Automated CI/CD pipeline
- Docker compose and production deployment guides
