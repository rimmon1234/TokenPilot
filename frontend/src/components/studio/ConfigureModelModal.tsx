import React, { useState, useEffect } from 'react';
import {
  WorkspaceModel,
  RoutingPool,
  ExecutionMode,
  ExecutionLocation,
  HuggingFaceDiscoveredModel,
  ModelTemplate,
} from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ShieldAlert, Layers, Lock } from 'lucide-react';
import { validateModelConfig } from '../../services/api';

interface ConfigureModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialModel?: WorkspaceModel | HuggingFaceDiscoveredModel | ModelTemplate | null;
  isEditingExisting?: boolean;
  allPools: RoutingPool[];
  onSave: (model: WorkspaceModel) => Promise<void>;
}

export const ConfigureModelModal: React.FC<ConfigureModelModalProps> = ({
  isOpen,
  onClose,
  initialModel,
  isEditingExisting = false,
  allPools,
  onSave,
}) => {
  const [displayName, setDisplayName] = useState('');
  const [providerModelId, setProviderModelId] = useState('');
  const [hfRepoId, setHfRepoId] = useState('');
  const [providerType, setProviderType] = useState('huggingface');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('huggingface_inference_providers');
  const [executionLocation, setExecutionLocation] = useState<ExecutionLocation>('remote');
  const [baseUrl, setBaseUrl] = useState('');
  const [license, setLicense] = useState('unknown');
  const [gatedStatus, setGatedStatus] = useState<'none' | 'auto' | 'manual' | 'unknown'>('none');
  const [contextWindow, setContextWindow] = useState(8192);
  const [quantization, setQuantization] = useState('');
  const [inputPrice, setInputPrice] = useState(0.0);
  const [outputPrice, setOutputPrice] = useState(0.0);
  const [pricingSource, setPricingSource] = useState('user_configured');
  const [selectedPoolIds, setSelectedPoolIds] = useState<string[]>([]);
  const [supportsTools, setSupportsTools] = useState(false);
  const [supportsVision, setSupportsVision] = useState(false);
  const [supportsStreaming, setSupportsStreaming] = useState(true);
  const [supportsJsonMode, setSupportsJsonMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!initialModel) return;

    if ('created_at' in initialModel) {
      // It's an existing WorkspaceModel
      const m = initialModel as WorkspaceModel;
      setDisplayName(m.display_name);
      setProviderModelId(m.provider_model_id);
      setHfRepoId(m.huggingface_repo_id || '');
      setProviderType(m.provider_type);
      setExecutionMode(m.execution_mode);
      setExecutionLocation(m.execution_location);
      setBaseUrl(m.base_url || '');
      setLicense(m.license);
      setGatedStatus(m.gated_status);
      setContextWindow(m.context_window);
      setQuantization(m.quantization || '');
      setInputPrice(m.input_price_per_million);
      setOutputPrice(m.output_price_per_million);
      setPricingSource(m.pricing_source);
      setSelectedPoolIds(m.assigned_pool_ids || []);
      setSupportsTools(m.capabilities.supports_tools);
      setSupportsVision(m.capabilities.supports_vision);
      setSupportsStreaming(m.capabilities.supports_streaming);
      setSupportsJsonMode(m.capabilities.supports_json_mode);
    } else if ('repo_id' in initialModel) {
      // It's a discovered HuggingFaceDiscoveredModel
      const m = initialModel as HuggingFaceDiscoveredModel;
      setDisplayName(m.name);
      setProviderModelId(m.repo_id);
      setHfRepoId(m.repo_id);
      setProviderType('huggingface');
      setExecutionMode(m.suggested_execution_mode);
      setExecutionLocation(m.suggested_location);
      setBaseUrl('');
      setLicense(m.license || 'unknown');
      setGatedStatus(m.gated_status);
      setContextWindow(m.context_window || 8192);
      setQuantization(m.quantization || '');
      setInputPrice(0.15); // Average suggested or user override
      setOutputPrice(0.20);
      setPricingSource('suggested_default');
      // Assign default pool
      const defaultPool = allPools.find((p) => p.is_default) || allPools[0];
      setSelectedPoolIds(defaultPool ? [defaultPool.id] : []);
      setSupportsTools(false);
      setSupportsVision(false);
      setSupportsStreaming(true);
      setSupportsJsonMode(false);
    } else {
      // It's a ModelTemplate
      const m = initialModel as ModelTemplate;
      setDisplayName(m.display_name);
      setProviderModelId(m.provider_model_id);
      setHfRepoId(m.huggingface_repo_id || '');
      setProviderType(m.provider_type);
      setExecutionMode(m.execution_mode);
      setExecutionLocation(m.execution_location);
      setBaseUrl(m.base_url || '');
      setLicense(m.license);
      setGatedStatus(m.gated_status);
      setContextWindow(m.context_window);
      setQuantization(m.quantization || '');
      setInputPrice(m.input_price_per_million);
      setOutputPrice(m.output_price_per_million);
      setPricingSource(m.pricing_source);
      // Find pool matching template hint
      const matchingPool = allPools.find((p) => p.name.toLowerCase() === m.default_pool_hint?.toLowerCase()) || allPools[0];
      setSelectedPoolIds(matchingPool ? [matchingPool.id] : []);
      setSupportsTools(m.capabilities.supports_tools);
      setSupportsVision(m.capabilities.supports_vision);
      setSupportsStreaming(m.capabilities.supports_streaming);
      setSupportsJsonMode(m.capabilities.supports_json_mode);
    }
    setErrorMessage(null);
  }, [initialModel, allPools, isOpen]);

  const togglePool = (poolId: string) => {
    setSelectedPoolIds((prev) =>
      prev.includes(poolId) ? prev.filter((id) => id !== poolId) : [...prev, poolId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || !providerModelId.trim()) {
      setErrorMessage('Display Name and Provider Model ID are required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const now = new Date().toISOString();
    const existingId = initialModel && 'id' in initialModel ? (initialModel as WorkspaceModel).id : undefined;
    const modelId = existingId || `model-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const modelToSave: WorkspaceModel = {
      id: modelId,
      display_name: displayName.trim(),
      source_type: hfRepoId ? 'huggingface_hub' : 'custom',
      provider_type: providerType,
      execution_mode: executionMode,
      execution_location: executionLocation,
      provider_model_id: providerModelId.trim(),
      huggingface_repo_id: hfRepoId.trim() || undefined,
      base_url: baseUrl.trim() || undefined,
      license: license.trim() || 'unknown',
      gated_status: gatedStatus,
      capabilities: {
        supports_tools: supportsTools,
        supports_vision: supportsVision,
        supports_streaming: supportsStreaming,
        supports_json_mode: supportsJsonMode,
      },
      context_window: Number(contextWindow) || 8192,
      quantization: quantization.trim() || undefined,
      input_price_per_million: Number(inputPrice) || 0.0,
      output_price_per_million: Number(outputPrice) || 0.0,
      pricing_source: pricingSource,
      pricing_verified_at: now,
      enabled: true,
      evaluation_status: isEditingExisting && initialModel && 'evaluation_status' in initialModel ? (initialModel as WorkspaceModel).evaluation_status : 'unbenchmarked',
      assigned_pool_ids: selectedPoolIds,
      created_at: isEditingExisting && initialModel && 'created_at' in initialModel ? (initialModel as WorkspaceModel).created_at : now,
      updated_at: now,
    };

    // Client/Server validation
    const validation = await validateModelConfig(modelToSave);
    if (!validation.valid) {
      setErrorMessage(validation.message);
      setIsSubmitting(false);
      return;
    }

    try {
      await onSave(modelToSave);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save model configuration.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditingExisting ? 'Configure Workspace Model' : 'Add Model to Workspace'}
      subtitle="Customize runtime parameters, token pricing, and routing pool membership."
      maxWidth="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMessage && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Display Name & Provider Model ID */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Display Name *
            </label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-slate-100 text-sm focus:border-brand-500 focus:outline-none"
              placeholder="e.g. Qwen 2.5 Coder 7B"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Provider Model ID *
            </label>
            <input
              type="text"
              required
              value={providerModelId}
              onChange={(e) => setProviderModelId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-slate-100 text-sm font-mono focus:border-brand-500 focus:outline-none"
              placeholder="e.g. Qwen/Qwen2.5-Coder-7B-Instruct"
            />
          </div>
        </div>

        {/* Execution Mode & Location (Decoupled!) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Execution Runtime Mode
            </label>
            <select
              value={executionMode}
              onChange={(e) => setExecutionMode(e.target.value as ExecutionMode)}
              className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-slate-100 text-xs focus:border-brand-500 focus:outline-none"
            >
              <option value="huggingface_inference_providers">Hugging Face Inference Providers</option>
              <option value="huggingface_inference_endpoint">Hugging Face Dedicated Endpoint</option>
              <option value="huggingface_local_transformers">Hugging Face Local Transformers</option>
              <option value="local_openai_compatible">Local OpenAI Compatible (Ollama / vLLM)</option>
              <option value="remote_openai_compatible">Remote OpenAI Compatible</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Execution Location (Locality)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setExecutionLocation('remote')}
                className={`py-2 px-3 text-xs rounded-lg font-medium border text-center transition-all ${
                  executionLocation === 'remote'
                    ? 'bg-brand-500/20 border-brand-500 text-brand-300'
                    : 'bg-dark-800 border-dark-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                Remote Cloud
              </button>
              <button
                type="button"
                onClick={() => setExecutionLocation('local')}
                className={`py-2 px-3 text-xs rounded-lg font-medium border text-center transition-all ${
                  executionLocation === 'local'
                    ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                    : 'bg-dark-800 border-dark-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                Local Machine
              </button>
            </div>
          </div>
        </div>

        {/* Base URL (for endpoints or Ollama) */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Endpoint Base URL (Optional)
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-slate-100 text-xs font-mono focus:border-brand-500 focus:outline-none"
            placeholder="e.g. http://localhost:11434/v1 or https://xyz.endpoints.huggingface.cloud"
          />
        </div>

        {/* Context Window & Quantization & License */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Context Window (tokens)
            </label>
            <input
              type="number"
              min={512}
              step={1024}
              value={contextWindow}
              onChange={(e) => setContextWindow(parseInt(e.target.value) || 8192)}
              className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-slate-100 text-xs font-mono focus:border-brand-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Quantization
            </label>
            <input
              type="text"
              value={quantization}
              onChange={(e) => setQuantization(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-slate-100 text-xs focus:border-brand-500 focus:outline-none"
              placeholder="e.g. 4bit, gguf, none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              License
            </label>
            <input
              type="text"
              value={license}
              onChange={(e) => setLicense(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-slate-100 text-xs focus:border-brand-500 focus:outline-none"
              placeholder="e.g. apache-2.0, mit"
            />
          </div>
        </div>

        {/* Pricing Configuration */}
        <div className="p-3 rounded-xl bg-dark-850 border border-dark-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">
              Token Pricing (USD per 1 Million Tokens)
            </span>
            <span className="text-[10px] text-slate-400">Set 0 for local hardware / free tier</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Input Price / 1M</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={inputPrice}
                onChange={(e) => setInputPrice(parseFloat(e.target.value) || 0.0)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-dark-900 border border-dark-700 text-slate-100 text-xs font-mono focus:border-brand-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Output Price / 1M</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={outputPrice}
                onChange={(e) => setOutputPrice(parseFloat(e.target.value) || 0.0)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-dark-900 border border-dark-700 text-slate-100 text-xs font-mono focus:border-brand-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Pricing Source</label>
              <input
                type="text"
                value={pricingSource}
                onChange={(e) => setPricingSource(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-dark-900 border border-dark-700 text-slate-100 text-xs focus:border-brand-500 focus:outline-none"
                placeholder="e.g. official_docs"
              />
            </div>
          </div>
        </div>

        {/* Routing Pool Membership */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-brand-400" />
            Assign to Routing Pools (Multi-Select)
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            {allPools.map((pool) => {
              const isSelected = selectedPoolIds.includes(pool.id);
              return (
                <button
                  type="button"
                  key={pool.id}
                  onClick={() => togglePool(pool.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    isSelected
                      ? 'bg-brand-500/20 border-brand-500 text-brand-300'
                      : 'bg-dark-800 border-dark-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {pool.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Capabilities Checkboxes */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
          <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={supportsStreaming}
              onChange={(e) => setSupportsStreaming(e.target.checked)}
              className="rounded bg-dark-800 border-dark-700 text-brand-600 focus:ring-0"
            />
            Streaming
          </label>
          <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={supportsTools}
              onChange={(e) => setSupportsTools(e.target.checked)}
              className="rounded bg-dark-800 border-dark-700 text-brand-600 focus:ring-0"
            />
            Tools / Functions
          </label>
          <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={supportsJsonMode}
              onChange={(e) => setSupportsJsonMode(e.target.checked)}
              className="rounded bg-dark-800 border-dark-700 text-brand-600 focus:ring-0"
            />
            JSON Mode
          </label>
          <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={supportsVision}
              onChange={(e) => setSupportsVision(e.target.checked)}
              className="rounded bg-dark-800 border-dark-700 text-brand-600 focus:ring-0"
            />
            Vision
          </label>
        </div>

        {/* Zero-Secret Notice */}
        <div className="p-3 rounded-lg bg-dark-850 border border-dark-800 text-[11px] text-slate-400 flex items-start gap-2">
          <Lock className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
          <span>
            <strong>Zero-Secret Policy:</strong> TokenPilot stores this model configuration in local IndexedDB. Upstream credentials are never serialized into model configurations or committed to disk.
          </span>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-dark-800">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            {isEditingExisting ? 'Save Changes' : 'Add to Workspace'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
