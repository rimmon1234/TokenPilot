# Dynamic Routing Pools & Policy Specification

TokenPilot empowers developers to control model dispatching through dynamic routing pools and intelligent policies.

---

## 1. User-Defined Routing Pools

A **Routing Pool** is an arbitrary, user-defined collection of workspace models. 

### Core Rules:
1. **No hardcoded pool membership**: Models are not baked into pools at compile time.
2. **Many-to-many**: A model can belong to zero, one, or several pools (via `PoolMembership`).
3. **Decoupled attributes**: Execution location (local vs. remote) is independent of cost profile (economy vs. quality).
   - An 8B parameter local model running on user hardware may be classified into an "Economy" pool and a "Local Only" pool.
   - A remote quantized 1.5B model on a serverless provider might also belong to the "Economy" pool.
4. **Initial Default Pools**:
   - `Economy`: Focus on minimum token cost and fast throughput for lightweight tasks.
   - `Quality`: Focus on high reasoning capacity, coding capabilities, and comprehensive answers.

### Custom Pool Examples:
- `Local Only`: Models constrained to `execution_location == 'local'` for maximum privacy and zero data egress.
- `Coding Specialists`: Models fine-tuned for code synthesis and diff generation.
- `Fast Responses`: Models optimized for interactive sub-second latency.
- `Free Tier`: Zero marginal cost inference (local Ollama or free provider quotas).

---

## 2. Pool Membership Data Structure

```typescript
interface PoolMembership {
  id: string;               // UUID
  pool_id: string;          // Target RoutingPool ID
  model_id: string;         // Target WorkspaceModel ID
  priority: number;         // Relative weight or preference order within pool (1-100)
  is_fallback: boolean;     // Whether model serves as emergency backup
  created_at: string;
}
```

---

## 3. Routing Policy Configuration

Each pool or gateway request can evaluate a `RoutingPolicy`:

```typescript
interface RoutingPolicy {
  id: string;
  pool_id: string;
  name: string;
  routing_strategy: 'cost_optimized' | 'quality_optimized' | 'ml_predicted' | 'round_robin' | 'manual_priority';
  min_quality_threshold?: number;   // 0.0 to 1.0 based on benchmark labels
  max_cost_per_million_input?: number;
  max_cost_per_million_output?: number;
  max_acceptable_latency_ms?: number;
  allowed_locations?: ('local' | 'remote')[];
  fallback_model_id?: string;
  retry_on_failure: boolean;
  max_retries: number;
}
```

---

## 4. Execution Workflow

When a request arrives at the Gateway:
1. Identify target routing pool (e.g. from request header or default workspace pool).
2. Retrieve all enabled `WorkspaceModel` instances assigned to the pool.
3. Filter by hard constraints:
   - Location constraints (e.g., must be `local` if local-only requested).
   - Context window limit (must accommodate prompt length).
   - Required capabilities (e.g., `supports_tools` if function calling is active).
   - Maximum budget constraint.
4. If ML routing is active (Milestone M6), run feature extraction on prompt and evaluate cost-vs-quality trade-off model.
5. Dispatch to selected model; handle failover to backup model on network or rate limit failure.
