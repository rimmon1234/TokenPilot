import React, { useState, useEffect } from 'react';
import { GitFork, Layers, Sliders, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { workspaceRepo } from '../storage/indexeddb_repository';
import { RoutingPool, WorkspaceModel } from '../types';

export const RoutingPage: React.FC = () => {
  const [pools, setPools] = useState<RoutingPool[]>([]);
  const [models, setModels] = useState<WorkspaceModel[]>([]);

  useEffect(() => {
    const load = async () => {
      const ps = await workspaceRepo.getRoutingPools();
      const ms = await workspaceRepo.getWorkspaceModels();
      setPools(ps);
      setModels(ms);
    };
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-dark-800 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
            <GitFork className="w-6 h-6 text-brand-400" />
            Routing Pools & Policies
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Dynamic user-defined groups and routing constraints. (Automated ML routing model arriving in Milestone M6).
          </p>
        </div>

        <Link to="/studio">
          <Button size="sm" variant="primary" icon={<Sliders className="w-3.5 h-3.5" />}>
            Configure Pools in Studio
          </Button>
        </Link>
      </div>

      {/* Pool Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {pools.map((pool) => {
          const poolModels = models.filter((m) => m.assigned_pool_ids.includes(pool.id));
          return (
            <div key={pool.id} className="dev-card p-5 bg-dark-900/90 border-dark-750">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-brand-400" />
                    {pool.name}
                  </h3>
                  {pool.description && (
                    <p className="text-xs text-slate-400 mt-1">{pool.description}</p>
                  )}
                </div>
                {pool.is_default && (
                  <Badge variant="brand" className="text-[10px]">
                    Default
                  </Badge>
                )}
              </div>

              {/* Models assigned */}
              <div className="mt-4 pt-3 border-t border-dark-800">
                <span className="text-xs font-semibold text-slate-300 block mb-2">
                  Assigned Models ({poolModels.length})
                </span>
                {poolModels.length > 0 ? (
                  <div className="space-y-1.5">
                    {poolModels.map((m) => (
                      <div
                        key={m.id}
                        className="p-2 rounded bg-dark-850 border border-dark-800 text-xs flex items-center justify-between"
                      >
                        <span className="font-medium text-slate-200">{m.display_name}</span>
                        <Badge
                          variant={m.execution_location === 'local' ? 'info' : 'neutral'}
                          className="text-[10px] py-0"
                        >
                          {m.execution_location}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">No models currently assigned to this pool.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Milestone Preview Banner */}
      <div className="p-4 rounded-xl bg-dark-900 border border-dark-800 text-xs text-slate-400 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>
            <strong>Architectural Guarantee:</strong> Model pool membership is completely dynamic and decoupled from model definitions. Models can belong to multiple pools concurrently.
          </span>
        </span>
      </div>
    </div>
  );
};
