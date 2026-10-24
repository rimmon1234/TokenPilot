import React, { useState } from 'react';
import { Settings, HardDrive, Download, RotateCcw, ShieldCheck, Lock } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { workspaceRepo } from '../storage/indexeddb_repository';

export const SettingsPage: React.FC = () => {
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const handleExportWorkspace = async () => {
    try {
      const models = await workspaceRepo.getWorkspaceModels();
      const pools = await workspaceRepo.getRoutingPools();
      const exportData = {
        exported_at: new Date().toISOString(),
        version: '0.1.0',
        workspace_models: models,
        routing_pools: pools,
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tokenpilot-workspace-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportStatus('Workspace configuration exported successfully.');
      setTimeout(() => setExportStatus(null), 4000);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  const handleResetWorkspace = async () => {
    if (confirm('Are you sure you want to reset your local workspace? This will clear configured models and pools.')) {
      if (typeof indexedDB !== 'undefined') {
        indexedDB.deleteDatabase('tokenpilot_workspace_db');
      }
      window.location.reload();
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="pb-4 border-b border-dark-800">
        <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
          <Settings className="w-6 h-6 text-brand-400" />
          Workspace Settings
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Manage browser-local persistence, export sanitized configuration, and view security policies.
        </p>
      </div>

      {exportStatus && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
          {exportStatus}
        </div>
      )}

      {/* Persistence Card */}
      <div className="dev-card p-5 bg-dark-900/80 border-dark-750 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <HardDrive className="w-4 h-4 text-cyan-400" />
          <span>Local Storage & Persistence</span>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          TokenPilot persists your workspace models, routing pools, and request telemetry inside browser <strong>IndexedDB</strong> via an isolated repository abstraction.
          Cloud synchronization and multi-tenant authentication will arrive in Milestone M7.
        </p>
        <div className="flex items-center gap-3 pt-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<Download className="w-3.5 h-3.5" />}
            onClick={handleExportWorkspace}
          >
            Export Sanitized Configuration (JSON)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={handleResetWorkspace}
          >
            Reset Local Workspace
          </Button>
        </div>
      </div>

      {/* Security Policy Card */}
      <div className="dev-card p-5 bg-dark-900/80 border-dark-750 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Lock className="w-4 h-4 text-brand-400" />
          <span>Zero-Secret Credential Policy</span>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          API keys, tokens, and credentials are never stored in browser storage (IndexedDB or localStorage) or committed to version control.
          All upstream execution requests will pass credentials through memory-only volatile session tokens or local server variables.
        </p>
      </div>

      {/* Documentation links */}
      <div className="dev-card p-5 bg-dark-900/80 border-dark-750 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Project Architecture & Documentation</span>
        </div>
        <ul className="text-xs text-slate-400 space-y-2">
          <li>• <strong>Architecture Overview:</strong> <code>docs/architecture.md</code></li>
          <li>• <strong>Model Configuration Rules:</strong> <code>docs/model-configuration.md</code></li>
          <li>• <strong>Dynamic Routing Pools:</strong> <code>docs/routing-policy.md</code></li>
          <li>• <strong>Security & Storage Plan:</strong> <code>docs/security.md</code></li>
          <li>• <strong>Milestone Roadmap:</strong> <code>docs/roadmap.md</code></li>
        </ul>
      </div>
    </div>
  );
};
