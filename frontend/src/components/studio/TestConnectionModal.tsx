import React, { useState, useEffect } from 'react';
import {
  WorkspaceModel,
  ConnectionTestRequest,
  ConnectionTestResult,
  ConnectionTestStatus,
} from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { testModelConnection } from '../../services/api';
import {
  Activity,
  CheckCircle,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Clock,
  Lock,
  Eye,
  EyeOff,
  RotateCcw,
  Server,
  Cpu,
} from 'lucide-react';

interface TestConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  model: WorkspaceModel | null;
  onUpdateModelStatus: (
    modelId: string,
    status: ConnectionTestStatus,
    latencyMs: number | undefined,
    message: string
  ) => Promise<void>;
}

export const TestConnectionModal: React.FC<TestConnectionModalProps> = ({
  isOpen,
  onClose,
  model,
  onUpdateModelStatus,
}) => {
  const [transientKey, setTransientKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTransientKey('');
      setShowKey(false);
      setTestResult(null);
      setErrorBanner(null);
      setIsSaved(false);
    }
  }, [isOpen, model]);

  if (!model) return null;

  const requiresAuthPrompt =
    model.execution_mode === 'remote_openai_compatible' ||
    model.execution_mode === 'huggingface_inference_providers' ||
    model.execution_mode === 'huggingface_inference_endpoint';

  const handleRunTest = async () => {
    setIsLoading(true);
    setErrorBanner(null);
    setIsSaved(false);

    const payload: ConnectionTestRequest = {
      model_id: model.id,
      provider_type: model.provider_type,
      execution_mode: model.execution_mode,
      provider_model_id: model.provider_model_id,
      huggingface_repo_id: model.huggingface_repo_id,
      base_url: model.base_url,
      transient_credential: transientKey.trim() || undefined,
    };

    try {
      const result = await testModelConnection(payload);
      setTestResult(result);
      // Auto-save the diagnostic state to the model in IndexedDB
      await onUpdateModelStatus(
        model.id,
        result.status,
        result.latency_ms,
        result.diagnostic_message
      );
      setIsSaved(true);
    } catch (err: any) {
      setErrorBanner(err.message || 'Diagnostic connection probe failed to execute.');
    } finally {
      setIsLoading(false);
    }
  };

  const renderStatusBadge = (status: ConnectionTestStatus) => {
    switch (status) {
      case 'connected':
        return (
          <Badge variant="success" icon={<CheckCircle className="w-3.5 h-3.5" />}>
            Connected
          </Badge>
        );
      case 'authentication_failed':
        return (
          <Badge variant="danger" icon={<XCircle className="w-3.5 h-3.5" />}>
            Authentication Failed
          </Badge>
        );
      case 'unreachable':
        return (
          <Badge variant="danger" icon={<AlertTriangle className="w-3.5 h-3.5" />}>
            Endpoint Unreachable
          </Badge>
        );
      case 'inconclusive':
        return (
          <Badge variant="warning" icon={<HelpCircle className="w-3.5 h-3.5" />}>
            Inconclusive
          </Badge>
        );
      case 'configuration_error':
        return (
          <Badge variant="danger" icon={<XCircle className="w-3.5 h-3.5" />}>
            Configuration Error
          </Badge>
        );
      case 'unsupported':
        return <Badge variant="neutral">Unsupported Mode</Badge>;
      default:
        return <Badge variant="neutral">Untested</Badge>;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Model Connection & Diagnostic Test"
      subtitle={`Verify endpoint connectivity and credentials for ${model.display_name}`}
      maxWidth="lg"
    >
      <div className="space-y-4">
        {/* Model Spec Overview */}
        <div className="p-3.5 rounded-xl bg-dark-850/80 border border-dark-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Target Model:</span>
            <strong className="text-slate-200 font-mono">{model.provider_model_id}</strong>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Execution Mode:</span>
            <Badge variant="neutral" className="text-[10px]">
              {model.execution_mode}
            </Badge>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Execution Location:</span>
            <Badge
              variant={model.execution_location === 'local' ? 'info' : 'brand'}
              className="text-[10px]"
            >
              {model.execution_location === 'local' ? (
                <Cpu className="w-3 h-3 mr-1 inline" />
              ) : (
                <Server className="w-3 h-3 mr-1 inline" />
              )}
              {model.execution_location.toUpperCase()}
            </Badge>
          </div>
          {model.base_url && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Endpoint Base URL:</span>
              <span className="text-slate-300 font-mono text-[11px] truncate max-w-[280px]">
                {model.base_url}
              </span>
            </div>
          )}
        </div>

        {/* Transient Credential Input */}
        {requiresAuthPrompt ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300">
                Transient API Key / Token (Optional for Test):
              </label>
              <span className="text-[10px] text-brand-300 flex items-center gap-1">
                <Lock className="w-3 h-3" /> Transient Only
              </span>
            </div>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={transientKey}
                onChange={(e) => setTransientKey(e.target.value)}
                placeholder="Paste API key or HF token for this diagnostic test..."
                className="w-full px-3 py-2 pr-10 rounded-lg bg-dark-800 border border-dark-700 text-slate-100 text-xs font-mono focus:border-brand-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 flex items-start gap-1.5 leading-relaxed pt-0.5">
              <Lock className="w-3.5 h-3.5 text-brand-400 shrink-0 mt-0.5" />
              <span>
                <strong>Zero-Secret Guarantee:</strong> This credential is held strictly in volatile browser memory for this probe. It is never stored in IndexedDB, saved to disk, or printed in logs.
              </span>
            </p>
          </div>
        ) : (
          <div className="p-3 rounded-lg bg-dark-850 border border-dark-800 text-xs text-slate-400 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              Local runtimes (e.g. Ollama or vLLM) typically run without authentication on your local machine.
            </span>
          </div>
        )}

        {/* Action Button */}
        <div className="pt-2">
          <Button
            type="button"
            variant="primary"
            className="w-full"
            loading={isLoading}
            disabled={isLoading}
            icon={<Activity className="w-4 h-4" />}
            onClick={handleRunTest}
          >
            {isLoading ? 'Running Diagnostic Probe...' : 'Run Connection Test'}
          </Button>
        </div>

        {/* Error Banner */}
        {errorBanner && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <XCircle className="w-4 h-4 shrink-0" />
            <span>{errorBanner}</span>
          </div>
        )}

        {/* Structured Diagnostic Results Box */}
        {testResult && (
          <div className="p-4 rounded-xl bg-dark-850 border border-dark-750 space-y-3 animate-fadeIn">
            <div className="flex items-center justify-between pb-2 border-b border-dark-800">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-200">Diagnostic Result:</span>
                {renderStatusBadge(testResult.status)}
              </div>
              {testResult.latency_ms !== null && testResult.latency_ms !== undefined && (
                <span className="text-xs font-mono text-cyan-300 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {testResult.latency_ms} ms
                </span>
              )}
            </div>

            {/* Diagnostic Matrix */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded bg-dark-900 border border-dark-800">
                <span className="text-[10px] text-slate-400 block">Endpoint Reachable</span>
                <strong className={testResult.endpoint_reachable ? 'text-emerald-400' : 'text-rose-400'}>
                  {testResult.endpoint_reachable ? 'Yes (Responding)' : 'No (Unreachable)'}
                </strong>
              </div>

              <div className="p-2 rounded bg-dark-900 border border-dark-800">
                <span className="text-[10px] text-slate-400 block">Authentication Status</span>
                <strong
                  className={
                    testResult.auth_status === 'valid'
                      ? 'text-emerald-400'
                      : testResult.auth_status === 'invalid'
                      ? 'text-rose-400'
                      : 'text-slate-300'
                  }
                >
                  {testResult.auth_status ? testResult.auth_status.toUpperCase() : 'N/A'}
                </strong>
              </div>

              <div className="p-2 rounded bg-dark-900 border border-dark-800 col-span-2">
                <span className="text-[10px] text-slate-400 block">Inference Capability</span>
                <span className="text-slate-300 text-[11px]">
                  {testResult.inference_verified
                    ? 'Verified'
                    : 'Non-generative health/catalog check (Generation tested in M3.2)'}
                </span>
              </div>
            </div>

            {/* Message Details */}
            <div className="p-3 rounded-lg bg-dark-900 border border-dark-800 text-xs text-slate-300 leading-relaxed font-sans">
              {testResult.diagnostic_message}
            </div>

            {/* Saved Notification */}
            {isSaved && (
              <div className="text-[11px] text-emerald-400 flex items-center gap-1 pt-1">
                <CheckCircle className="w-3.5 h-3.5" />
                <span>Diagnostic state saved to workspace model.</span>
              </div>
            )}

            {/* Retry Button if failure */}
            {testResult.retryable && (
              <div className="pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                  onClick={handleRunTest}
                >
                  Retry Connection Test
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-dark-800">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
};
