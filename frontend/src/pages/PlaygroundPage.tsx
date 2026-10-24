import React, { useState, useEffect, useRef } from 'react';
import {
  Compass,
  Send,
  Sparkles,
  ArrowRight,
  Cpu,
  Square,
  Key,
  Eye,
  EyeOff,
  Trash2,
  Clock,
  Coins,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  Copy,
  Check,
  Sliders,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { workspaceRepo } from '../storage/indexeddb_repository';
import {
  WorkspaceModel,
  ChatMessage,
  GatewayChatRequest,
  StreamUsageEvent,
  StreamDoneEvent,
} from '../types';
import { streamChatCompletion } from '../services/api';

interface TelemetryState {
  latency_ms?: number;
  ttft_ms?: number | null;
  usage?: StreamUsageEvent;
  finish_reason?: string;
}

export const PlaygroundPage: React.FC = () => {
  const [models, setModels] = useState<WorkspaceModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // In-memory ephemeral session credential (never persisted to IndexedDB or localStorage)
  const [sessionToken, setSessionToken] = useState<string>('');
  const [showToken, setShowToken] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Model inference parameters
  const [temperature, setTemperature] = useState<number>(0.7);
  const [maxTokens, setMaxTokens] = useState<number>(2048);

  // Error and telemetry state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastTelemetry, setLastTelemetry] = useState<TelemetryState | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      const ms = await workspaceRepo.getWorkspaceModels();
      setModels(ms);
      const enabledModels = ms.filter((m) => m.enabled);
      if (enabledModels.length > 0) {
        setSelectedModelId(enabledModels[0].id);
      } else if (ms.length > 0) {
        setSelectedModelId(ms[0].id);
      }
    };
    load();
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isGenerating]);

  const selectedModel = models.find((m) => m.id === selectedModelId);

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleClearChat = () => {
    if (isGenerating && abortController) {
      abortController.abort();
    }
    setMessages([]);
    setErrorMessage(null);
    setLastTelemetry(null);
  };

  const handleStopGenerating = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsGenerating(false);
    }
  };

  const handleSendPrompt = async () => {
    if (!prompt.trim() || !selectedModel || isGenerating) return;

    if (!selectedModel.enabled) {
      setErrorMessage(`Model '${selectedModel.display_name}' is currently disabled in your workspace.`);
      return;
    }

    setErrorMessage(null);
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: prompt.trim(),
      timestamp: new Date().toLocaleTimeString(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setPrompt('');
    setIsGenerating(true);

    const assistantMsgId = `assistant-${Date.now()}`;
    const initialAssistantMessage: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString(),
    };

    setMessages([...newMessages, initialAssistantMessage]);

    const controller = new AbortController();
    setAbortController(controller);

    const gatewayReq: GatewayChatRequest = {
      model_id: selectedModel.id,
      model_display_name: selectedModel.display_name,
      provider_type: selectedModel.provider_type,
      execution_mode: selectedModel.execution_mode,
      execution_location: selectedModel.execution_location,
      provider_model_id: selectedModel.provider_model_id,
      base_url: selectedModel.base_url,
      huggingface_repo_id: selectedModel.huggingface_repo_id,
      messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
      temperature,
      max_tokens: maxTokens,
      stream: true,
      transient_credential: sessionToken.trim() || undefined,
      input_price_per_million: selectedModel.input_price_per_million,
      output_price_per_million: selectedModel.output_price_per_million,
      pricing_source: selectedModel.pricing_source,
    };

    let accumulatedText = '';
    let currentUsage: StreamUsageEvent | undefined;

    try {
      await streamChatCompletion(
        gatewayReq,
        {
          onToken: (chunk: string) => {
            accumulatedText += chunk;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, content: accumulatedText } : m
              )
            );
          },
          onUsage: (usage: StreamUsageEvent) => {
            currentUsage = usage;
            setLastTelemetry((prev) => ({ ...prev, usage }));
          },
          onDone: (done: StreamDoneEvent) => {
            setLastTelemetry({
              latency_ms: done.latency_ms,
              ttft_ms: done.ttft_ms,
              finish_reason: done.finish_reason,
              usage: currentUsage,
            });
            setIsGenerating(false);
            setAbortController(null);
          },
          onError: (err: string) => {
            setErrorMessage(err);
            setIsGenerating(false);
            setAbortController(null);
          },
        },
        controller.signal
      );
    } catch (err: any) {
      if (controller.signal.aborted) {
        setErrorMessage('Generation stopped by user.');
      } else {
        setErrorMessage(err?.message || 'Chat generation failed.');
      }
      setIsGenerating(false);
      setAbortController(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendPrompt();
    }
  };

  const requiresAuth =
    selectedModel?.execution_mode === 'huggingface_inference_providers' ||
    selectedModel?.execution_mode === 'huggingface_inference_endpoint' ||
    selectedModel?.execution_mode === 'remote_openai_compatible';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-dark-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
            <Compass className="w-6 h-6 text-brand-400" />
            Gateway Playground
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real LLM chat completions with Server-Sent Events streaming, usage auditing, and latency tracking.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {messages.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              onClick={handleClearChat}
              disabled={isGenerating}
            >
              New Chat
            </Button>
          )}
          <Link to="/studio">
            <Button size="sm" variant="secondary" icon={<Cpu className="w-3.5 h-3.5" />}>
              Model Studio ({models.length})
            </Button>
          </Link>
        </div>
      </div>

      {models.length === 0 ? (
        <div className="dev-card p-12 text-center border-dashed border-dark-750">
          <Cpu className="w-10 h-10 text-brand-400/80 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-100">No Models in Workspace</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto mt-1 mb-5">
            To start querying the gateway, add models from Hugging Face Hub or configure local runtimes in Model Studio.
          </p>
          <Link to="/studio">
            <Button size="md" variant="primary" icon={<ArrowRight className="w-4 h-4" />}>
              Configure Models in Studio
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Chat Interface */}
          <div className="lg:col-span-3 flex flex-col dev-card bg-dark-900/90 border border-dark-800 min-h-[620px] max-h-[820px]">
            {/* Model & Config bar */}
            <div className="p-3.5 border-b border-dark-800 flex flex-wrap items-center justify-between gap-3 bg-dark-850/60 rounded-t-xl">
              <div className="flex items-center gap-2.5 flex-1 min-w-[240px]">
                <Cpu className="w-4 h-4 text-brand-400 shrink-0" />
                <select
                  value={selectedModelId}
                  onChange={(e) => {
                    setSelectedModelId(e.target.value);
                    setErrorMessage(null);
                  }}
                  disabled={isGenerating}
                  className="bg-dark-800 border border-dark-700 text-xs text-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-brand-500 font-medium w-full sm:w-auto"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id} disabled={!m.enabled}>
                      {m.display_name} {!m.enabled ? '(Disabled)' : ''} — [{m.execution_location}]
                    </option>
                  ))}
                </select>

                {selectedModel && (
                  <Badge
                    variant={selectedModel.execution_location === 'local' ? 'info' : 'brand'}
                    className="hidden sm:inline-flex"
                  >
                    {selectedModel.execution_mode.replace(/_/g, ' ')}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Sliders className="w-3.5 h-3.5" />}
                  onClick={() => setShowSettings(!showSettings)}
                >
                  Params
                </Button>
              </div>
            </div>

            {/* Collapsible Parameters Bar */}
            {showSettings && (
              <div className="p-3 bg-dark-850/90 border-b border-dark-800 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="flex justify-between text-slate-400 mb-1">
                    <span>Temperature</span>
                    <span className="font-mono text-slate-200">{temperature}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="w-full accent-brand-500 bg-dark-750"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-slate-400 mb-1">
                    <span>Max Output Tokens</span>
                    <span className="font-mono text-slate-200">{maxTokens}</span>
                  </div>
                  <input
                    type="range"
                    min="128"
                    max="8192"
                    step="128"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                    className="w-full accent-brand-500 bg-dark-750"
                  />
                </div>
              </div>
            )}

            {/* Error Banner */}
            {errorMessage && (
              <div className="mx-4 mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold">Inference Notice</div>
                  <div className="mt-0.5 text-rose-200/90">{errorMessage}</div>
                </div>
              </div>
            )}

            {/* Message Thread */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400">
                  <Sparkles className="w-8 h-8 text-brand-400/60 mb-2.5" />
                  <p className="text-sm font-medium text-slate-200">Ready to chat with {selectedModel?.display_name || 'Model'}</p>
                  <p className="text-xs text-slate-400 max-w-sm mt-1">
                    Type a prompt below to initiate real-time streaming inference via the TokenPilot gateway.
                  </p>
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div
                    key={msg.id || idx}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div className="text-[10px] text-slate-400 mb-1 px-1 flex items-center gap-1.5">
                      <span>{msg.role === 'user' ? 'You' : selectedModel?.display_name || 'Assistant'}</span>
                      {msg.timestamp && <span>• {msg.timestamp}</span>}
                    </div>

                    <div
                      className={`relative group max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap font-sans ${
                        msg.role === 'user'
                          ? 'bg-brand-600 text-white rounded-tr-none'
                          : 'bg-dark-800/90 text-slate-100 border border-dark-750 rounded-tl-none font-mono'
                      }`}
                    >
                      {msg.content ? (
                        msg.content
                      ) : isGenerating && idx === messages.length - 1 ? (
                        <span className="flex items-center gap-1.5 text-slate-400 italic">
                          <span className="inline-block w-2 h-2 rounded-full bg-brand-400 animate-pulse" />
                          Streaming response...
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Empty response</span>
                      )}

                      {/* Copy action on assistant message */}
                      {msg.role === 'assistant' && msg.content && (
                        <button
                          onClick={() => handleCopy(msg.content, idx)}
                          title="Copy text"
                          className="absolute right-2 top-2 p-1 rounded hover:bg-dark-700 text-slate-400 hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          {copiedIndex === idx ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Prompt Input Area */}
            <div className="p-3 border-t border-dark-800 bg-dark-850/40 rounded-b-xl space-y-2">
              <div className="relative">
                <textarea
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Send a message to ${selectedModel?.display_name || 'model'}... (Shift+Enter for newline)`}
                  disabled={isGenerating || !selectedModel?.enabled}
                  className="w-full p-3 pr-24 rounded-xl bg-dark-850 border border-dark-700 text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-brand-500 resize-none font-mono leading-relaxed"
                />

                <div className="absolute right-3 bottom-4 flex items-center gap-2">
                  {isGenerating ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={handleStopGenerating}
                      icon={<Square className="w-3.5 h-3.5 fill-current" />}
                    >
                      Stop
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={handleSendPrompt}
                      disabled={!prompt.trim() || !selectedModel?.enabled}
                      icon={<Send className="w-3.5 h-3.5" />}
                    >
                      Dispatch
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Sidebar: Active Model Info & Transient Credential */}
          <div className="space-y-4">
            {/* Transient Session Credential Card */}
            <div className="dev-card p-4 space-y-3 bg-dark-900 border border-dark-800">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-brand-400" />
                  Session API Token
                </h4>
                {sessionToken && (
                  <button
                    onClick={() => setSessionToken('')}
                    title="Clear token from memory"
                    className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Clear
                  </button>
                )}
              </div>

              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={sessionToken}
                  onChange={(e) => setSessionToken(e.target.value)}
                  placeholder={
                    requiresAuth
                      ? 'Enter Bearer or Hugging Face token...'
                      : 'Optional for local endpoints'
                  }
                  className="w-full py-1.5 pl-2.5 pr-8 rounded-lg bg-dark-800 border border-dark-700 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-brand-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-2 text-slate-400 hover:text-slate-200"
                >
                  {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              <div className="p-2 rounded-lg bg-dark-850 border border-dark-750/60 text-[10px] text-slate-400 space-y-1">
                <div className="flex items-center gap-1 text-slate-300 font-medium">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  Zero-Secret Policy
                </div>
                <p>
                  Held in browser volatile session memory only. Never written to IndexedDB, localStorage, or logs. Cleared upon browser refresh.
                </p>
              </div>
            </div>

            {/* Model Details Card */}
            {selectedModel && (
              <div className="dev-card p-4 space-y-3 text-xs">
                <h4 className="font-semibold text-slate-200 flex items-center gap-1.5 border-b border-dark-800 pb-2">
                  <Cpu className="w-3.5 h-3.5 text-brand-400" />
                  Target Model Details
                </h4>

                <div className="space-y-2 text-slate-300">
                  <div>
                    <span className="text-slate-400 text-[11px] block">Model Identifier:</span>
                    <span className="font-mono text-slate-200 font-medium break-all">
                      {selectedModel.provider_model_id}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 text-[11px] block">Provider & Mode:</span>
                    <span className="text-slate-200 capitalize">
                      {selectedModel.provider_type} ({selectedModel.execution_mode.replace(/_/g, ' ')})
                    </span>
                  </div>

                  {selectedModel.base_url && (
                    <div>
                      <span className="text-slate-400 text-[11px] block">Configured Base URL:</span>
                      <span className="font-mono text-slate-200 text-[11px] break-all">
                        {selectedModel.base_url}
                      </span>
                    </div>
                  )}

                  <div>
                    <span className="text-slate-400 text-[11px] block">Context Limit:</span>
                    <span className="text-slate-200">
                      {selectedModel.context_window?.toLocaleString()} tokens
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 text-[11px] block">Configured Pricing:</span>
                    <span className="text-slate-200">
                      ${selectedModel.input_price_per_million} in / ${selectedModel.output_price_per_million} out (per 1M)
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Live Telemetry Panel */}
            {lastTelemetry && (
              <div className="dev-card p-4 space-y-2.5 text-xs bg-dark-900 border border-dark-800">
                <h4 className="font-semibold text-slate-200 flex items-center gap-1.5 border-b border-dark-800 pb-2">
                  <Clock className="w-3.5 h-3.5 text-brand-400" />
                  Latest Telemetry
                </h4>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Total Latency:</span>
                    <span className="font-mono text-slate-200 font-medium">
                      {lastTelemetry.latency_ms?.toFixed(1)} ms
                    </span>
                  </div>

                  {lastTelemetry.ttft_ms !== null && lastTelemetry.ttft_ms !== undefined && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Time to First Token:</span>
                      <span className="font-mono text-slate-200 font-medium">
                        {lastTelemetry.ttft_ms.toFixed(1)} ms
                      </span>
                    </div>
                  )}

                  {lastTelemetry.usage && (
                    <>
                      <div className="flex justify-between items-center pt-1 border-t border-dark-800">
                        <span className="text-slate-400">Prompt Tokens:</span>
                        <span className="font-mono text-slate-200">
                          {lastTelemetry.usage.prompt_tokens ?? '—'}
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Completion Tokens:</span>
                        <span className="font-mono text-slate-200">
                          {lastTelemetry.usage.completion_tokens ?? '—'}
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Total Tokens:</span>
                        <span className="font-mono text-slate-200 font-medium">
                          {lastTelemetry.usage.total_tokens ?? '—'}
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Provenance:</span>
                        <Badge
                          variant={
                            lastTelemetry.usage.provenance === 'provider_reported'
                              ? 'success'
                              : lastTelemetry.usage.provenance === 'estimated'
                              ? 'warning'
                              : 'neutral'
                          }
                        >
                          {lastTelemetry.usage.provenance}
                        </Badge>
                      </div>

                      {lastTelemetry.usage.estimated_cost_usd !== null &&
                        lastTelemetry.usage.estimated_cost_usd !== undefined && (
                          <div className="flex justify-between items-center pt-1 border-t border-dark-800 text-emerald-400">
                            <span className="flex items-center gap-1 font-medium">
                              <Coins className="w-3 h-3" /> Cost:
                            </span>
                            <span className="font-mono font-medium">
                              ${lastTelemetry.usage.estimated_cost_usd.toFixed(6)}
                            </span>
                          </div>
                        )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
