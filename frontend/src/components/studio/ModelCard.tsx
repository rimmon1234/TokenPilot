import React from 'react';
import {
  ExternalLink,
  Heart,
  Download,
  Plus,
  ShieldAlert,
  CheckCircle,
  HelpCircle,
  Sparkles,
  Server,
} from 'lucide-react';
import { HuggingFaceDiscoveredModel, ModelTemplate } from '../../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface ModelCardProps {
  model: HuggingFaceDiscoveredModel | ModelTemplate;
  isTemplate?: boolean;
  isAlreadyAdded?: boolean;
  onAdd: (model: HuggingFaceDiscoveredModel | ModelTemplate) => void;
}

export const ModelCard: React.FC<ModelCardProps> = ({
  model,
  isTemplate = false,
  isAlreadyAdded = false,
  onAdd,
}) => {
  const isHFDiscovered = 'repo_id' in model;
  const repoId = isHFDiscovered ? model.repo_id : model.huggingface_repo_id || model.provider_model_id;
  const displayName = isHFDiscovered ? model.name : model.display_name;
  const description = !isHFDiscovered ? model.description : undefined;
  const modelUrl = isHFDiscovered ? model.model_card_url : (model.huggingface_repo_id ? `https://huggingface.co/${model.huggingface_repo_id}` : undefined);
  const license = model.license;
  const gated = model.gated_status;
  const likes = isHFDiscovered ? model.likes : 0;
  const downloads = isHFDiscovered ? model.downloads : 0;
  const isChat = isHFDiscovered ? model.is_chat_verified : true;
  const isInfProvider = isHFDiscovered ? model.is_inference_provider_available : model.execution_mode === 'huggingface_inference_providers';
  const contextWindow = model.context_window;
  const paramsRaw = isHFDiscovered ? model.parameters_raw : undefined;
  const quant = model.quantization;

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toString();
  };

  return (
    <div className="dev-card p-4 flex flex-col justify-between h-full bg-dark-900/70 border-dark-750 hover:border-brand-500/40">
      <div>
        {/* Top Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h4 className="text-sm font-semibold text-slate-100 truncate">
                {displayName}
              </h4>
              {isTemplate && (
                <Badge variant="brand" className="text-[10px] py-0">
                  <Sparkles className="w-2.5 h-2.5 mr-0.5" /> Curated
                </Badge>
              )}
            </div>
            <p className="text-xs font-mono text-slate-400 truncate mt-0.5">
              {repoId}
            </p>
          </div>

          {modelUrl && (
            <a
              href={modelUrl}
              target="_blank"
              rel="noreferrer"
              className="p-1 rounded text-slate-400 hover:text-brand-300 transition-colors"
              title="Open Hugging Face Model Card"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {/* Description if template */}
        {description && (
          <p className="text-xs text-slate-400 line-clamp-2 mb-3">
            {description}
          </p>
        )}

        {/* Community Stats if Hugging Face search */}
        {isHFDiscovered && (
          <div className="flex items-center gap-3 text-xs text-slate-400 mb-3">
            <span className="flex items-center gap-1">
              <Heart className="w-3 h-3 text-rose-400/80" />
              {formatNumber(likes)}
            </span>
            <span className="flex items-center gap-1">
              <Download className="w-3 h-3 text-cyan-400/80" />
              {formatNumber(downloads)}
            </span>
          </div>
        )}

        {/* Metadata Badges */}
        <div className="flex items-center gap-1.5 flex-wrap mb-4">
          {/* License */}
          {license && license !== 'unknown' ? (
            <Badge variant="success" icon={<CheckCircle className="w-3 h-3" />}>
              {license}
            </Badge>
          ) : (
            <Badge variant="warning" icon={<HelpCircle className="w-3 h-3" />}>
              Unknown License
            </Badge>
          )}

          {/* Gated status */}
          {gated !== 'none' && gated !== 'unknown' && (
            <Badge variant="warning" icon={<ShieldAlert className="w-3 h-3" />}>
              Gated ({gated})
            </Badge>
          )}

          {/* Chat support */}
          {isChat && (
            <Badge variant="brand">
              Chat / Instruct
            </Badge>
          )}

          {/* Inference Provider ready */}
          {isInfProvider && (
            <Badge variant="info" icon={<Server className="w-3 h-3" />}>
              HF Serverless Ready
            </Badge>
          )}

          {/* Context window */}
          {contextWindow && (
            <Badge variant="neutral">
              {Math.round(contextWindow / 1024)}k Context
            </Badge>
          )}

          {paramsRaw && (
            <Badge variant="neutral">
              {paramsRaw}
            </Badge>
          )}

          {quant && (
            <Badge variant="neutral">
              {quant.toUpperCase()}
            </Badge>
          )}
        </div>
      </div>

      {/* Card Action */}
      <div className="pt-3 border-t border-dark-800 flex items-center justify-between">
        <span className="text-[11px] text-slate-500">
          {!isHFDiscovered && 'default_pool_hint' in model ? `Suggested: ${model.default_pool_hint}` : 'Hugging Face Hub'}
        </span>
        <Button
          size="sm"
          variant={isAlreadyAdded ? 'secondary' : 'primary'}
          icon={<Plus className="w-3.5 h-3.5" />}
          onClick={() => onAdd(model)}
        >
          {isAlreadyAdded ? 'Add Another Instance' : 'Add to Workspace'}
        </Button>
      </div>
    </div>
  );
};
