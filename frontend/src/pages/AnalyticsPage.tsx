import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  Clock,
  Coins,
  Cpu,
  Filter,
  Layers,
  ShieldCheck,
  Zap,
  CheckCircle2,
  XCircle,
  AlertOctagon,
  Trash2,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { workspaceRepo } from '../storage/indexeddb_repository';
import { UsageEvent, WorkspaceModel } from '../types';
import {
  formatCost,
  formatTokens,
  calculatePercentile,
} from '../services/cost_accounting';

type DateRangeFilter = 'all' | 'today' | '7d' | '30d';

export const AnalyticsPage: React.FC = () => {
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [models, setModels] = useState<WorkspaceModel[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all');
  const [selectedModelId, setSelectedModelId] = useState<string>('all');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const [confirmClear, setConfirmClear] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const [evs, ms] = await Promise.all([
      workspaceRepo.getUsageEvents(),
      workspaceRepo.getWorkspaceModels(),
    ]);
    setEvents(evs);
    setModels(ms);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleClearUsage = async () => {
    await workspaceRepo.clearAllUsageEvents();
    setEvents([]);
    setConfirmClear(false);
  };

  // Filtered Events
  const filteredEvents = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;

    return events.filter((ev) => {
      // Date filter
      const evTime = new Date(ev.timestamp).getTime();
      if (dateRange === 'today' && evTime < todayStart) return false;
      if (dateRange === '7d' && evTime < sevenDaysAgo) return false;
      if (dateRange === '30d' && evTime < thirtyDaysAgo) return false;

      // Model filter
      if (selectedModelId !== 'all' && ev.workspace_model_id !== selectedModelId) {
        return false;
      }

      // Provider filter
      if (selectedProvider !== 'all' && ev.provider_type !== selectedProvider) {
        return false;
      }

      // Location filter
      if (selectedLocation !== 'all' && ev.execution_location !== selectedLocation) {
        return false;
      }

      // Status filter
      if (selectedStatus !== 'all' && ev.status !== selectedStatus) {
        return false;
      }

      return true;
    });
  }, [events, dateRange, selectedModelId, selectedProvider, selectedLocation, selectedStatus]);

  // Unique filter options
  const providerOptions = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => set.add(e.provider_type));
    return Array.from(set);
  }, [events]);

  const modelOptions = useMemo(() => {
    const map = new Map<string, string>();
    events.forEach((e) => {
      const live = models.find((m) => m.id === e.workspace_model_id);
      const name = live ? live.display_name : `${e.model_display_name_snapshot} (Archived)`;
      map.set(e.workspace_model_id, name);
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [events, models]);

  // Derived Analytics Computations
  const stats = useMemo(() => {
    const totalRequests = filteredEvents.length;
    const successfulRequests = filteredEvents.filter((e) => e.status === 'success').length;
    const failedRequests = filteredEvents.filter((e) => e.status === 'failed').length;
    const cancelledRequests = filteredEvents.filter((e) => e.status === 'cancelled').length;

    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;
    let knownSpendUsd = 0;
    let knownSpendCount = 0;
    let unknownCostCount = 0;

    const latencies: number[] = [];
    const ttfts: number[] = [];

    const modelGroups = new Map<
      string,
      {
        displayName: string;
        provider: string;
        location: string;
        requests: number;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        spendUsd: number;
        hasUnknownCost: boolean;
        latencies: number[];
      }
    >();

    const provenanceCounts = {
      provider_reported: 0,
      estimated: 0,
      unavailable: 0,
    };

    filteredEvents.forEach((e) => {
      // Tokens
      const p = e.prompt_tokens ?? 0;
      const c = e.completion_tokens ?? 0;
      const t = e.total_tokens ?? p + c;
      totalPromptTokens += p;
      totalCompletionTokens += c;
      totalTokens += t;

      // Latencies
      if (typeof e.latency_ms === 'number' && e.latency_ms > 0) {
        latencies.push(e.latency_ms);
      }
      if (typeof e.time_to_first_token_ms === 'number' && e.time_to_first_token_ms > 0) {
        ttfts.push(e.time_to_first_token_ms);
      }

      // Cost
      if (e.cost_status === 'known' && typeof e.estimated_cost_usd === 'number') {
        knownSpendUsd += e.estimated_cost_usd;
        knownSpendCount++;
      } else {
        unknownCostCount++;
      }

      // Provenance
      if (e.token_provenance in provenanceCounts) {
        provenanceCounts[e.token_provenance]++;
      }

      // Model grouping
      const modelKey = e.workspace_model_id || e.model_display_name_snapshot;
      const live = models.find((m) => m.id === e.workspace_model_id);
      const displayName = live ? live.display_name : `${e.model_display_name_snapshot} (Archived)`;

      if (!modelGroups.has(modelKey)) {
        modelGroups.set(modelKey, {
          displayName,
          provider: e.provider_type,
          location: e.execution_location,
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          spendUsd: 0,
          hasUnknownCost: false,
          latencies: [],
        });
      }

      const g = modelGroups.get(modelKey)!;
      g.requests++;
      g.promptTokens += p;
      g.completionTokens += c;
      g.totalTokens += t;
      if (e.cost_status === 'known' && typeof e.estimated_cost_usd === 'number') {
        g.spendUsd += e.estimated_cost_usd;
      } else {
        g.hasUnknownCost = true;
      }
      if (typeof e.latency_ms === 'number' && e.latency_ms > 0) {
        g.latencies.push(e.latency_ms);
      }
    });

    const avgLatency =
      latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
    const p50Latency = calculatePercentile(latencies, 50);
    const p90Latency = calculatePercentile(latencies, 90);
    const p95Latency = calculatePercentile(latencies, 95);

    const avgTtft = ttfts.length > 0 ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : null;

    const modelsList = Array.from(modelGroups.values()).sort((a, b) => b.requests - a.requests);

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      cancelledRequests,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      knownSpendUsd,
      knownSpendCount,
      unknownCostCount,
      avgLatency,
      p50Latency,
      p90Latency,
      p95Latency,
      avgTtft,
      provenanceCounts,
      modelsList,
    };
  }, [filteredEvents, models]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-dark-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
            <BarChart3 className="w-6 h-6 text-brand-400" />
            Gateway Analytics & Cost Accounting
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real usage telemetry, latency percentiles, and verified cost accounting derived from persisted inference records.
          </p>
        </div>

        {events.length > 0 && (
          <div className="flex items-center gap-2">
            {confirmClear ? (
              <div className="flex items-center gap-1.5 p-1 bg-rose-950/40 border border-rose-800/60 rounded-lg">
                <span className="text-[11px] text-rose-300 px-2">Clear all recorded analytics?</span>
                <Button size="sm" variant="danger" onClick={handleClearUsage}>
                  Confirm
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setConfirmClear(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                icon={<Trash2 className="w-3.5 h-3.5 text-rose-400" />}
                onClick={() => setConfirmClear(true)}
              >
                Clear Analytics
              </Button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="dev-card p-12 text-center text-slate-400">
          <div className="inline-block w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mb-2" />
          <p className="text-xs">Loading analytics telemetry...</p>
        </div>
      ) : events.length === 0 ? (
        <div className="dev-card p-12 text-center border-dashed border-dark-750 max-w-2xl mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-brand-500/10 text-brand-400 flex items-center justify-center mx-auto mb-3">
            <BarChart3 className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-100">No Request Telemetry Recorded Yet</h3>
          <p className="text-xs text-slate-400 mt-2 mb-4 leading-relaxed">
            TokenPilot does not generate fabricated numbers. When you dispatch chats in the Gateway Playground, each query logs token counts, latency, and estimated cost against verified price cards.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left pt-4 border-t border-dark-800">
            <div className="p-3 rounded-lg bg-dark-850 border border-dark-800">
              <span className="text-[10px] text-slate-400 block mb-1">Measured Metric</span>
              <strong className="text-xs text-slate-200">Verified Cost Audit</strong>
              <p className="text-[10px] text-slate-400 mt-1">Calculates actual USD cost per token using immutable pricing snapshots.</p>
            </div>

            <div className="p-3 rounded-lg bg-dark-850 border border-dark-800">
              <span className="text-[10px] text-slate-400 block mb-1">Measured Metric</span>
              <strong className="text-xs text-slate-200">Latency Percentiles</strong>
              <p className="text-[10px] text-slate-400 mt-1">Computes P50, P90, and P95 latency distributions across local and remote models.</p>
            </div>

            <div className="p-3 rounded-lg bg-dark-850 border border-dark-800">
              <span className="text-[10px] text-slate-400 block mb-1">Measured Metric</span>
              <strong className="text-xs text-slate-200">Provenance & Uptime</strong>
              <p className="text-[10px] text-slate-400 mt-1">Audits provider-reported token fidelity vs estimated tokens and error rates.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Filters Bar */}
          <div className="dev-card p-4 bg-dark-850/80 border border-dark-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1.5 text-slate-400">
                <Filter className="w-3.5 h-3.5 text-brand-400" />
                <span className="font-medium text-slate-300">Filters:</span>
              </div>

              {/* Date Filter */}
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as DateRangeFilter)}
                className="bg-dark-800 border border-dark-700 text-slate-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-brand-500 font-medium"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
              </select>

              {/* Model Filter */}
              <select
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                className="bg-dark-800 border border-dark-700 text-slate-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-brand-500"
              >
                <option value="all">All Models</option>
                {modelOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {/* Provider Filter */}
              {providerOptions.length > 1 && (
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  className="bg-dark-800 border border-dark-700 text-slate-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-brand-500 capitalize"
                >
                  <option value="all">All Providers</option>
                  {providerOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}

              {/* Location Filter */}
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="bg-dark-800 border border-dark-700 text-slate-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-brand-500"
              >
                <option value="all">All Locations</option>
                <option value="local">Local Only</option>
                <option value="remote">Remote Only</option>
              </select>

              {/* Status Filter */}
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="bg-dark-800 border border-dark-700 text-slate-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-brand-500"
              >
                <option value="all">All Statuses</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div className="text-[11px] text-slate-400">
              Showing <strong className="text-slate-200">{filteredEvents.length}</strong> of{' '}
              <strong className="text-slate-200">{events.length}</strong> events
            </div>
          </div>

          {/* Overview Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Total Requests */}
            <div className="dev-card p-4 space-y-2 bg-dark-900 border border-dark-800">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span className="font-medium">Total Requests</span>
                <Layers className="w-4 h-4 text-brand-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-slate-100">
                {stats.totalRequests.toLocaleString()}
              </div>
              <div className="flex items-center gap-2 text-[11px] pt-1 border-t border-dark-800/80">
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> {stats.successfulRequests} OK
                </span>
                {stats.failedRequests > 0 && (
                  <span className="text-rose-400 flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> {stats.failedRequests} Fail
                  </span>
                )}
                {stats.cancelledRequests > 0 && (
                  <span className="text-amber-400 flex items-center gap-1">
                    <AlertOctagon className="w-3 h-3" /> {stats.cancelledRequests} Stop
                  </span>
                )}
              </div>
            </div>

            {/* 2. Total Tokens */}
            <div className="dev-card p-4 space-y-2 bg-dark-900 border border-dark-800">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span className="font-medium">Tokens Consumed</span>
                <Zap className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-slate-100">
                {formatTokens(stats.totalTokens)}
              </div>
              <div className="text-[11px] text-slate-400 pt-1 border-t border-dark-800/80 flex justify-between">
                <span>In: {formatTokens(stats.totalPromptTokens)}</span>
                <span>Out: {formatTokens(stats.totalCompletionTokens)}</span>
              </div>
            </div>

            {/* 3. Estimated Spend */}
            <div className="dev-card p-4 space-y-2 bg-dark-900 border border-dark-800">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span className="font-medium">Estimated API Spend</span>
                <Coins className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-emerald-400">
                {formatCost(stats.knownSpendUsd, 'known')}
              </div>
              <div className="text-[11px] text-slate-400 pt-1 border-t border-dark-800/80 flex justify-between items-center">
                <span>{stats.knownSpendCount} priced requests</span>
                {stats.unknownCostCount > 0 && (
                  <span className="text-amber-400/80 text-[10px]">
                    {stats.unknownCostCount} unpriced
                  </span>
                )}
              </div>
            </div>

            {/* 4. Average Latency */}
            <div className="dev-card p-4 space-y-2 bg-dark-900 border border-dark-800">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span className="font-medium">Average Latency</span>
                <Clock className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-slate-100">
                {stats.avgLatency !== null ? `${Math.round(stats.avgLatency)} ms` : '—'}
              </div>
              <div className="text-[11px] text-slate-400 pt-1 border-t border-dark-800/80 flex justify-between">
                <span>P50: {stats.p50Latency ? `${stats.p50Latency} ms` : '—'}</span>
                <span>P95: {stats.p95Latency ? `${stats.p95Latency} ms` : '—'}</span>
              </div>
            </div>
          </div>

          {/* Model Breakdown & Cost Analysis Table */}
          <div className="dev-card p-5 bg-dark-900 border border-dark-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-brand-400" />
                Model Volume & Cost Allocation
              </h3>
              <span className="text-[11px] text-slate-400">
                Derived from verified pricing snapshots
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-dark-800 text-slate-400 font-medium">
                    <th className="py-2.5 px-3">Model</th>
                    <th className="py-2.5 px-3">Location</th>
                    <th className="py-2.5 px-3 text-right">Requests</th>
                    <th className="py-2.5 px-3 text-right">Prompt Tokens</th>
                    <th className="py-2.5 px-3 text-right">Completion</th>
                    <th className="py-2.5 px-3 text-right">Total Tokens</th>
                    <th className="py-2.5 px-3 text-right">Avg Latency</th>
                    <th className="py-2.5 px-3 text-right">Est. Cost (USD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-800/50 text-slate-300">
                  {stats.modelsList.map((m, idx) => {
                    const avgM =
                      m.latencies.length > 0
                        ? Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length)
                        : null;

                    return (
                      <tr key={idx} className="hover:bg-dark-850/50 transition-colors">
                        <td className="py-3 px-3 font-medium text-slate-100 flex items-center gap-2">
                          <Cpu className="w-3.5 h-3.5 text-brand-400 shrink-0" />
                          <span className="truncate max-w-[200px]" title={m.displayName}>
                            {m.displayName}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <Badge variant={m.location === 'local' ? 'info' : 'brand'}>
                            {m.location}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-right font-mono">{m.requests}</td>
                        <td className="py-3 px-3 text-right font-mono text-slate-400">
                          {formatTokens(m.promptTokens)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-400">
                          {formatTokens(m.completionTokens)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-200">
                          {formatTokens(m.totalTokens)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-300">
                          {avgM !== null ? `${avgM} ms` : '—'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-medium">
                          {m.location === 'local' ? (
                            <span className="text-slate-400" title="Local execution (unpriced compute)">
                              Local Compute
                            </span>
                          ) : (
                            <span className="text-emerald-400">{formatCost(m.spendUsd, 'known')}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Performance & Provenance Analysis */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Latency Percentiles Card */}
            <div className="dev-card p-5 bg-dark-900 border border-dark-800 space-y-4">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                Latency Distribution (ms)
              </h3>
              <p className="text-xs text-slate-400">
                Measures response responsiveness across all completed gateway requests.
              </p>

              <div className="grid grid-cols-3 gap-3 pt-2">
                <div className="p-3 rounded-lg bg-dark-850 border border-dark-800 text-center">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                    P50 (Median)
                  </span>
                  <strong className="text-base font-mono text-slate-100">
                    {stats.p50Latency ? `${stats.p50Latency} ms` : '—'}
                  </strong>
                </div>

                <div className="p-3 rounded-lg bg-dark-850 border border-dark-800 text-center">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                    P90
                  </span>
                  <strong className="text-base font-mono text-slate-100">
                    {stats.p90Latency ? `${stats.p90Latency} ms` : '—'}
                  </strong>
                </div>

                <div className="p-3 rounded-lg bg-dark-850 border border-dark-800 text-center">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                    P95
                  </span>
                  <strong className="text-base font-mono text-slate-100">
                    {stats.p95Latency ? `${stats.p95Latency} ms` : '—'}
                  </strong>
                </div>
              </div>

              {stats.avgTtft !== null && (
                <div className="p-2.5 rounded-lg bg-dark-850/60 border border-dark-800 flex justify-between items-center text-xs text-slate-300">
                  <span>Average Time to First Token (TTFT):</span>
                  <span className="font-mono font-medium text-slate-100">
                    {Math.round(stats.avgTtft)} ms
                  </span>
                </div>
              )}
            </div>

            {/* Token Provenance & Accounting Fidelity */}
            <div className="dev-card p-5 bg-dark-900 border border-dark-800 space-y-4">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Accounting Provenance & Coverage
              </h3>
              <p className="text-xs text-slate-400">
                Audits the source of token metrics without assuming unpriced usage is free.
              </p>

              <div className="space-y-3 pt-1">
                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>Provider-Reported Tokens</span>
                    <span className="font-mono">
                      {stats.provenanceCounts.provider_reported} requests (
                      {stats.totalRequests > 0
                        ? Math.round(
                            (stats.provenanceCounts.provider_reported / stats.totalRequests) * 100
                          )
                        : 0}
                      %)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-dark-800 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{
                        width: `${
                          stats.totalRequests > 0
                            ? (stats.provenanceCounts.provider_reported / stats.totalRequests) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>Estimated Tokens</span>
                    <span className="font-mono">
                      {stats.provenanceCounts.estimated} requests (
                      {stats.totalRequests > 0
                        ? Math.round((stats.provenanceCounts.estimated / stats.totalRequests) * 100)
                        : 0}
                      %)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-dark-800 overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full"
                      style={{
                        width: `${
                          stats.totalRequests > 0
                            ? (stats.provenanceCounts.estimated / stats.totalRequests) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>Unavailable Tokens (Failed before usage)</span>
                    <span className="font-mono">
                      {stats.provenanceCounts.unavailable} requests (
                      {stats.totalRequests > 0
                        ? Math.round(
                            (stats.provenanceCounts.unavailable / stats.totalRequests) * 100
                          )
                        : 0}
                      %)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-dark-800 overflow-hidden">
                    <div
                      className="h-full bg-dark-700 rounded-full"
                      style={{
                        width: `${
                          stats.totalRequests > 0
                            ? (stats.provenanceCounts.unavailable / stats.totalRequests) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
