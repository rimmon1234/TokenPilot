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

1. **Licenses**: Display the actual license tag (`apache-2.0`, `mit`, `llama3.1`, `other`, etc.) if verified. If missing, flag as `unknown`. Do not classify unknown licenses as permissive.
2. **Gated Status**: Identify if the model requires accepting an agreement or license on Hugging Face before access (`gated: auto`, `manual`, or `none`).
3. **Capabilities**: `supports_tools`, `supports_vision`, `supports_streaming`, `supports_json_mode`. Each flag must be verified or defaulted to `false` until tested.
4. **Context Window**: Explicitly verified maximum context token length.
5. **Pricing**:
   - `input_price_per_million`: Cost in USD per 1M prompt tokens.
   - `output_price_per_million`: Cost in USD per 1M completion tokens.
   - `pricing_source`: Origin of pricing (e.g., `official_docs`, `user_override`, `free_local_tier`).
   - `pricing_verified_at`: ISO timestamp when pricing was confirmed.
