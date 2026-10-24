import React, { useState, useEffect } from 'react';
import { BarChart3 } from 'lucide-react';
import { workspaceRepo } from '../storage/indexeddb_repository';
import { UsageEvent } from '../types';

export const AnalyticsPage: React.FC = () => {
  const [events, setEvents] = useState<UsageEvent[]>([]);

  useEffect(() => {
    const load = async () => {
      const evs = await workspaceRepo.getUsageEvents();
      setEvents(evs);
    };
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-dark-800">
        <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
          <BarChart3 className="w-6 h-6 text-brand-400" />
          Gateway Analytics & Cost Telemetry
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Measure token consumption, latency metrics, and verified cost savings without fabricated benchmarks.
        </p>
      </div>

      {events.length === 0 ? (
        <div className="dev-card p-12 text-center border-dashed border-dark-750 max-w-2xl mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-brand-500/10 text-brand-400 flex items-center justify-center mx-auto mb-3">
            <BarChart3 className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-100">No Request Telemetry Recorded Yet</h3>
          <p className="text-xs text-slate-400 mt-2 mb-4 leading-relaxed">
            TokenPilot does not generate fabricated savings numbers. Once gateway queries are dispatched in Milestone M3, every request logs token counts, latency, and estimated cost calculated against verified model pricing.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left pt-4 border-t border-dark-800">
            <div className="p-3 rounded-lg bg-dark-850 border border-dark-800">
              <span className="text-[10px] text-slate-400 block mb-1">Measured Metric</span>
              <strong className="text-xs text-slate-200">Cost Savings vs Frontier</strong>
              <p className="text-[10px] text-slate-500 mt-1">Calculates USD saved compared to routing 100% of queries to top-tier models.</p>
            </div>

            <div className="p-3 rounded-lg bg-dark-850 border border-dark-800">
              <span className="text-[10px] text-slate-400 block mb-1">Measured Metric</span>
              <strong className="text-xs text-slate-200">Latency Distribution</strong>
              <p className="text-[10px] text-slate-500 mt-1">Tracks P50, P90, and P99 latency across local vs remote providers.</p>
            </div>

            <div className="p-3 rounded-lg bg-dark-850 border border-dark-800">
              <span className="text-[10px] text-slate-400 block mb-1">Measured Metric</span>
              <strong className="text-xs text-slate-200">Success Rate</strong>
              <p className="text-[10px] text-slate-500 mt-1">Monitors upstream provider uptime and fallback invocations.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-xs text-slate-400">Recorded {events.length} usage events</div>
        </div>
      )}
    </div>
  );
};
