import React, { useState, useEffect, useRef } from 'react';
import {
  FlaskConical,
  Database,
  Download,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Code,
  Calculator,
  Trash2,
  Eye,
  RefreshCw,
  ShieldCheck,
  X,
  Search,
  ChevronRight,
  Info,
  Play,
  Square,
  Cpu,
  Clock,
  Coins,
  Check,
} from 'lucide-react';
import {
  DatasetTemplate,
  DatasetManifest,
  DatasetRecord,
  DatasetEvaluationRole,
  WorkspaceModel,
  BenchmarkRun,
  BenchmarkResult,
  BenchmarkModelConfig,
} from '../types';
import {
  fetchDatasetTemplates,
  fetchImportedDatasets,
  fetchDatasetRecords,
  importDataset,
  deleteImportedDataset,
} from '../services/dataset_service';
import {
  createBenchmarkRun,
  fetchBenchmarkRuns,
  fetchBenchmarkRun,
  fetchBenchmarkResults,
  cancelBenchmarkRun,
} from '../services/benchmark_service';
import { workspaceRepo } from '../storage/indexeddb_repository';

export const BenchmarkLabPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'templates' | 'imported' | 'runs'>('templates');
  const [templates, setTemplates] = useState<DatasetTemplate[]>([]);
  const [importedDatasets, setImportedDatasets] = useState<DatasetManifest[]>([]);
  const [benchmarkRuns, setBenchmarkRuns] = useState<BenchmarkRun[]>([]);
  const [workspaceModels, setWorkspaceModels] = useState<WorkspaceModel[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Template Import Configuration states (per template id)
  const [importConfig, setImportConfig] = useState<
    Record<
      string,
      {
        split: string;
        role: DatasetEvaluationRole;
        subsetSize: number | null;
        seed: number;
        importing: boolean;
        error: string | null;
      }
    >
  >({});

  // Modals state
  const [samplePreviewTemplate, setSamplePreviewTemplate] = useState<DatasetTemplate | null>(null);
  const [recordsModalManifest, setRecordsModalManifest] = useState<DatasetManifest | null>(null);
  const [recordsModalData, setRecordsModalData] = useState<DatasetRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState<boolean>(false);
  const [recordFilterText, setRecordFilterText] = useState<string>('');

  // Benchmark Run Modal state
  const [runModalOpen, setRunModalOpen] = useState<boolean>(false);
  const [runModalDatasetId, setRunModalDatasetId] = useState<string>('');
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [runSubsetSize, setRunSubsetSize] = useState<number | null>(5);
  const [runTemperature, setRunTemperature] = useState<number>(0.0);
  const [runTransientHfToken, setRunTransientHfToken] = useState<string>('');
  const [runStarting, setRunStarting] = useState<boolean>(false);
  const [runModalError, setRunModalError] = useState<string | null>(null);

  // Active Running Progress & Polling
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<BenchmarkRun | null>(null);
  const pollingRef = useRef<any>(null);

  // Results Modal State
  const [resultsModalRun, setResultsModalRun] = useState<BenchmarkRun | null>(null);
  const [resultsModalData, setResultsModalData] = useState<BenchmarkResult[]>([]);
  const [resultsLoading, setResultsLoading] = useState<boolean>(false);
  const [resultsFilterText, setResultsFilterText] = useState<string>('');

  const loadData = async () => {
    setLoading(true);
    setErrorBanner(null);
    try {
      const [tmplData, importedData, runsData, modelsData] = await Promise.all([
        fetchDatasetTemplates(),
        fetchImportedDatasets(),
        fetchBenchmarkRuns(),
        workspaceRepo.getWorkspaceModels(),
      ]);
      setTemplates(tmplData);
      setImportedDatasets(importedData);
      setBenchmarkRuns(runsData);
      setWorkspaceModels(modelsData);

      // Check for in-flight running runs to resume polling
      const runningRun = runsData.find((r) => r.status === 'running' || r.status === 'pending');
      if (runningRun) {
        setActiveRunId(runningRun.id);
        setActiveRun(runningRun);
      }

      // Initialize config states for templates
      const initialConfig: typeof importConfig = {};
      for (const t of tmplData) {
        const defaultSplit = t.available_splits[0] || 'test';
        const allowedRoles = t.allowed_roles_per_split[defaultSplit] || ['held_out_test'];
        initialConfig[t.id] = {
          split: defaultSplit,
          role: allowedRoles[0] || 'held_out_test',
          subsetSize: t.recommended_subsets[0] || 10,
          seed: 42,
          importing: false,
          error: null,
        };
      }
      setImportConfig(initialConfig);
    } catch (err: any) {
      setErrorBanner(err.message || 'Failed to load benchmark lab.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // Polling effect for active run
  useEffect(() => {
    if (!activeRunId) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return;
    }

    const poll = async () => {
      try {
        const run = await fetchBenchmarkRun(activeRunId);
        if (!run) return;
        setActiveRun(run);
        setBenchmarkRuns((prev) => prev.map((r) => (r.id === run.id ? run : r)));

        if (run.status !== 'pending' && run.status !== 'running') {
          // Terminal state reached
          if (pollingRef.current) clearInterval(pollingRef.current);
          setActiveRunId(null);
          if (run.status === 'completed') {
            setSuccessBanner(`Benchmark run '${run.id}' completed successfully!`);
          } else if (run.status === 'completed_with_errors') {
            setSuccessBanner(`Benchmark run '${run.id}' completed with some failed evaluations.`);
          }
        }
      } catch (err) {
        console.warn('Error polling benchmark run:', err);
      }
    };

    poll();
    pollingRef.current = setInterval(poll, 1500);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeRunId]);

  const handleSplitChange = (templateId: string, newSplit: string) => {
    const tmpl = templates.find((t) => t.id === templateId);
    if (!tmpl) return;

    const allowedRoles = tmpl.allowed_roles_per_split[newSplit] || ['held_out_test'];
    setImportConfig((prev) => ({
      ...prev,
      [templateId]: {
        ...prev[templateId],
        split: newSplit,
        role: allowedRoles[0] || 'held_out_test',
        error: null,
      },
    }));
  };

  const handleRoleChange = (templateId: string, newRole: DatasetEvaluationRole) => {
    setImportConfig((prev) => ({
      ...prev,
      [templateId]: {
        ...prev[templateId],
        role: newRole,
        error: null,
      },
    }));
  };

  const handleSubsetChange = (templateId: string, size: number | null) => {
    setImportConfig((prev) => ({
      ...prev,
      [templateId]: {
        ...prev[templateId],
        subsetSize: size,
        error: null,
      },
    }));
  };

  const handleExecuteImport = async (templateId: string) => {
    const cfg = importConfig[templateId];
    if (!cfg) return;

    setImportConfig((prev) => ({
      ...prev,
      [templateId]: { ...prev[templateId], importing: true, error: null },
    }));
    setErrorBanner(null);
    setSuccessBanner(null);

    try {
      const manifest = await importDataset({
        dataset_id: templateId,
        split: cfg.split,
        evaluation_role: cfg.role,
        subset_size: cfg.subsetSize,
        seed: cfg.seed,
      });

      setSuccessBanner(
        `Successfully imported ${manifest.imported_record_count} records from ${manifest.dataset_name} (${manifest.source_split} split).`
      );

      const updated = await fetchImportedDatasets();
      setImportedDatasets(updated);
      setActiveTab('imported');
    } catch (err: any) {
      setImportConfig((prev) => ({
        ...prev,
        [templateId]: { ...prev[templateId], error: err.message || 'Import failed.' },
      }));
    } finally {
      setImportConfig((prev) => ({
        ...prev,
        [templateId]: { ...prev[templateId], importing: false },
      }));
    }
  };

  const handleDeleteManifest = async (manifestId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete imported dataset '${name}'?`)) {
      return;
    }

    try {
      await deleteImportedDataset(manifestId);
      setSuccessBanner(`Deleted dataset '${name}'.`);
      setImportedDatasets((prev) => prev.filter((m) => m.manifest_id !== manifestId));
    } catch (err: any) {
      setErrorBanner(`Failed to delete dataset: ${err.message}`);
    }
  };

  const handleOpenRecordsModal = async (manifest: DatasetManifest) => {
    setRecordsModalManifest(manifest);
    setRecordsLoading(true);
    setRecordFilterText('');
    try {
      const records = await fetchDatasetRecords(manifest.manifest_id, 100, 0);
      setRecordsModalData(records);
    } catch (err: any) {
      setErrorBanner(`Failed to load dataset records: ${err.message}`);
    } finally {
      setRecordsLoading(false);
    }
  };

  // Open Benchmark Run Modal
  const handleOpenRunModal = (datasetManifestId?: string) => {
    const defaultDs = datasetManifestId || (importedDatasets.find((d) => d.task_type === 'math_reasoning')?.manifest_id || '');
    setRunModalDatasetId(defaultDs);

    // Preselect enabled models by default
    const enabled = workspaceModels.filter((m) => m.enabled).map((m) => m.id);
    setSelectedModelIds(enabled.slice(0, 2)); // default to first 2 enabled models
    setRunModalError(null);
    setRunModalOpen(true);
  };

  const handleToggleModelSelection = (modelId: string) => {
    setSelectedModelIds((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]
    );
  };

  const handleStartBenchmark = async () => {
    if (!runModalDatasetId) {
      setRunModalError('Please select an imported dataset.');
      return;
    }
    if (selectedModelIds.length === 0) {
      setRunModalError('Please select at least one enabled model to evaluate.');
      return;
    }

    setRunStarting(true);
    setRunModalError(null);

    try {
      // Build model configs snapshot from workspace models
      const selectedModels = workspaceModels.filter((m) => selectedModelIds.includes(m.id));
      const modelConfigs: BenchmarkModelConfig[] = selectedModels.map((m) => ({
        model_id: m.id,
        display_name: m.display_name,
        provider_type: m.provider_type,
        execution_mode: m.execution_mode,
        provider_model_id: m.provider_model_id,
        base_url: m.base_url,
        huggingface_repo_id: m.huggingface_repo_id,
        input_price_per_million: m.input_price_per_million,
        output_price_per_million: m.output_price_per_million,
        pricing_source: m.pricing_source,
        pricing_snapshot: {
          input_price_per_million: m.input_price_per_million,
          output_price_per_million: m.output_price_per_million,
          pricing_source: m.pricing_source,
        },
        transient_credential: runTransientHfToken.trim() || undefined,
      }));

      const newRun = await createBenchmarkRun({
        dataset_manifest_id: runModalDatasetId,
        models: modelConfigs,
        subset_size: runSubsetSize,
        seed: 42,
        generation_settings: {
          temperature: runTemperature,
          max_tokens: 1024,
        },
        concurrency: 1,
      });

      setBenchmarkRuns((prev) => [newRun, ...prev]);
      setActiveRunId(newRun.id);
      setActiveRun(newRun);
      setRunModalOpen(false);
      setActiveTab('runs');
      setSuccessBanner(`Launched benchmark run '${newRun.id}'! Monitoring progress in real-time.`);
    } catch (err: any) {
      setRunModalError(err.message || 'Failed to start benchmark run.');
    } finally {
      setRunStarting(false);
    }
  };

  const handleCancelActiveRun = async (runId: string) => {
    try {
      await cancelBenchmarkRun(runId);
      setSuccessBanner(`Cancelled benchmark run '${runId}'.`);
      if (activeRun) {
        setActiveRun({ ...activeRun, status: 'cancelled' });
      }
      setActiveRunId(null);
    } catch (err: any) {
      setErrorBanner(`Failed to cancel run: ${err.message}`);
    }
  };

  const handleOpenResultsModal = async (run: BenchmarkRun) => {
    setResultsModalRun(run);
    setResultsLoading(true);
    setResultsFilterText('');
    try {
      const results = await fetchBenchmarkResults(run.id, 100, 0);
      setResultsModalData(results);
    } catch (err: any) {
      setErrorBanner(`Failed to load benchmark results: ${err.message}`);
    } finally {
      setResultsLoading(false);
    }
  };

  const filteredModalRecords = recordsModalData.filter((r) => {
    if (!recordFilterText.trim()) return true;
    const term = recordFilterText.toLowerCase();
    const promptText = r.input_messages[0]?.content?.toLowerCase() || '';
    const ansText = r.reference_answer?.toLowerCase() || '';
    const idText = r.record_id.toLowerCase();
    return promptText.includes(term) || ansText.includes(term) || idText.includes(term);
  });

  const filteredResults = resultsModalData.filter((res) => {
    if (!resultsFilterText.trim()) return true;
    const term = resultsFilterText.toLowerCase();
    const promptText = res.prompt_text?.toLowerCase() || '';
    const outText = res.output_text?.toLowerCase() || '';
    const modelText = res.model_display_name?.toLowerCase() || '';
    return promptText.includes(term) || outText.includes(term) || modelText.includes(term);
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="pb-4 border-b border-dark-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
            <FlaskConical className="w-6 h-6 text-brand-400" />
            Benchmark Lab & Evaluation
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Reproducible multi-model benchmark evaluation engine, dataset registry, and telemetry auditing (Milestone M4.2.1).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOpenRunModal()}
            className="dev-btn-primary text-xs flex items-center gap-1.5 px-3 py-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            New Evaluation Run
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="dev-btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Informational Truthful Notice Banner */}
      <div className="p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-800/50 flex items-start gap-3">
        <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-300 leading-relaxed">
          <span className="font-semibold text-cyan-300">Milestone M4.2.1 Execution Scope:</span> Benchmark runs execute real prompts across your selected models, capturing actual latency, TTFT, token counts, and verified costs. Model accuracy scoring will be performed in Milestone M4.2.2 via exact numeric match. Code execution (HumanEval) remains strictly disabled until isolated sandboxes are introduced.
        </div>
      </div>

      {/* Status Alerts */}
      {errorBanner && (
        <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/60 text-xs text-red-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button onClick={() => setErrorBanner(null)} className="text-red-400 hover:text-red-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successBanner && (
        <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successBanner}</span>
          </div>
          <button onClick={() => setSuccessBanner(null)} className="text-emerald-400 hover:text-emerald-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Live Active Benchmark Progress Banner */}
      {activeRun && (activeRun.status === 'running' || activeRun.status === 'pending') && (
        <div className="dev-card p-4 border border-brand-500/40 bg-brand-950/20 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <RefreshCw className="w-4 h-4 text-brand-400 animate-spin" />
              <div>
                <span className="text-xs font-semibold text-slate-100">
                  Active Benchmark Run: {activeRun.id}
                </span>
                <span className="text-[11px] text-slate-400 block">
                  Evaluating {activeRun.model_ids.length} models on {activeRun.dataset_name} ({activeRun.source_split} split)
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCancelActiveRun(activeRun.id)}
                className="text-xs text-red-300 hover:text-red-200 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 px-2.5 py-1 rounded-md flex items-center gap-1 transition-colors"
              >
                <Square className="w-3 h-3 text-red-400 fill-current" />
                Cancel Run
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-slate-300">
              <span>
                Progress:{' '}
                <strong>
                  {activeRun.progress.completed_items + activeRun.progress.failed_items} /{' '}
                  {activeRun.progress.total_items}
                </strong>{' '}
                evaluations
              </span>
              <span className="font-mono text-brand-300">
                {activeRun.progress.total_items > 0
                  ? Math.round(
                      ((activeRun.progress.completed_items + activeRun.progress.failed_items) /
                        activeRun.progress.total_items) *
                        100
                    )
                  : 0}
                %
              </span>
            </div>

            <div className="w-full bg-dark-900 rounded-full h-2 overflow-hidden border border-dark-800">
              <div
                className="bg-brand-500 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${
                    activeRun.progress.total_items > 0
                      ? Math.round(
                          ((activeRun.progress.completed_items + activeRun.progress.failed_items) /
                            activeRun.progress.total_items) *
                            100
                        )
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>

          {activeRun.progress.current_model_id && (
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
              <span>Evaluating model: <strong className="text-slate-200">{activeRun.progress.current_model_id}</strong></span>
              <span>•</span>
              <span>Prompt: <code className="text-cyan-400">{activeRun.progress.current_record_id}</code></span>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-3 border-b border-dark-800">
        <button
          onClick={() => setActiveTab('runs')}
          className={`pb-3 text-xs font-medium transition-colors flex items-center gap-2 border-b-2 -mb-px ${
            activeTab === 'runs'
              ? 'border-brand-500 text-slate-100 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Play className="w-3.5 h-3.5 text-brand-400" />
          Benchmark Evaluation Runs
          <span className="px-1.5 py-0.5 rounded-full bg-dark-800 text-[10px] text-slate-300">
            {benchmarkRuns.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('imported')}
          className={`pb-3 text-xs font-medium transition-colors flex items-center gap-2 border-b-2 -mb-px ${
            activeTab === 'imported'
              ? 'border-brand-500 text-slate-100 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          Imported Benchmark Datasets
          <span className="px-1.5 py-0.5 rounded-full bg-dark-800 text-[10px] text-slate-300">
            {importedDatasets.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('templates')}
          className={`pb-3 text-xs font-medium transition-colors flex items-center gap-2 border-b-2 -mb-px ${
            activeTab === 'templates'
              ? 'border-brand-500 text-slate-100 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database className="w-3.5 h-3.5 text-brand-400" />
          Dataset Templates & Registry
          <span className="px-1.5 py-0.5 rounded-full bg-dark-800 text-[10px] text-slate-300">
            {templates.length}
          </span>
        </button>
      </div>

      {/* TAB 1: BENCHMARK RUNS */}
      {activeTab === 'runs' && (
        <div className="space-y-4">
          {benchmarkRuns.length === 0 ? (
            <div className="dev-card p-12 text-center max-w-xl mx-auto border-dashed border-dark-750">
              <FlaskConical className="w-10 h-10 text-slate-500 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-slate-200">No Benchmark Runs Executed Yet</h3>
              <p className="text-xs text-slate-400 mt-1 mb-5 leading-relaxed">
                Execute identical GSM8K prompts across your enabled workspace models to capture real latency, token counts, and cost telemetry.
              </p>
              <button
                onClick={() => handleOpenRunModal()}
                className="dev-btn-primary text-xs px-4 py-2 inline-flex items-center gap-2"
              >
                <Play className="w-3.5 h-3.5" />
                Start First Benchmark Run
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {benchmarkRuns.map((run) => {
                const isRunning = run.status === 'running' || run.status === 'pending';
                const isSuccess = run.status === 'completed';
                const isPartial = run.status === 'completed_with_errors';
                const isCancelled = run.status === 'cancelled';

                return (
                  <div
                    key={run.id}
                    className="dev-card p-4 border border-dark-800 hover:border-dark-750 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="font-mono text-xs font-semibold text-brand-300">{run.id}</span>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-dark-850 text-slate-300 border border-dark-750">
                          {run.dataset_name} ({run.source_split})
                        </span>

                        {isRunning && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center gap-1">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            Running
                          </span>
                        )}
                        {isSuccess && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Completed
                          </span>
                        )}
                        {isPartial && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            Partial ({run.progress.failed_items} errors)
                          </span>
                        )}
                        {isCancelled && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                            Cancelled
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                        <span>
                          Models ({run.model_ids.length}):{' '}
                          <strong className="text-slate-200 font-mono text-[11px]">
                            {run.model_ids.join(', ')}
                          </strong>
                        </span>
                        <span>•</span>
                        <span>
                          Evaluations:{' '}
                          <strong className="text-slate-200">
                            {run.progress.completed_items + run.progress.failed_items} / {run.progress.total_items}
                          </strong>
                        </span>
                        <span>•</span>
                        <span>Started: {new Date(run.started_at).toLocaleTimeString()}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end md:self-center">
                      {isRunning ? (
                        <button
                          onClick={() => handleCancelActiveRun(run.id)}
                          className="dev-btn-secondary text-xs px-3 py-1.5 text-red-300 hover:text-red-200 flex items-center gap-1.5"
                        >
                          <Square className="w-3 h-3 text-red-400 fill-current" />
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={() => handleOpenResultsModal(run)}
                          className="dev-btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
                        >
                          <Eye className="w-3.5 h-3.5 text-slate-400" />
                          View Results
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: IMPORTED BENCHMARK DATASETS */}
      {activeTab === 'imported' && (
        <div className="space-y-4">
          {importedDatasets.length === 0 ? (
            <div className="dev-card p-12 text-center max-w-xl mx-auto border-dashed border-dark-750">
              <Database className="w-10 h-10 text-slate-500 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-slate-200">No Benchmark Datasets Imported Yet</h3>
              <p className="text-xs text-slate-400 mt-1 mb-5 leading-relaxed">
                Import GSM8K or HumanEval prompts from the templates registry to establish reproducible test fixtures for evaluation runs.
              </p>
              <button
                onClick={() => setActiveTab('templates')}
                className="dev-btn-primary text-xs px-4 py-2 inline-flex items-center gap-2"
              >
                Browse Dataset Templates
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {importedDatasets.map((manifest) => {
                const isMath = manifest.task_type === 'math_reasoning';
                return (
                  <div
                    key={manifest.manifest_id}
                    className="dev-card p-4 border border-dark-800 hover:border-dark-750 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            isMath
                              ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                              : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                          }`}
                        >
                          {isMath ? <Calculator className="w-4 h-4" /> : <Code className="w-4 h-4" />}
                        </span>
                        <h3 className="text-sm font-semibold text-slate-100">{manifest.dataset_name}</h3>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-dark-850 text-slate-300 border border-dark-750">
                          {manifest.source_split.toUpperCase()} split
                        </span>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                          {manifest.evaluation_role === 'held_out_test'
                            ? 'Held-out Test'
                            : manifest.evaluation_role === 'dev_train'
                            ? 'Dev / Train'
                            : 'Validation'}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Verified
                        </span>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                          Ready for Evaluation (Unbenchmarked)
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                        <span>
                          <strong className="text-slate-200">{manifest.imported_record_count}</strong> records
                          {manifest.subset_size ? ` (subset of ${manifest.total_upstream_records || 'all'}, seed ${manifest.sampling_seed})` : ' (full)'}
                        </span>
                        <span>•</span>
                        <span className="font-mono text-[11px] text-slate-400">
                          Revision: {manifest.source_revision.substring(0, 8)}
                        </span>
                        <span>•</span>
                        <span>License: {manifest.license}</span>
                        <span>•</span>
                        <span className="font-mono text-[11px] text-slate-400" title={manifest.content_fingerprint}>
                          Fingerprint: {manifest.content_fingerprint.substring(0, 10)}...
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end md:self-center">
                      {isMath && (
                        <button
                          onClick={() => handleOpenRunModal(manifest.manifest_id)}
                          className="dev-btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
                        >
                          <Play className="w-3 h-3" />
                          Evaluate
                        </button>
                      )}
                      <button
                        onClick={() => handleOpenRecordsModal(manifest)}
                        className="dev-btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5 text-slate-400" />
                        Preview Records
                      </button>
                      <button
                        onClick={() => handleDeleteManifest(manifest.manifest_id, manifest.dataset_name)}
                        className="p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"
                        title="Delete dataset"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: DATASET TEMPLATES */}
      {activeTab === 'templates' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {templates.map((tmpl) => {
              const cfg = importConfig[tmpl.id] || {
                split: tmpl.available_splits[0],
                role: 'held_out_test',
                subsetSize: tmpl.recommended_subsets[0],
                seed: 42,
                importing: false,
                error: null,
              };

              const isMath = tmpl.task_type === 'math_reasoning';
              const allowedRoles = tmpl.allowed_roles_per_split[cfg.split] || ['held_out_test'];

              return (
                <div
                  key={tmpl.id}
                  className="dev-card p-5 border border-dark-800 flex flex-col justify-between hover:border-dark-750 transition-colors"
                >
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                            isMath
                              ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                              : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                          }`}
                        >
                          {isMath ? <Calculator className="w-5 h-5" /> : <Code className="w-5 h-5" />}
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-slate-100">{tmpl.name}</h3>
                          <a
                            href={`https://huggingface.co/datasets/${tmpl.hf_repo_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-mono text-slate-400 hover:text-brand-300 flex items-center gap-1 mt-0.5 transition-colors"
                          >
                            <span>{tmpl.hf_repo_id}</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      </div>

                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                          isMath
                            ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20'
                            : 'bg-purple-500/10 text-purple-300 border-purple-500/20'
                        }`}
                      >
                        {isMath ? 'Math & Reasoning' : 'Code Generation'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">{tmpl.description}</p>

                    <div className="grid grid-cols-2 gap-2 text-[11px] bg-dark-900/60 p-2.5 rounded-lg border border-dark-800">
                      <div>
                        <span className="text-slate-400 block text-[10px]">License:</span>
                        <span className="font-medium text-emerald-400 flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3 text-emerald-400" />
                          {tmpl.license} (Verified)
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Pinned Revision:</span>
                        <span
                          className="font-mono text-slate-300 truncate block"
                          title={tmpl.pinned_revision}
                        >
                          {tmpl.pinned_revision.substring(0, 10)}...
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3 pt-2 border-t border-dark-800">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[11px] text-slate-400 block mb-1">
                            Upstream Split
                          </label>
                          <select
                            value={cfg.split}
                            onChange={(e) => handleSplitChange(tmpl.id, e.target.value)}
                            disabled={cfg.importing}
                            className="w-full bg-dark-850 border border-dark-750 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:border-brand-500 focus:outline-none"
                          >
                            {tmpl.available_splits.map((s) => (
                              <option key={s} value={s}>
                                {s.toUpperCase()} Split
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-[11px] text-slate-400 block mb-1">
                            Dataset Role
                          </label>
                          <select
                            value={cfg.role}
                            onChange={(e) =>
                              handleRoleChange(tmpl.id, e.target.value as DatasetEvaluationRole)
                            }
                            disabled={cfg.importing}
                            className="w-full bg-dark-850 border border-dark-750 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:border-brand-500 focus:outline-none"
                          >
                            {allowedRoles.map((r) => (
                              <option key={r} value={r}>
                                {r === 'held_out_test'
                                  ? 'Held-out Test (Evaluation)'
                                  : r === 'dev_train'
                                  ? 'Dev & Train Collection'
                                  : 'Validation & Tuning'}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">
                          Subset Size (Deterministic Sample)
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {tmpl.recommended_subsets.map((sz) => (
                            <button
                              key={sz}
                              type="button"
                              onClick={() => handleSubsetChange(tmpl.id, sz)}
                              className={`text-[11px] font-mono px-2.5 py-1 rounded-md transition-colors border ${
                                cfg.subsetSize === sz
                                  ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
                                  : 'bg-dark-850 text-slate-400 border-dark-750 hover:bg-dark-800'
                              }`}
                            >
                              {sz} records
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => handleSubsetChange(tmpl.id, null)}
                            className={`text-[11px] font-mono px-2.5 py-1 rounded-md transition-colors border ${
                              cfg.subsetSize === null
                                ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
                                : 'bg-dark-850 text-slate-400 border-dark-750 hover:bg-dark-800'
                            }`}
                          >
                            Full Dataset
                          </button>
                        </div>
                      </div>
                    </div>

                    {cfg.error && (
                      <div className="p-2 rounded bg-red-950/40 border border-red-800/50 text-[11px] text-red-300 flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                        <span>{cfg.error}</span>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 mt-4 border-t border-dark-800 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setSamplePreviewTemplate(tmpl)}
                      className="text-xs text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-400" />
                      Preview Sample
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExecuteImport(tmpl.id)}
                      disabled={cfg.importing}
                      className="dev-btn-primary text-xs px-3.5 py-1.5 flex items-center gap-1.5"
                    >
                      {cfg.importing ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Download className="w-3.5 h-3.5" />
                          Import Dataset
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL 1: RUN BENCHMARK MODAL */}
      {runModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="dev-card w-full max-w-xl max-h-[85vh] flex flex-col border border-dark-750 bg-dark-900 shadow-2xl rounded-2xl">
            <div className="p-4 border-b border-dark-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Play className="w-4 h-4 text-brand-400" />
                  Configure Multi-Model Benchmark Run
                </h3>
                <span className="text-[11px] text-slate-400">
                  Evaluate selected models across identical benchmark prompts (Milestone M4.2.1)
                </span>
              </div>
              <button onClick={() => setRunModalOpen(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
              {/* Dataset selection */}
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Target Benchmark Dataset (GSM8K)
                </label>
                <select
                  value={runModalDatasetId}
                  onChange={(e) => setRunModalDatasetId(e.target.value)}
                  className="w-full bg-dark-850 border border-dark-750 text-slate-200 text-xs rounded-lg px-3 py-2 focus:border-brand-500 focus:outline-none"
                >
                  {importedDatasets
                    .filter((d) => d.task_type === 'math_reasoning')
                    .map((ds) => (
                      <option key={ds.manifest_id} value={ds.manifest_id}>
                        {ds.dataset_name} ({ds.source_split} split • {ds.imported_record_count} records)
                      </option>
                    ))}
                </select>
                {importedDatasets.filter((d) => d.task_type === 'math_reasoning').length === 0 && (
                  <p className="text-[11px] text-amber-400 mt-1">
                    No GSM8K dataset found in storage. Please import a GSM8K dataset first.
                  </p>
                )}
              </div>

              {/* Models selection checklist */}
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Select Models to Evaluate ({selectedModelIds.length} selected)
                </label>
                <div className="space-y-1.5 max-h-44 overflow-y-auto p-2 rounded-lg bg-dark-950 border border-dark-800">
                  {workspaceModels.length === 0 ? (
                    <p className="text-[11px] text-slate-400 p-2">
                      No models found in workspace. Add models in Model Studio first.
                    </p>
                  ) : (
                    workspaceModels.map((m) => {
                      const isSelected = selectedModelIds.includes(m.id);
                      return (
                        <div
                          key={m.id}
                          onClick={() => handleToggleModelSelection(m.id)}
                          className={`p-2 rounded-lg flex items-center justify-between cursor-pointer border transition-colors ${
                            isSelected
                              ? 'bg-brand-500/10 border-brand-500/30 text-slate-200'
                              : 'bg-dark-900 border-dark-800 text-slate-400 hover:border-dark-750'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-4 h-4 rounded flex items-center justify-center border ${
                                isSelected ? 'bg-brand-500 border-brand-400 text-white' : 'border-dark-700'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3" />}
                            </div>
                            <div>
                              <strong className="text-xs text-slate-200 block">{m.display_name}</strong>
                              <span className="text-[10px] font-mono text-slate-400">
                                {m.provider_model_id} ({m.execution_location})
                              </span>
                            </div>
                          </div>
                          <span className="text-[10px] font-mono text-slate-400">{m.execution_mode}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Subset Size */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">
                    Record Limit (Sampling)
                  </label>
                  <select
                    value={runSubsetSize === null ? 'full' : runSubsetSize}
                    onChange={(e) =>
                      setRunSubsetSize(e.target.value === 'full' ? null : parseInt(e.target.value, 10))
                    }
                    className="w-full bg-dark-850 border border-dark-750 text-slate-200 text-xs rounded-lg px-3 py-2 focus:border-brand-500 focus:outline-none"
                  >
                    <option value={2}>2 Records (Quick Validation)</option>
                    <option value={5}>5 Records</option>
                    <option value={10}>10 Records</option>
                    <option value={25}>25 Records</option>
                    <option value="full">Full Dataset</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">
                    Temperature (0.0 = Deterministic)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.0"
                    max="1.0"
                    value={runTemperature}
                    onChange={(e) => setRunTemperature(parseFloat(e.target.value))}
                    className="w-full bg-dark-850 border border-dark-750 text-slate-200 text-xs rounded-lg px-3 py-2 focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Optional HF Token */}
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Optional Transient Hugging Face Token
                </label>
                <input
                  type="password"
                  placeholder="hf_... (used transiently in memory, never saved to disk)"
                  value={runTransientHfToken}
                  onChange={(e) => setRunTransientHfToken(e.target.value)}
                  className="w-full bg-dark-850 border border-dark-750 text-slate-200 text-xs rounded-lg px-3 py-2 focus:border-brand-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400 block mt-1">
                  Only required if evaluating remote Hugging Face Inference Provider models.
                </span>
              </div>

              {runModalError && (
                <div className="p-2.5 rounded bg-red-950/40 border border-red-800/50 text-[11px] text-red-300 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <span>{runModalError}</span>
                </div>
              )}
            </div>

            <div className="p-3.5 border-t border-dark-800 flex items-center justify-between">
              <button
                onClick={() => setRunModalOpen(false)}
                className="dev-btn-secondary text-xs px-3.5 py-1.5"
              >
                Cancel
              </button>
              <button
                onClick={handleStartBenchmark}
                disabled={runStarting}
                className="dev-btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5"
              >
                {runStarting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Launch Evaluation Run
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: BENCHMARK RESULTS MODAL */}
      {resultsModalRun && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="dev-card w-full max-w-4xl max-h-[85vh] flex flex-col border border-dark-750 bg-dark-900 shadow-2xl rounded-2xl">
            <div className="p-4 border-b border-dark-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-brand-400" />
                  Evaluation Results: {resultsModalRun.id}
                </h3>
                <span className="text-[11px] text-slate-400">
                  {resultsModalRun.dataset_name} • {resultsModalRun.model_ids.length} models •{' '}
                  {resultsModalRun.results_summary?.total_evaluations || resultsModalData.length} evaluations
                </span>
              </div>
              <button onClick={() => setResultsModalRun(null)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sub-header with search and notice */}
            <div className="p-3 border-b border-dark-800 bg-dark-850/50 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative flex-1 w-full sm:w-auto">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter results by model, prompt, or response..."
                  value={resultsFilterText}
                  onChange={(e) => setResultsFilterText(e.target.value)}
                  className="w-full pl-8 pr-3 py-1 bg-dark-900 border border-dark-750 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-brand-500"
                />
              </div>
              <span className="text-[11px] text-amber-300 font-medium">
                Note: Accuracy scoring will be calculated in Milestone M4.2.2.
              </span>
            </div>

            {/* Results list */}
            <div className="p-4 overflow-y-auto space-y-4 text-xs flex-1">
              {resultsLoading ? (
                <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-brand-400" />
                  <span>Loading benchmark results...</span>
                </div>
              ) : filteredResults.length === 0 ? (
                <div className="py-12 text-center text-slate-400">No results found matching filter query.</div>
              ) : (
                filteredResults.map((res) => (
                  <div
                    key={res.id}
                    className="p-3.5 rounded-xl bg-dark-850 border border-dark-800 space-y-2.5 hover:border-dark-750 transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between text-[11px] pb-1.5 border-b border-dark-800">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-100 flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-brand-400" />
                          {res.model_display_name}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">({res.provider_model_id})</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-mono border ${
                            res.status === 'success'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}
                        >
                          {res.status.toUpperCase()}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-cyan-400" />
                          {Math.round(res.latency_ms)}ms
                        </span>
                        <span>•</span>
                        <span>{res.total_tokens ?? '?'} tokens</span>
                        <span>•</span>
                        <span className="flex items-center gap-1 text-emerald-400">
                          <Coins className="w-3 h-3" />
                          {res.cost_usd !== null && res.cost_usd !== undefined ? `$${res.cost_usd.toFixed(6)}` : 'unpriced'}
                        </span>
                      </div>
                    </div>

                    {/* Prompt */}
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-slate-400 block mb-0.5">
                        Benchmark Prompt:
                      </span>
                      <pre className="p-2.5 rounded bg-dark-950 font-mono text-[11px] text-slate-200 whitespace-pre-wrap">
                        {res.prompt_text}
                      </pre>
                    </div>

                    {/* Model Output */}
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-brand-300 block mb-0.5">
                        Model Output Response:
                      </span>
                      {res.status === 'success' ? (
                        <pre className="p-2.5 rounded bg-dark-950 font-mono text-[11px] text-slate-200 whitespace-pre-wrap">
                          {res.output_text || '(Empty output)'}
                        </pre>
                      ) : (
                        <div className="p-2.5 rounded bg-red-950/30 border border-red-800/40 text-red-300 text-[11px]">
                          <strong>Error:</strong> {res.error_message || 'Inference execution failed.'}
                        </div>
                      )}
                    </div>

                    {/* Ground truth reference */}
                    <div className="p-2.5 rounded bg-dark-900/80 border border-dark-800 text-[11px] space-y-1">
                      <span className="text-[10px] uppercase font-semibold text-emerald-400 block">
                        Reference Ground Truth:
                      </span>
                      <p className="text-slate-300 text-[11px] whitespace-pre-wrap">{res.reference_answer}</p>
                      {res.reference_metadata?.extracted_answer && (
                        <div className="text-[11px] text-slate-300 pt-1 border-t border-dark-800/60">
                          <span className="text-slate-400">Ground-Truth Target:</span>{' '}
                          <strong className="text-cyan-300 font-mono">
                            {res.reference_metadata.extracted_answer}
                          </strong>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-3 border-t border-dark-800 text-right">
              <button
                onClick={() => setResultsModalRun(null)}
                className="dev-btn-secondary text-xs px-4 py-1.5"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: CANONICAL RECORDS VIEWER */}
      {recordsModalManifest && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="dev-card w-full max-w-4xl max-h-[85vh] flex flex-col border border-dark-750 bg-dark-900 shadow-2xl rounded-2xl">
            <div className="p-4 border-b border-dark-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-400" />
                  Canonical Records: {recordsModalManifest.dataset_name}
                </h3>
                <span className="text-[11px] text-slate-400">
                  {recordsModalManifest.imported_record_count} verified canonical records in local storage
                </span>
              </div>
              <button
                onClick={() => setRecordsModalManifest(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 border-b border-dark-800 bg-dark-850/50 flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter records by prompt, answer or ID..."
                  value={recordFilterText}
                  onChange={(e) => setRecordFilterText(e.target.value)}
                  className="w-full pl-8 pr-3 py-1 bg-dark-900 border border-dark-750 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-brand-500"
                />
              </div>
              <span className="text-xs text-slate-400">
                Showing {filteredModalRecords.length} of {recordsModalData.length} records
              </span>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 text-xs flex-1">
              {recordsLoading ? (
                <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-brand-400" />
                  <span>Loading canonical records from storage...</span>
                </div>
              ) : filteredModalRecords.length === 0 ? (
                <div className="py-12 text-center text-slate-400">No records match the filter query.</div>
              ) : (
                filteredModalRecords.map((rec) => (
                  <div
                    key={rec.record_id}
                    className="p-3.5 rounded-xl bg-dark-850 border border-dark-800 space-y-2 hover:border-dark-750 transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between text-[11px] pb-1 border-b border-dark-800">
                      <span className="font-mono text-cyan-400">{rec.record_id}</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Hash: {rec.content_hash.substring(0, 10)}...
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-semibold text-slate-400 block mb-0.5">
                        User Prompt:
                      </span>
                      <pre className="p-2.5 rounded bg-dark-950 font-mono text-[11px] text-slate-200 whitespace-pre-wrap">
                        {rec.input_messages[0]?.content}
                      </pre>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-semibold text-emerald-400 block mb-0.5">
                        Reference Ground Truth:
                      </span>
                      <pre className="p-2.5 rounded bg-dark-950 font-mono text-[11px] text-slate-300 whitespace-pre-wrap">
                        {rec.reference_answer}
                      </pre>
                    </div>

                    {rec.reference_metadata && Object.keys(rec.reference_metadata).length > 0 && (
                      <div className="p-2 rounded bg-dark-900/80 border border-dark-800 text-[11px] flex flex-wrap gap-4">
                        {rec.reference_metadata.extracted_answer && (
                          <div>
                            <span className="text-slate-400">Extracted Answer:</span>{' '}
                            <strong className="text-cyan-300 font-mono">
                              {rec.reference_metadata.extracted_answer}
                            </strong>
                          </div>
                        )}
                        {rec.reference_metadata.entry_point && (
                          <div>
                            <span className="text-slate-400">Entry Point:</span>{' '}
                            <code className="text-purple-300">{rec.reference_metadata.entry_point}</code>
                          </div>
                        )}
                        {rec.reference_metadata.execution_policy && (
                          <div>
                            <span className="text-slate-400">Execution Policy:</span>{' '}
                            <span className="text-amber-400 font-mono text-[10px]">
                              {rec.reference_metadata.execution_policy}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="p-3 border-t border-dark-800 text-right">
              <button
                onClick={() => setRecordsModalManifest(null)}
                className="dev-btn-secondary text-xs px-4 py-1.5"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: TEMPLATE SAMPLE PREVIEW MODAL */}
      {samplePreviewTemplate && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="dev-card w-full max-w-2xl max-h-[80vh] flex flex-col border border-dark-750 bg-dark-900 shadow-2xl rounded-2xl">
            <div className="p-4 border-b border-dark-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Database className="w-4 h-4 text-brand-400" />
                  Sample Records: {samplePreviewTemplate.name}
                </h3>
                <span className="text-[11px] text-slate-400">
                  Pre-configured deterministic preview from upstream repository
                </span>
              </div>
              <button
                onClick={() => setSamplePreviewTemplate(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 text-xs">
              {samplePreviewTemplate.sample_records.map((sample, idx) => (
                <div key={idx} className="p-3.5 rounded-xl bg-dark-850 border border-dark-800 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pb-1 border-b border-dark-800">
                    <span className="font-mono text-cyan-400">{sample.task_id || `Sample #${idx + 1}`}</span>
                    {sample.entry_point && (
                      <span className="font-mono text-slate-400">entry_point: {sample.entry_point}</span>
                    )}
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-semibold text-slate-400 block mb-0.5">Prompt:</span>
                    <pre className="p-2 rounded bg-dark-950 font-mono text-[11px] text-slate-200 whitespace-pre-wrap">
                      {sample.question || sample.prompt}
                    </pre>
                  </div>

                  {sample.reference_answer && (
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-emerald-400 block mb-0.5">
                        Reference Answer:
                      </span>
                      <pre className="p-2 rounded bg-dark-950 font-mono text-[11px] text-slate-300 whitespace-pre-wrap">
                        {sample.reference_answer}
                      </pre>
                    </div>
                  )}

                  {sample.canonical_solution && (
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-purple-400 block mb-0.5">
                        Canonical Solution:
                      </span>
                      <pre className="p-2 rounded bg-dark-950 font-mono text-[11px] text-slate-300 whitespace-pre-wrap">
                        {sample.canonical_solution}
                      </pre>
                    </div>
                  )}

                  {sample.extracted_answer && (
                    <div className="text-[11px] text-slate-300">
                      <span className="text-slate-400">Extracted Ground-Truth Answer:</span>{' '}
                      <strong className="text-cyan-300 font-mono">{sample.extracted_answer}</strong>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-dark-800 text-right">
              <button
                onClick={() => setSamplePreviewTemplate(null)}
                className="dev-btn-secondary text-xs px-4 py-1.5"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
