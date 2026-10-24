import {
  BenchmarkRun,
  BenchmarkResult,
  BenchmarkRunCreate,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

export async function createBenchmarkRun(
  request: BenchmarkRunCreate
): Promise<BenchmarkRun> {
  const res = await fetch(`${API_BASE}/benchmarks/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    let errorDetail = `Failed to create benchmark run (HTTP ${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson && errJson.detail) {
        errorDetail = errJson.detail;
      }
    } catch {
      // fallback to status text
    }
    throw new Error(errorDetail);
  }

  return await res.json();
}

export async function fetchBenchmarkRuns(): Promise<BenchmarkRun[]> {
  try {
    const res = await fetch(`${API_BASE}/benchmarks/runs`);
    if (!res.ok) {
      throw new Error(`Failed to load benchmark runs (HTTP ${res.status})`);
    }
    return await res.json();
  } catch (err) {
    console.warn('Error fetching benchmark runs:', err);
    throw err;
  }
}

export async function fetchBenchmarkRun(runId: string): Promise<BenchmarkRun | null> {
  try {
    const res = await fetch(`${API_BASE}/benchmarks/runs/${encodeURIComponent(runId)}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Failed to load benchmark run (HTTP ${res.status})`);
    }
    return await res.json();
  } catch (err) {
    console.warn(`Error fetching benchmark run '${runId}':`, err);
    throw err;
  }
}

export async function fetchBenchmarkResults(
  runId: string,
  limit: number = 50,
  offset: number = 0
): Promise<BenchmarkResult[]> {
  const url = `${API_BASE}/benchmarks/runs/${encodeURIComponent(runId)}/results?limit=${limit}&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load benchmark results (HTTP ${res.status})`);
  }
  return await res.json();
}

export async function cancelBenchmarkRun(runId: string): Promise<BenchmarkRun> {
  const res = await fetch(`${API_BASE}/benchmarks/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
  });
  if (!res.ok) {
    let errorDetail = `Failed to cancel benchmark run (HTTP ${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson && errJson.detail) {
        errorDetail = errJson.detail;
      }
    } catch {
      // fallback
    }
    throw new Error(errorDetail);
  }
  return await res.json();
}
