import React, { useState, useEffect } from 'react';
import { Compass, Send, Sparkles, ArrowRight, Layers, Cpu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { workspaceRepo } from '../storage/indexeddb_repository';
import { WorkspaceModel, RoutingPool } from '../types';

export const PlaygroundPage: React.FC = () => {
  const [models, setModels] = useState<WorkspaceModel[]>([]);
  const [pools, setPools] = useState<RoutingPool[]>([]);
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    const load = async () => {
      const ms = await workspaceRepo.getWorkspaceModels();
      const ps = await workspaceRepo.getRoutingPools();
      setModels(ms);
      setPools(ps);
    };
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-dark-800 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
            <Compass className="w-6 h-6 text-brand-400" />
            Gateway Playground
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Test prompt routing through dynamic model pools. (Direct execution & credentials coming in Milestone M3).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/studio">
            <Button size="sm" variant="secondary" icon={<Cpu className="w-3.5 h-3.5" />}>
              Configure Models ({models.length})
            </Button>
          </Link>
        </div>
      </div>

      {models.length === 0 ? (
        <div className="dev-card p-12 text-center border-dashed border-dark-750">
          <Cpu className="w-10 h-10 text-brand-400/80 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-100">No Models in Workspace</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto mt-1 mb-5">
            To start using the playground, first add models from the Hugging Face Hub or select our curated suggestions in the Model Studio.
          </p>
          <Link to="/studio">
            <Button size="md" variant="primary" icon={<ArrowRight className="w-4 h-4" />}>
              Go to Model Studio
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Chat Interface */}
          <div className="lg:col-span-3 dev-card p-5 bg-dark-900/80 flex flex-col justify-between min-h-[460px]">
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-dark-850/80 border border-dark-800 text-xs text-slate-300 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-brand-400" />
                  Active Workspace Models available for gateway dispatch: {models.filter((m) => m.enabled).length} active
                </span>
                <span className="text-[10px] text-slate-500 font-mono">Milestone M3 Adapter Ready</span>
              </div>

              {/* Sample conversation preview */}
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-dark-800/60 border border-dark-750/50 text-xs text-slate-300">
                  <div className="font-semibold text-brand-300 mb-1">System Gateway</div>
                  <p>
                    TokenPilot Gateway initialized. Configured models and routing pools are loaded from your local IndexedDB workspace.
                  </p>
                </div>
              </div>
            </div>

            {/* Prompt input */}
            <div className="pt-4 border-t border-dark-800 space-y-2">
              <div className="relative">
                <textarea
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Enter a prompt to test model routing and response quality..."
                  className="w-full p-3 rounded-xl bg-dark-850 border border-dark-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-brand-500 resize-none font-mono"
                />
                <Button
                  size="sm"
                  variant="primary"
                  className="absolute right-3 bottom-4"
                  icon={<Send className="w-3.5 h-3.5" />}
                  onClick={() => alert('Direct inference execution and credential passing will be enabled in Milestone M3.')}
                >
                  Dispatch
                </Button>
              </div>
              <p className="text-[10px] text-slate-500">
                Milestone M3 will stream completions directly via Hugging Face Inference Providers or local OpenAI-compatible endpoints.
              </p>
            </div>
          </div>

          {/* Sidebar: Active Pools */}
          <div className="space-y-4">
            <div className="dev-card p-4">
              <h4 className="text-xs font-semibold text-slate-300 mb-3 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-brand-400" />
                Active Routing Pools
              </h4>
              <div className="space-y-2">
                {pools.map((p) => {
                  const poolModels = models.filter((m) => m.assigned_pool_ids.includes(p.id));
                  return (
                    <div key={p.id} className="p-2.5 rounded-lg bg-dark-850 border border-dark-800 text-xs">
                      <div className="font-semibold text-slate-200">{p.name}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{poolModels.length} models assigned</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
