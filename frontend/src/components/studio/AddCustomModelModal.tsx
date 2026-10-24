import React, { useState } from 'react';
import { WorkspaceModel, RoutingPool, ExecutionMode, ExecutionLocation } from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Cpu, Server, Sparkles, Terminal, ShieldAlert, Lock, Layers } from 'lucide-react';
import { validateModelConfig } from '../../services/api';

interface AddCustomModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  allPools: RoutingPool[];
  onSave: (model: WorkspaceModel) => Promise<void>;
}

export const AddCustomModelModal: React.FC<AddCustomModelModalProps> = ({
  isOpen,
  onClose,
  allPools,
  onSave,
}) => {
  const [displayName, setDisplayName] = useState('');
  const [providerModelId, setProviderModelId] = useState('');
  const [providerType, setProviderType] = useState('ollama');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('local_openai_compatible');
  const [executionLocation, setExecutionLocation] = useState<ExecutionLocation>('local');
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434/v1');
  const [contextWindow, setContextWindow] = useState(8192);
  const [inputPrice, setInputPrice] = useState(0.0);
  const [outputPrice, setOutputPrice] = useState(0.0);
  const [pricingSource, setPricingSource] = useState('free_local_hardware');
  const [license, setLicense] = useState('custom/unknown');
  const [selectedPoolIds, setSelectedPoolIds] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Apply quick presets
  const applyPreset = (preset: 'ollama' | 'vllm' | 'remote' | 'hf_endpoint') => {
    if (preset === 'ollama') {
      setDisplayName('Local Ollama Model');
      setProviderModelId('llama3.2:3b');
      setProviderType('ollama');
      setExecutionMode('local_openai_compatible');
      setExecutionLocation('local');
      setBaseUrl('http://localhost:11434/v1');
      setInputPrice(0.0);
      setOutputPrice(0.0);
      setPricingSource('free_local_hardware');
      setContextWindow(131072);
      setLicense('llama3.2');
    } else if (preset === 'vllm') {
      setDisplayName('Local vLLM Server');
      setProviderModelId('meta-llama/Llama-3.1-8B-Instruct');
      setProviderType('vllm');
      setExecutionMode('local_openai_compatible');
      setExecutionLocation('local');
      setBaseUrl('http://localhost:8000/v1');
      setInputPrice(0.0);
      setOutputPrice(0.0);
      setPricingSource('free_local_hardware');
      setContextWindow(32768);
      setLicense('llama3.1');
    } else if (preset === 'remote') {
      setDisplayName('Remote OpenAI Compatible');
      setProviderModelId('deepseek-chat');
      setProviderType('deepseek');
      setExecutionMode('remote_openai_compatible');
      setExecutionLocation('remote');
      setBaseUrl('https://api.deepseek.com/v1');
      setInputPrice(0.14);
      setOutputPrice(0.28);
      setPricingSource('official_docs');
      setContextWindow(65536);
      setLicense('commercial');
    } else if (preset === 'hf_endpoint') {
      setDisplayName('Private HF Dedicated Endpoint');
      setProviderModelId('custom-qwen-endpoint');
      setProviderType('huggingface');
      setExecutionMode('huggingface_inference_endpoint');
      setExecutionLocation('remote');
      setBaseUrl('https://xyz.endpoints.huggingface.cloud');
      setInputPrice(0.20);
      setOutputPrice(0.20);
      setPricingSource('endpoint_hourly_allocated');
      setContextWindow(32768);
      setLicense('custom');
    }
  };

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
    const modelId = `custom-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const newModel: WorkspaceModel = {
      id: modelId,
      display_name: displayName.trim(),
      source_type: 'custom',
      provider_type: providerType,
      execution_mode: executionMode,
      execution_location: executionLocation,
      provider_model_id: providerModelId.trim(),
      base_url: baseUrl.trim() || undefined,
      license: license.trim() || 'unknown',
      gated_status: 'none',
      capabilities: {
        supports_tools: true,
        supports_vision: false,
        supports_streaming: true,
        supports_json_mode: true,
      },
      context_window: Number(contextWindow) || 8192,
      input_price_per_million: Number(inputPrice) || 0.0,
      output_price_per_million: Number(outputPrice) || 0.0,
      pricing_source: pricingSource,
      pricing_verified_at: now,
      enabled: true,
      evaluation_status: 'unbenchmarked',
      assigned_pool_ids: selectedPoolIds.length > 0 ? selectedPoolIds : (allPools[0] ? [allPools[0].id] : []),
      created_at: now,
      updated_at: now,
    };

    const validation = await validateModelConfig(newModel);
    if (!validation.valid) {
      setErrorMessage(validation.message);
      setIsSubmitting(false);
      return;
    }

    try {
      await onSave(newModel);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save custom model.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Custom Model or Inference Server"
      subtitle="Connect a local Ollama/vLLM instance, private HF endpoint, or OpenAI-compatible provider."
      maxWidth="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMessage && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Quick Presets */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-2">
            Quick Architecture Presets:
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => applyPreset('ollama')}
              className="p-2.5 rounded-lg border border-dark-700 bg-dark-850 hover:bg-dark-800 text-left transition-colors flex flex-col gap-1"
            >
              <span className="text-xs font-semibold text-cyan-300 flex items-center gap-1">
                <Terminal className="w-3 h-3" /> Ollama Local
              </span>
              <span className="text-[10px] text-slate-400">Port 11434, Free</span>
            </button>

            <button
              type="button"
              onClick={() => applyPreset('vllm')}
              className="p-2.5 rounded-lg border border-dark-700 bg-dark-850 hover:bg-dark-800 text-left transition-colors flex flex-col gap-1"
            >
              <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1">
                <Cpu className="w-3 h-3" /> vLLM Local
              </span>
              <span className="text-[10px] text-slate-400">High throughput</span>
            </button>

            <button
              type="button"
              onClick={() => applyPreset('remote')}
              className="p-2.5 rounded-lg border border-dark-700 bg-dark-850 hover:bg-dark-800 text-left transition-colors flex flex-col gap-1"
            >
              <span className="text-xs font-semibold text-brand-300 flex items-center gap-1">
                <Server className="w-3 h-3" /> Remote API
              </span>
              <span className="text-[10px] text-slate-400">OpenAI compatible</span>
            </button>

            <button
              type="button"
              onClick={() => applyPreset('hf_endpoint')}
              className="p-2.5 rounded-lg border border-dark-700 bg-dark-850 hover:bg-dark-800 text-left transition-colors flex flex-col gap-1"
            >
              <span className="text-xs font-semibold text-amber-300 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Dedicated HF
              </span>
              <span className="text-[10px] text-slate-400">Private endpoint</span>
            </button>
          </div>
        </div>

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
              placeholder="e.g. Local Llama 3.2 3B"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Runtime Model ID / Tag *
            </label>
            <input
              type="text"
              required
              value={providerModelId}
              onChange={(e) => setProviderModelId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-slate-100 text-sm font-mono focus:border-brand-500 focus:outline-none"
              placeholder="e.g. llama3.2:3b"
            />
          </div>
        </div>

        {/* Execution Mode & Location */}
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
              <option value="local_openai_compatible">Local OpenAI Compatible (Ollama / vLLM / LM Studio)</option>
              <option value="remote_openai_compatible">Remote OpenAI Compatible API</option>
              <option value="huggingface_inference_endpoint">Hugging Face Dedicated Endpoint</option>
              <option value="huggingface_inference_providers">Hugging Face Inference Providers</option>
              <option value="huggingface_local_transformers">Hugging Face Local Transformers</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Execution Location
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setExecutionLocation('local')}
                className={`py-2 px-3 text-xs rounded-lg font-medium border text-center transition-all ${
                  executionLocation === 'local'
                    ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                    : 'bg-dark-800 border-dark-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                Local Hardware
              </button>
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
            </div>
          </div>
        </div>

        {/* Base URL */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Endpoint Base URL
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-slate-100 text-xs font-mono focus:border-brand-500 focus:outline-none"
            placeholder="http://localhost:11434/v1"
          />
        </div>

        {/* Pricing Inputs */}
        <div className="p-3 rounded-xl bg-dark-850 border border-dark-800 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Input Price / 1M ($)</label>
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
            <label className="block text-[11px] text-slate-400 mb-1">Output Price / 1M ($)</label>
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
            <label className="block text-[11px] text-slate-400 mb-1">Context Window</label>
            <input
              type="number"
              min={512}
              step={1024}
              value={contextWindow}
              onChange={(e) => setContextWindow(parseInt(e.target.value) || 8192)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-dark-900 border border-dark-700 text-slate-100 text-xs font-mono focus:border-brand-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Routing Pool Assignment */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-brand-400" />
            Assign to Routing Pools:
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

        {/* Security Notice */}
        <div className="p-3 rounded-lg bg-dark-850 border border-dark-800 text-[11px] text-slate-400 flex items-start gap-2">
          <Lock className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
          <span>
            No secret API keys are saved on disk or in browser storage. Local servers like Ollama require no credentials.
          </span>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-dark-800">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            Save Custom Model
          </Button>
        </div>
      </form>
    </Modal>
  );
};
