# Model Configuration & Templates Guide

This document describes how models are defined, imported, customized, and managed in TokenPilot.

---

## 1. ModelTemplate vs WorkspaceModel

TokenPilot maintains a strict separation between **Suggested Templates** and **Active Workspace Models**:

| Property | `ModelTemplate` | `WorkspaceModel` |
| :--- | :--- | :--- |
| **Lifecycle** | Built-in or fetched read-only catalog | User-created and mutable per workspace |
| **Customization** | Canonical defaults | Custom base URLs, custom credentials references, pricing overrides |
| **Pool Assignment**| Default suggested pools | Assigned to zero, one, or multiple custom pools |
| **State** | Immutable reference | Enabled / Disabled, evaluation status |
| **Deletion** | Cannot be deleted by user | Can be deleted without deleting historical usage events |

When a user selects a template or a Hugging Face Hub search result, TokenPilot clones the verified metadata into a distinct `WorkspaceModel` with a unique UUID. Modifications made by the user will never alter the base template.

---

## 2. Supported Execution Modes

TokenPilot models specify one of five runtime execution modes:

### 1. `huggingface_inference_providers`
- **Description**: Serverless remote inference served directly by supported Hugging Face inference partners (e.g., Together AI, Sambanova, Fireworks, Fal, etc.).
- **Identifier**: Hugging Face repository ID (e.g. `meta-llama/Llama-3.1-8B-Instruct`).
- **Execution Location**: Remote.

### 2. `huggingface_inference_endpoint`
- **Description**: Dedicated private or custom endpoint deployed on Hugging Face Infrastructure.
- **Identifier**: User endpoint URL (e.g. `https://xyz.endpoints.huggingface.cloud`).
- **Execution Location**: Remote.

### 3. `huggingface_local_transformers`
- **Description**: Direct execution via Python Transformers / PyTorch in a future local runtime runner.
- **Identifier**: Hugging Face repository ID or local weights path.
- **Execution Location**: Local.

### 4. `local_openai_compatible`
- **Description**: Local LLM servers offering `/v1/chat/completions` (e.g., Ollama at `http://localhost:11434/v1`, LM Studio at `http://localhost:1234/v1`, vLLM, or llama.cpp).
- **Identifier**: Runtime model tag (e.g., `llama3.2:3b`, `qwen2.5-coder:7b`).
- **Execution Location**: Local.

### 5. `remote_openai_compatible`
- **Description**: Remote hosted inference APIs following the OpenAI completions schema (e.g., DeepSeek, Groq, OpenRouter, Mistral, OpenAI).
- **Identifier**: Provider model string (e.g., `deepseek-chat`).
- **Execution Location**: Remote.

---

## 3. Metadata and Truthfulness

TokenPilot mandates absolute integrity in model metadata:

1. **Independent Metadata Dimensions**:
   - **Model Source (`model_source`)**: Where the weights or repository origin reside (`huggingface_hub`, `ollama_library`, `google_ai_studio`, `custom`).
   - **Source Repository ID (`source_repo_id`)**: Original repository identifier if applicable (e.g. `Qwen/Qwen2.5-Coder-7B-Instruct`).
   - **Execution Provider (`execution_provider`)**: The actual inference server engine executing requests (e.g. `ollama`, `vllm`, `huggingface_inference_providers`, `openai`, `gemini`).
   - **Execution Location (`execution_location`)**: Boundary locality (`local` machine or `remote` cloud).
   - **Runtime Model ID (`provider_model_id`)**: The model identifier expected by the runtime engine (e.g. `qwen2.5-coder:7b`).
2. **Licenses**: Display the actual license tag (`apache-2.0`, `mit`, `llama3.1`, `other`, etc.) if verified. If missing, flag as `unknown`. Do not classify unknown licenses as permissive.
3. **Gated Status**: Identify if the model requires accepting an agreement or license on Hugging Face before access (`gated: auto`, `manual`, or `none`).
4. **Capabilities**: `supports_tools`, `supports_vision`, `supports_streaming`, `supports_json_mode`. Each flag must be verified or defaulted to `false` until tested.
5. **Context Window**: Explicitly verified maximum context token length.
6. **Multi-Dimensional Pricing & Cost Basis**:
   - **Provider API Invoice Pricing**:
     - `input_price_per_million`: Billable cost in USD per 1M prompt tokens (0.0 for local hardware).
     - `output_price_per_million`: Billable cost in USD per 1M completion tokens (0.0 for local hardware).
     - `pricing_source`: Origin of pricing (e.g., `official_docs`, `user_override`, `free_local_hardware`).
     - `pricing_verified_at`: ISO timestamp when pricing was confirmed.
   - **Local Hardware Compute Cost (Optional)**:
     - `local_compute_price_per_million`: Configured amortized hardware compute price per 1M tokens.
     - `local_compute_cost_per_second`: Configured hardware compute rate in USD per second of inference latency.
     - **Truthful Rule**: If hardware compute is unconfigured, total inference cost remains strictly `unknown` (`null`) rather than coerced to $0.00. Unpriced models are safely analyzed on the Unpriced Tier shelf and excluded from the priced Pareto frontier.

---

## 4. Connection Testing & Diagnostics (Milestone M3.1)

TokenPilot enables developers to actively test endpoint reachability and credentials before dispatching live queries:

### Probe Architecture
- **Endpoint**: `POST /api/models/test-connection`
- **Zero-Secret Guarantee**: API keys and tokens are supplied in transient request memory (`pydantic.SecretStr`). Secrets are never written to database tables, logs, or persisted browser storage.
- **Truth in Diagnostics**:
  - **Endpoint Reachability**: Verifies that the TCP socket and HTTP service respond.
  - **Authentication Status**: Verifies that upstream credentials are accepted (`valid`), rejected (`invalid`), or not needed (`not_required`).
  - **Inference Verification**: A non-generative check (e.g., `/models` catalog probe or Hugging Face repository check) explicitly reports `inference_verified: false` to distinguish connectivity from full token generation (which is tested in M3.2).
- **Local vs Remote Network Boundaries**:
  - In local development mode, loopback (`localhost`, `127.0.0.1`) and local LAN addresses are permitted for local runtimes like Ollama and vLLM.
  - Cloud instance metadata addresses (`169.254.169.254`) are strictly blocked across all environments.

---

## 5. LLM Inference Gateway & Execution Modes (Milestone M3.2)

TokenPilot M3.2 delivers live chat completions streaming through a unified gateway abstraction (`POST /api/gateway/chat/completions`).

### Supported Execution Modes & Provider Adapters

1. **Local OpenAI-Compatible Runtimes (`local_openai_compatible`)**:
   - Targets local servers like Ollama (`http://localhost:11434/v1`), vLLM (`http://localhost:8000/v1`), LM Studio, or LocalAI.
   - Respects the configured `base_url` and `provider_model_id`.
   - Probes `{base_url}/chat/completions` with optional local auth tokens.

2. **Remote OpenAI-Compatible Endpoints (`remote_openai_compatible`)**:
   - Integrates remote APIs (e.g., OpenAI, Together AI, Groq, Mistral) via custom base URLs.
   - Enforces SSRF outbound IP filtering and accepts session-transient Bearer tokens.

3. **Hugging Face Inference Providers (`huggingface_inference_providers`)**:
   - Uses the official Hugging Face OpenAI-compatible router endpoint: `https://router.huggingface.co/v1/chat/completions`.
   - Authenticates using user-supplied transient Hugging Face tokens (`Authorization: Bearer <token>`).
   - Supports optional provider selection headers (`X-HF-Provider: <provider>`) for targeted routing (e.g. Together, SambaNova, Novita).

4. **Hugging Face Dedicated Endpoints (`huggingface_inference_endpoint`)**:
   - Targets customer-deployed dedicated containers (e.g., `https://<id>.endpoints.huggingface.cloud/v1/chat/completions`).
   - Rejects Hugging Face Hub model page URLs, requiring an active deployed endpoint URL.

5. **Direct Local Transformers (`huggingface_local_transformers`)**:
   - *Architecture Limitation*: Direct in-process weights loading using Python `transformers` is intentionally unsupported in this milestone. This prevents multi-gigabyte model weights from saturating memory inside the FastAPI gateway process. Users are instructed to serve the weights through an external runtime like Ollama or vLLM.


