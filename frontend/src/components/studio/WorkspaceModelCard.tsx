import React from 'react';
import {
  Cpu,
  Server,
  Trash2,
  Settings2,
  ExternalLink,
  Layers,
  Coins,
  ShieldAlert,
  CheckCircle,
  HelpCircle,
} from 'lucide-react';
import { WorkspaceModel, RoutingPool } from '../../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface WorkspaceModelCardProps {
  model: WorkspaceModel;
  allPools: RoutingPool[];
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onEdit: (model: WorkspaceModel) => void;
  onDelete: (id: string) => void;
}

export const WorkspaceModelCard: React.FC<WorkspaceModelCardProps> = ({
  model,
  allPools,
  onToggleEnabled,
  onEdit,
  onDelete,
}) => {
  const assignedPools = allPools.filter((p) => model.assigned_pool_ids.includes(p.id));

  const formatPrice = (price: number) => {
    if (price === 0) return 'Free';
    return `$${price.toFixed(2)}`;
  };

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case 'huggingface_inference_providers':
        return 'HF Inference Providers';
      case 'huggingface_inference_endpoint':
        return 'HF Dedicated Endpoint';
      case 'huggingface_local_transformers':
        return 'HF Transformers (Local)';
      case 'local_openai_compatible':
        return 'Local OpenAI Compatible';
      case 'remote_openai_compatible':
        return 'Remote OpenAI Compatible';
      default:
        return mode;
    }
  };

  return (
    <div
      className={`dev-card p-5 relative overflow-hidden transition-all ${
        model.enabled ? 'border-dark-700 bg-dark-900/90' : 'opacity-65 border-dark-800 bg-dark-950/60'
      }`}
    >
      {/* Top row: Status toggle and Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h4 className="text-base font-semibold text-slate-100 truncate">
              {model.display_name}
            </h4>
            {model.huggingface_repo_id && (
              <a
                href={`https://huggingface.co/${model.huggingface_repo_id}`}
                target="_blank"
                rel="noreferrer"
                className="text-slate-400 hover:text-brand-300 transition-colors"
                title="View Hugging Face Repository"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
          <p className="text-xs font-mono text-slate-400 truncate">
            {model.provider_model_id}
          </p>
        </div>

        {/* Enable / Disable toggle */}
        <label className="relative inline-flex items-center cursor-pointer select-none">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={model.enabled}
            onChange={(e) => onToggleEnabled(model.id, e.target.checked)}
          />
          <div className="w-10 h-5 bg-dark-750 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-600 peer-checked:after:bg-white" />
        </label>
      </div>

      {/* Badges: Location, Runtime Mode, License, Gated */}
      <div className="flex items-center gap-1.5 flex-wrap mb-4">
        <Badge
          variant={model.execution_location === 'local' ? 'info' : 'brand'}
          icon={model.execution_location === 'local' ? <Cpu className="w-3 h-3" /> : <Server className="w-3 h-3" />}
        >
          {model.execution_location.toUpperCase()}
        </Badge>

        <Badge variant="neutral">
          {getModeLabel(model.execution_mode)}
        </Badge>

        {model.license !== 'unknown' ? (
          <Badge variant="success" icon={<CheckCircle className="w-3 h-3" />}>
            {model.license}
          </Badge>
        ) : (
          <Badge variant="warning" icon={<HelpCircle className="w-3 h-3" />}>
            Unknown License
          </Badge>
        )}

        {model.gated_status !== 'none' && model.gated_status !== 'unknown' && (
          <Badge variant="warning" icon={<ShieldAlert className="w-3 h-3" />}>
            Gated ({model.gated_status})
          </Badge>
        )}

        <Badge variant="neutral">
          {Math.round(model.context_window / 1024)}k Context
        </Badge>

        {model.quantization && (
          <Badge variant="neutral">
            {model.quantization.toUpperCase()}
          </Badge>
        )}

        <Badge
          variant={model.evaluation_status === 'benchmarked' ? 'success' : 'neutral'}
          className="text-[10px]"
        >
          {model.evaluation_status === 'unbenchmarked' ? 'Unbenchmarked' : 'Benchmarked'}
        </Badge>
      </div>

      {/* Pricing info box */}
      <div className="p-2.5 rounded-lg bg-dark-850/80 border border-dark-800 text-xs mb-4 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-slate-300">
          <Coins className="w-3.5 h-3.5 text-brand-400" />
          <span>Pricing / 1M tokens:</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-slate-200">
          <span>In: <strong className="text-emerald-400">{formatPrice(model.input_price_per_million)}</strong></span>
          <span className="text-slate-600">|</span>
          <span>Out: <strong className="text-emerald-400">{formatPrice(model.output_price_per_million)}</strong></span>
          <span className="text-[10px] text-slate-400">({model.pricing_source})</span>
        </div>
      </div>

      {/* Assigned Routing Pools */}
      <div className="mb-4">
        <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1.5">
          <Layers className="w-3.5 h-3.5" />
          <span>Assigned Routing Pools:</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {assignedPools.length > 0 ? (
            assignedPools.map((p) => (
              <span
                key={p.id}
                className="px-2 py-0.5 rounded bg-brand-500/10 text-brand-300 border border-brand-500/20 text-xs font-medium"
              >
                {p.name}
              </span>
            ))
          ) : (
            <span className="text-xs text-slate-500 italic">No pools assigned</span>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between pt-3 border-t border-dark-800">
        <span className="text-[10px] text-slate-500">
          Added {new Date(model.created_at).toLocaleDateString()}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<Settings2 className="w-3.5 h-3.5" />}
            onClick={() => onEdit(model)}
          >
            Configure
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
            icon={<Trash2 className="w-3.5 h-3.5" />}
            onClick={() => onDelete(model.id)}
            title="Remove model from workspace (preserves usage history)"
          >
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
};
