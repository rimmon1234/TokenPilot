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
  XCircle,
  HelpCircle,
  BarChart3,
  FileSpreadsheet,
  FileText,
  TrendingUp,
  Scale,
  Target,
  Zap,
  Sparkles,
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
  ModelScoringSummary,
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
  scoreBenchmarkRun,
  downloadBenchmarkReport,
  deleteBenchmarkRun,
} from '../services/benchmark_service';
import { workspaceRepo } from '../storage/indexeddb_repository';

export const BenchmarkLabPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'templates' | 'imported' | 'runs' | 'comparison'>('templates');
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
  const [resultsOutcomeFilter, setResultsOutcomeFilter] = useState<string>('all');
  const [scoringRunId, setScoringRunId] = useState<string | null>(null);

  // Model Comparison & Benchmark Reports States (Milestone M4.2.3)
  const [selectedComparisonRunId, setSelectedComparisonRunId] = useState<string | null>(null);
  const [comparisonResults, setComparisonResults] = useState<BenchmarkResult[]>([]);
  const [comparisonLoading, setComparisonLoading] = useState<boolean>(false);
  const [comparisonFilterModel, setComparisonFilterModel] = useState<string>('all');
  const [comparisonFilterOutcome, setComparisonFilterOutcome] = useState<string>('all');
  const [comparisonSearchText, setComparisonSearchText] = useState<string>('');
  const [exportingFormat, setExportingFormat] = useState<'json' | 'csv' | null>(null);

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

      // Initialize comparison run selection if not set
      if (runsData.length > 0) {
        setSelectedComparisonRunId((prev) => {
          if (prev && runsData.some((r) => r.id === prev)) return prev;
          const preferredRun =
            runsData.find(
              (r) =>
                r.status === 'completed' &&
                r.results_summary?.model_metrics &&
                Object.keys(r.results_summary.model_metrics).length > 0
            ) || runsData[0];
          return preferredRun.id;
        });
      }

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

  const loadComparisonRunDetails = async (runId: string) => {
    setComparisonLoading(true);
    try {
      const results = await fetchBenchmarkResults(runId, 500, 0);
      setComparisonResults(results);
    } catch (err: any) {
      setErrorBanner(`Failed to load comparison results: ${err.message}`);
    } finally {
      setComparisonLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'comparison' && selectedComparisonRunId) {
      loadComparisonRunDetails(selectedComparisonRunId);
    }
  }, [activeTab, selectedComparisonRunId]);

  const handleExportReport = async (format: 'json' | 'csv') => {
    if (!selectedComparisonRunId) return;
    setExportingFormat(format);
    try {
      await downloadBenchmarkReport(selectedComparisonRunId, format);
      setSuccessBanner(`Exported benchmark report (${format.toUpperCase()}) for ${selectedComparisonRunId}.`);
    } catch (err: any) {
      setErrorBanner(`Failed to export benchmark report: ${err.message}`);
    } finally {
      setExportingFormat(null);
    }
  };

  const handleScoreComparisonRun = async () => {
    if (!selectedComparisonRunId) return;
    setScoringRunId(selectedComparisonRunId);
    try {
      const updatedRun = await scoreBenchmarkRun(selectedComparisonRunId);
      setBenchmarkRuns((prev) => prev.map((r) => (r.id === updatedRun.id ? updatedRun : r)));
      await loadComparisonRunDetails(selectedComparisonRunId);
      setSuccessBanner(`Successfully evaluated and scored run ${selectedComparisonRunId}.`);
    } catch (err: any) {
      setErrorBanner(`Failed to score benchmark run: ${err.message}`);
    } finally {
      setScoringRunId(null);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete benchmark run '${runId}' and its evaluation records?`)) {
      return;
    }
    try {
      await deleteBenchmarkRun(runId);
      setBenchmarkRuns((prev) => prev.filter((r) => r.id !== runId));
      if (selectedComparisonRunId === runId) {
        const remaining = benchmarkRuns.filter((r) => r.id !== runId);
        setSelectedComparisonRunId(remaining.length > 0 ? remaining[0].id : null);
      }
      setSuccessBanner(`Successfully deleted benchmark run '${runId}'.`);
    } catch (err: any) {
      setErrorBanner(`Failed to delete benchmark run: ${err.message}`);
    }
  };

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
    setResultsOutcomeFilter('all');
    try {
      const results = await fetchBenchmarkResults(run.id, 100, 0);
      setResultsModalData(results);
    } catch (err: any) {
      setErrorBanner(`Failed to load benchmark results: ${err.message}`);
    } finally {
      setResultsLoading(false);
    }
  };

  const handleScoreRun = async (runId: string) => {
    setScoringRunId(runId);
    try {
      const updatedRun = await scoreBenchmarkRun(runId);
      setBenchmarkRuns((prev) => prev.map((r) => (r.id === updatedRun.id ? updatedRun : r)));
      if (activeRun && activeRun.id === updatedRun.id) {
        setActiveRun(updatedRun);
      }
      if (resultsModalRun && resultsModalRun.id === updatedRun.id) {
        setResultsModalRun(updatedRun);
        const results = await fetchBenchmarkResults(updatedRun.id, 100, 0);
        setResultsModalData(results);
      }
      setSuccessBanner(`Successfully evaluated and scored benchmark run '${runId}'!`);
    } catch (err: any) {
      setErrorBanner(`Failed to score benchmark run: ${err.message}`);
    } finally {
      setScoringRunId(null);
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
    if (resultsOutcomeFilter !== 'all') {
      const status = res.evaluation_status || 'unevaluated';
      if (resultsOutcomeFilter !== status) {
        return false;
      }
    }
    if (!resultsFilterText.trim()) return true;
    const term = resultsFilterText.toLowerCase();
    const promptText = res.prompt_text?.toLowerCase() || '';
    const outText = res.output_text?.toLowerCase() || '';
    const modelText = res.model_display_name?.toLowerCase() || '';
    const ansText = res.extracted_answer?.toLowerCase() || '';
    return promptText.includes(term) || outText.includes(term) || modelText.includes(term) || ansText.includes(term);
  });

  // Derived Comparison States (Milestone M4.2.3)
  const selectedComparisonRun = benchmarkRuns.find((r) => r.id === selectedComparisonRunId) || null;
  const comparisonModelMetrics: Record<string, ModelScoringSummary> =
    selectedComparisonRun?.results_summary?.model_metrics || {};
  const comparisonModelList = Object.values(comparisonModelMetrics);

  const filteredComparisonResults = comparisonResults.filter((res) => {
    if (comparisonFilterModel !== 'all' && res.model_id !== comparisonFilterModel) {
      return false;
    }
    if (comparisonFilterOutcome !== 'all') {
      const status = res.evaluation_status || 'unevaluated';
      if (comparisonFilterOutcome !== status) {
        return false;
      }
    }
    if (comparisonSearchText.trim()) {
      const term = comparisonSearchText.toLowerCase();
      const promptText = res.prompt_text?.toLowerCase() || '';
      const outText = res.output_text?.toLowerCase() || '';
      const modelText = res.model_display_name?.toLowerCase() || '';
      const ansText = res.extracted_answer?.toLowerCase() || '';
      const refText = res.reference_answer?.toLowerCase() || '';
      if (
        !promptText.includes(term) &&
        !outText.includes(term) &&
        !modelText.includes(term) &&
        !ansText.includes(term) &&
        !refText.includes(term)
      ) {
        return false;
      }
    }
    return true;
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
          onClick={() => setActiveTab('comparison')}
          className={`pb-3 text-xs font-medium transition-colors flex items-center gap-2 border-b-2 -mb-px ${
            activeTab === 'comparison'
              ? 'border-brand-500 text-slate-100 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
          Model Comparison & Reports
          <span className="px-1.5 py-0.5 rounded-full bg-cyan-950/60 border border-cyan-800/60 text-[10px] text-cyan-300 font-semibold">
            M4.2.3
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

                      {/* Display scoring metrics if scored */}
                      {run.results_summary?.scorable_accuracy !== undefined && run.results_summary?.scorable_accuracy !== null ? (
                        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            Scorable Acc: {(run.results_summary.scorable_accuracy * 100).toFixed(1)}%
                          </span>
                          <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-semibold">
                            E2E Rate: {run.results_summary.end_to_end_accuracy !== null ? `${(run.results_summary.end_to_end_accuracy * 100).toFixed(1)}%` : 'N/A'}
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            ({run.results_summary.total_correct} correct, {run.results_summary.total_incorrect} incorrect, {run.results_summary.total_unparseable} unparseable)
                          </span>
                        </div>
                      ) : (
                        !isRunning && run.task_type === 'math_reasoning' && (
                          <div className="text-[11px] text-slate-400 italic pt-0.5">
                            Responses captured • Ready for GSM8K numerical scoring
                          </div>
                        )
                      )}
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
                        <>
                          {(isSuccess || isPartial) && run.task_type === 'math_reasoning' && (
                            <button
                              onClick={() => handleScoreRun(run.id)}
                              disabled={scoringRunId === run.id}
                              className="dev-btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
                            >
                              {scoringRunId === run.id ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Calculator className="w-3.5 h-3.5" />
                              )}
                              {run.results_summary?.evaluation_metric ? 'Re-Score' : 'Score Run'}
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenResultsModal(run)}
                            className="dev-btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
                          >
                            <Eye className="w-3.5 h-3.5 text-slate-400" />
                            View Results
                          </button>
                          <button
                            onClick={() => handleDeleteRun(run.id)}
                            className="p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"
                            title="Delete benchmark run"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB: MODEL COMPARISON & BENCHMARK REPORTS (Milestone M4.2.3) */}
      {activeTab === 'comparison' && (
        <div className="space-y-6">
          {/* Header Controls: Run Selector & Export Actions */}
          <div className="dev-card p-5 border border-dark-800 bg-dark-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1 flex-1">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-cyan-400" />
                Select Benchmark Run to Analyze
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={selectedComparisonRunId || ''}
                  onChange={(e) => setSelectedComparisonRunId(e.target.value)}
                  className="bg-dark-850 border border-dark-750 text-slate-200 text-xs rounded-lg px-3 py-2 min-w-[280px] md:min-w-[360px] focus:border-brand-500 focus:outline-none"
                >
                  {benchmarkRuns.length === 0 ? (
                    <option value="">No benchmark runs available</option>
                  ) : (
                    benchmarkRuns.map((r) => {
                      const modelCount = r.model_configs?.length || 0;
                      const hasScores =
                        r.results_summary?.model_metrics &&
                        Object.keys(r.results_summary.model_metrics).length > 0;
                      return (
                        <option key={r.id} value={r.id}>
                          {r.id} — {r.dataset_name} ({r.source_split}, N={r.subset_size || r.progress?.total_items || 'all'}, {modelCount} models) [
                          {r.status}
                          {hasScores ? ' • Scored' : ' • Unscored'}]
                        </option>
                      );
                    })
                  )}
                </select>

                {/* Score Run Button if completed but unscored */}
                {selectedComparisonRun &&
                  selectedComparisonRun.status === 'completed' &&
                  (!selectedComparisonRun.results_summary?.model_metrics ||
                    Object.keys(selectedComparisonRun.results_summary.model_metrics).length === 0) && (
                    <button
                      onClick={handleScoreComparisonRun}
                      disabled={scoringRunId === selectedComparisonRun.id}
                      className="dev-btn-primary text-xs px-3.5 py-2 flex items-center gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border-none shadow-md shadow-emerald-950/40"
                    >
                      {scoringRunId === selectedComparisonRun.id ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Scoring Run...
                        </>
                      ) : (
                        <>
                          <Zap className="w-3.5 h-3.5" />
                          Score Run Now
                        </>
                      )}
                    </button>
                  )}
              </div>
            </div>

            {/* Export buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleExportReport('json')}
                disabled={!selectedComparisonRunId || exportingFormat !== null}
                className="dev-btn-secondary text-xs px-3 py-2 flex items-center gap-1.5 hover:border-cyan-500/50 hover:text-cyan-300"
                title="Download JSON report with full metadata, metrics, and evaluation records"
              >
                {exportingFormat === 'json' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-cyan-400" />
                )}
                Export JSON
              </button>

              <button
                onClick={() => handleExportReport('csv')}
                disabled={!selectedComparisonRunId || exportingFormat !== null}
                className="dev-btn-secondary text-xs px-3 py-2 flex items-center gap-1.5 hover:border-emerald-500/50 hover:text-emerald-300"
                title="Download CSV report with RFC 4180 escaping"
              >
                {exportingFormat === 'csv' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                ) : (
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                )}
                Export CSV
              </button>

              {selectedComparisonRun && (
                <button
                  onClick={() => handleDeleteRun(selectedComparisonRun.id)}
                  className="dev-btn-secondary text-xs px-3 py-2 flex items-center gap-1.5 hover:border-red-500/50 hover:text-red-400 text-slate-400"
                  title="Delete this benchmark run and its results"
                >
                  <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-400" />
                  Delete Run
                </button>
              )}
            </div>
          </div>

          {!selectedComparisonRun ? (
            <div className="dev-card p-12 text-center max-w-xl mx-auto border-dashed border-dark-750">
              <Scale className="w-10 h-10 text-slate-500 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-slate-200">No Benchmark Run Selected</h3>
              <p className="text-xs text-slate-400 mt-1">
                Execute a benchmark run or select an existing one above to compare model reasoning accuracy and cost efficiency.
              </p>
            </div>
          ) : (
            <>
              {/* Controlled Comparison Baseline & Metadata Banner */}
              <div className="dev-card p-4 border border-dark-800 bg-dark-900/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-cyan-950/60 border border-cyan-800/60 text-cyan-300 font-semibold text-[11px]">
                      <ShieldCheck className="w-3 h-3 text-cyan-400" />
                      Controlled Intra-Run Comparison
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      Run ID: <strong className="text-slate-200">{selectedComparisonRun.id}</strong>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
                    <span>
                      Dataset: <strong className="text-slate-100">{selectedComparisonRun.dataset_name}</strong>
                    </span>
                    <span>
                      Split: <strong className="text-slate-100">{selectedComparisonRun.source_split}</strong>
                    </span>
                    <span>
                      Revision:{' '}
                      <strong className="text-slate-100 font-mono text-[11px]">
                        {selectedComparisonRun.dataset_revision || 'canonical'}
                      </strong>
                    </span>
                    <span>
                      Tested Questions:{' '}
                      <strong className="text-slate-100">
                        {selectedComparisonRun.subset_size || selectedComparisonRun.progress?.total_items || 'all'}
                      </strong>
                    </span>
                    <span>
                      Config:{' '}
                      <strong className="text-slate-100 font-mono text-[11px]">
                        temp={selectedComparisonRun.generation_settings?.temperature ?? 0.0}, seed=
                        {selectedComparisonRun.seed ?? 'N/A'}
                      </strong>
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 max-w-sm leading-relaxed border-t md:border-t-0 md:border-l border-dark-800 pt-2 md:pt-0 md:pl-4">
                  <span className="text-cyan-300 font-medium">Scientific Fairness Guarantee:</span> All models in this run evaluated the identical question prompts and sampling configuration. TokenPilot does not cross-rank runs with disparate prompt sets.
                </div>
              </div>

              {/* Single Model Notice (when applicable) */}
              {selectedComparisonRun.model_configs?.length === 1 && (
                <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/50 flex items-start gap-3">
                  <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-slate-300 leading-relaxed">
                    <span className="font-semibold text-amber-300">Single-Model Evaluation:</span> This benchmark run contains 1 model ({selectedComparisonRun.model_configs[0].display_name}). Metric breakdowns and individual evaluation records are fully available below. Head-to-head comparison matrices and Pareto frontier trade-off curves require at least two evaluated models.
                  </div>
                </div>
              )}

              {/* Section 1: Model Comparison Matrix */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Scale className="w-4 h-4 text-brand-400" />
                    Model Performance & Cost Matrix
                  </h3>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {comparisonModelList.length} model{comparisonModelList.length === 1 ? '' : 's'} recorded
                  </span>
                </div>

                {comparisonModelList.length === 0 ? (
                  <div className="dev-card p-8 text-center border-dark-800">
                    <p className="text-xs text-slate-400">
                      No scored models found for this run. Click &quot;Score Run Now&quot; to evaluate responses.
                    </p>
                  </div>
                ) : (
                  <div className="dev-card border border-dark-800 overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-200 border-collapse">
                      <thead>
                        <tr className="border-b border-dark-800 bg-dark-850/60 text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                          <th className="py-3 px-3.5">Model / Provider</th>
                          <th className="py-3 px-3 text-center">Attempted</th>
                          <th className="py-3 px-3 text-center">Correct / Inc / Unp / Fail</th>
                          <th className="py-3 px-3 text-right">Scorable Acc</th>
                          <th className="py-3 px-3 text-right">E2E Rate</th>
                          <th className="py-3 px-3 text-right">Latency (Avg / Med)</th>
                          <th className="py-3 px-3 text-right">Tokens</th>
                          <th className="py-3 px-3 text-right">Cost / Q</th>
                          <th className="py-3 px-3 text-right">Total Cost</th>
                          <th className="py-3 px-3.5 text-center">Pareto Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-dark-800 font-mono">
                        {comparisonModelList.map((m) => {
                          const scorableStr =
                            m.scorable_accuracy !== null && m.scorable_accuracy !== undefined
                              ? `${(m.scorable_accuracy * 100).toFixed(1)}%`
                              : 'N/A';
                          const e2eStr =
                            m.end_to_end_accuracy !== null && m.end_to_end_accuracy !== undefined
                              ? `${(m.end_to_end_accuracy * 100).toFixed(1)}%`
                              : 'N/A';
                          const costQStr =
                            m.cost_per_question_usd !== null && m.cost_per_question_usd !== undefined
                              ? `$${m.cost_per_question_usd.toFixed(4)}`
                              : null;
                          const totalCostStr =
                            m.total_cost_usd !== null && m.total_cost_usd !== undefined
                              ? `$${m.total_cost_usd.toFixed(4)}`
                              : null;

                          return (
                            <tr key={m.model_id} className="hover:bg-dark-800/40 transition-colors">
                              <td className="py-3 px-3.5">
                                <div className="font-sans font-medium text-slate-100 flex items-center gap-1.5">
                                  {m.display_name}
                                </div>
                                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1 mt-0.5">
                                  <span>{m.provider_type}</span>
                                  <span>•</span>
                                  <span className="text-slate-300">{m.provider_model_id}</span>
                                </div>
                              </td>

                              <td className="py-3 px-3 text-center text-slate-300">
                                {m.attempted_questions} <span className="text-slate-500 text-[10px]">({m.successful_generations} ok)</span>
                              </td>

                              <td className="py-3 px-3 text-center">
                                <div className="flex items-center justify-center gap-1.5 text-xs">
                                  <span className="text-emerald-400 font-semibold" title="Correct answers">
                                    {m.correct_answers}
                                  </span>
                                  <span className="text-slate-600">/</span>
                                  <span className="text-red-400" title="Incorrect answers">
                                    {m.incorrect_answers}
                                  </span>
                                  <span className="text-slate-600">/</span>
                                  <span className="text-amber-400" title="Unparseable answers">
                                    {m.unparseable_answers}
                                  </span>
                                  <span className="text-slate-600">/</span>
                                  <span className="text-rose-500" title="Failed requests">
                                    {m.failed_requests}
                                  </span>
                                </div>
                              </td>

                              <td className="py-3 px-3 text-right">
                                <span
                                  className={`px-1.5 py-0.5 rounded font-semibold text-xs ${
                                    m.scorable_accuracy !== null && m.scorable_accuracy !== undefined && m.scorable_accuracy >= 0.7
                                      ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
                                      : m.scorable_accuracy !== null && m.scorable_accuracy !== undefined && m.scorable_accuracy >= 0.4
                                      ? 'bg-amber-950/60 text-amber-300 border border-amber-800/60'
                                      : 'bg-dark-800 text-slate-300'
                                  }`}
                                  title="Scorable Accuracy = Correct / (Correct + Incorrect)"
                                >
                                  {scorableStr}
                                </span>
                              </td>

                              <td className="py-3 px-3 text-right text-slate-300" title="End-to-End Rate = Correct / Attempted">
                                {e2eStr}
                              </td>

                              <td className="py-3 px-3 text-right text-slate-300 text-[11px]">
                                {m.avg_latency_ms !== null && m.avg_latency_ms !== undefined ? (
                                  <>
                                    <span>{Math.round(m.avg_latency_ms)}ms</span>
                                    <span className="text-slate-500 mx-1">/</span>
                                    <span>{m.median_latency_ms !== null && m.median_latency_ms !== undefined ? `${Math.round(m.median_latency_ms)}ms` : '-'}</span>
                                  </>
                                ) : (
                                  <span className="text-slate-500 italic">Unavailable</span>
                                )}
                              </td>

                              <td className="py-3 px-3 text-right text-slate-300 text-[11px]">
                                <div>{(m.total_tokens || 0).toLocaleString()}</div>
                                <div className="text-[10px] text-slate-500 capitalize">
                                  {m.token_provenance || 'unknown'}
                                  {(m.missing_usage_count ?? 0) > 0 && (
                                    <span className="text-amber-400 ml-1">({m.missing_usage_count} miss)</span>
                                  )}
                                </div>
                              </td>

                              <td className="py-3 px-3 text-right">
                                {costQStr !== null ? (
                                  <span className="text-slate-200">{costQStr}</span>
                                ) : (
                                  <span className="text-slate-500 italic text-[11px]">Unknown</span>
                                )}
                              </td>

                              <td className="py-3 px-3 text-right">
                                {totalCostStr !== null ? (
                                  <span className="text-slate-200">{totalCostStr}</span>
                                ) : (
                                  <span className="text-slate-500 italic text-[11px]">Unknown</span>
                                )}
                                {(m.unknown_cost_count ?? 0) > 0 && (
                                  <div className="text-[10px] text-amber-400/90">
                                    {m.unknown_cost_count} unpriced
                                  </div>
                                )}
                              </td>

                              <td className="py-3 px-3.5 text-center">
                                {m.is_pareto_efficient === true ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-semibold text-[10px]">
                                    <Sparkles className="w-2.5 h-2.5" />
                                    Pareto Frontier
                                  </span>
                                ) : m.is_pareto_efficient === false ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-dark-800 border border-dark-700 text-slate-400 text-[10px]">
                                    Dominated
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px]">
                                    Unpriced Tier
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {/* Metric Definitions Footer */}
                    <div className="p-3 border-t border-dark-800 bg-dark-850/40 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <strong>Scorable Acc:</strong> Correct / (Correct + Incorrect) •{' '}
                        <strong>E2E Rate:</strong> Correct / Total Attempted •{' '}
                        <strong>Pareto Frontier:</strong> Models where no alternative is simultaneously cheaper and more accurate.
                      </div>
                      <div className="text-slate-500">
                        Zero, unknown and unavailable states are strictly distinguished.
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 2: Quality-vs-Cost Visualization & Pareto Frontier */}
              <div className="dev-card p-5 border border-dark-800 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-emerald-400" />
                      Quality vs. Cost Trade-Off & Pareto Frontier
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Scorable Accuracy (%) plotted against Estimated Cost per Question (USD). Non-dominated models define the empirical Pareto frontier.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
                      Pareto Efficient
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                      Dominated
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 border-b-2 border-emerald-400 border-dashed" />
                      Frontier Curve
                    </span>
                  </div>
                </div>

                {/* SVG Scatter Plot Render */}
                {(() => {
                  const priced = comparisonModelList.filter(
                    (m) =>
                      m.cost_per_question_usd !== null &&
                      m.cost_per_question_usd !== undefined &&
                      m.scorable_accuracy !== null &&
                      m.scorable_accuracy !== undefined
                  );

                  if (priced.length === 0) {
                    return (
                      <div className="p-8 rounded-xl bg-dark-850/80 border border-dark-750 text-center space-y-2">
                        <Coins className="w-8 h-8 text-amber-400/80 mx-auto mb-1" />
                        <h4 className="text-xs font-semibold text-slate-200">
                          No Priced Cloud Models in Selected Benchmark Run
                        </h4>
                        <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
                          All evaluated models in this run use local hardware compute or unpriced provider configurations. TokenPilot does not assign artificial $0.00 coordinates to preserve truthful cost comparisons. Quality metrics are available in the table above and detailed inspector below.
                        </p>
                      </div>
                    );
                  }

                  const maxCost = Math.max(...priced.map((m) => m.cost_per_question_usd || 0), 0.001) * 1.25;
                  const getX = (cost: number) => 60 + (cost / maxCost) * 500;
                  const getY = (acc: number) => 25 + 210 - acc * 210;

                  // Sort pareto points by cost ascending to draw frontier path
                  const paretoPoints = priced
                    .filter((m) => m.is_pareto_efficient === true)
                    .sort((a, b) => (a.cost_per_question_usd || 0) - (b.cost_per_question_usd || 0));

                  const paretoPathD = paretoPoints.length > 1
                    ? paretoPoints
                        .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(p.cost_per_question_usd || 0)} ${getY(p.scorable_accuracy || 0)}`)
                        .join(' ')
                    : '';

                  return (
                    <div className="space-y-3">
                      {priced.length === 1 && (
                        <div className="p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-800/40 text-xs text-cyan-300 flex items-center gap-2">
                          <Info className="w-4 h-4 shrink-0" />
                          <span>
                            1 priced model evaluated ({priced[0].display_name}). Multi-model runs with at least 2 models will plot trade-off comparisons and the empirical Pareto frontier curve.
                          </span>
                        </div>
                      )}

                      <div className="w-full overflow-x-auto bg-dark-950/60 rounded-xl border border-dark-800 p-2">
                        <svg
                          viewBox="0 0 600 280"
                          className="w-full h-auto max-h-[320px] select-none text-[10px] font-mono"
                        >
                          {/* Grid lines & Y Axis Labels */}
                          {[0, 0.25, 0.5, 0.75, 1.0].map((level) => {
                            const y = getY(level);
                            return (
                              <g key={level}>
                                <line x1="60" y1={y} x2="560" y2={y} stroke="#334155" strokeDasharray="3 3" opacity="0.4" />
                                <text x="50" y={y + 3} textAnchor="end" fill="#94a3b8">
                                  {Math.round(level * 100)}%
                                </text>
                              </g>
                            );
                          })}

                          {/* X Axis Grid & Labels */}
                          {[0, maxCost * 0.25, maxCost * 0.5, maxCost * 0.75, maxCost].map((cost, idx) => {
                            const x = getX(cost);
                            return (
                              <g key={idx}>
                                <line x1={x} y1="25" x2={x} y2="235" stroke="#334155" strokeDasharray="3 3" opacity="0.3" />
                                <text x={x} y="250" textAnchor="middle" fill="#94a3b8">
                                  ${cost.toFixed(4)}
                                </text>
                              </g>
                            );
                          })}

                          {/* Axis Titles */}
                          <text x="310" y="272" textAnchor="middle" fill="#cbd5e1" className="font-semibold font-sans text-[11px]">
                            Estimated Cost per Question (USD)
                          </text>
                          <text
                            transform="rotate(-90)"
                            x="-130"
                            y="18"
                            textAnchor="middle"
                            fill="#cbd5e1"
                            className="font-semibold font-sans text-[11px]"
                          >
                            Scorable Accuracy (%)
                          </text>

                          {/* Pareto Frontier Line */}
                          {paretoPathD && (
                            <path
                              d={paretoPathD}
                              fill="none"
                              stroke="#10b981"
                              strokeWidth="2.5"
                              strokeDasharray="4 2"
                              opacity="0.9"
                            />
                          )}

                          {/* Model Data Points */}
                          {priced.map((m) => {
                            const cx = getX(m.cost_per_question_usd || 0);
                            const cy = getY(m.scorable_accuracy || 0);
                            const isPareto = m.is_pareto_efficient === true;

                            return (
                              <g key={m.model_id} className="cursor-pointer group">
                                {isPareto && (
                                  <circle cx={cx} cy={cy} r="10" fill="#10b981" opacity="0.25" className="animate-pulse" />
                                )}
                                <circle
                                  cx={cx}
                                  cy={cy}
                                  r={isPareto ? 6 : 5}
                                  fill={isPareto ? '#10b981' : '#64748b'}
                                  stroke={isPareto ? '#ecfdf5' : '#1e293b'}
                                  strokeWidth="1.5"
                                />
                                <text
                                  x={cx}
                                  y={cy - 12}
                                  textAnchor="middle"
                                  fill={isPareto ? '#a7f3d0' : '#cbd5e1'}
                                  className="font-sans font-semibold text-[10px]"
                                >
                                  {m.display_name}
                                </text>
                              </g>
                            );
                          })}
                        </svg>
                      </div>
                    </div>
                  );
                })()}

                {/* Local Compute / Unpriced Models Shelf */}
                {(() => {
                  const unpriced = comparisonModelList.filter(
                    (m) => m.cost_per_question_usd === null || m.cost_per_question_usd === undefined
                  );
                  if (unpriced.length === 0) return null;

                  return (
                    <div className="p-4 rounded-xl bg-dark-850/50 border border-dark-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                          Local Hardware & Unpriced Models (Excluded from Cost Axis)
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {unpriced.length} model{unpriced.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                        {unpriced.map((m) => (
                          <div
                            key={m.model_id}
                            className="p-3 rounded-lg bg-dark-900 border border-dark-750 flex items-center justify-between"
                          >
                            <div>
                              <div className="text-xs font-medium text-slate-200">{m.display_name}</div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                {m.provider_type} • {m.provider_model_id}
                              </div>
                            </div>
                            <div className="text-right font-mono">
                              <div className="text-xs font-semibold text-cyan-300">
                                {m.scorable_accuracy !== null && m.scorable_accuracy !== undefined
                                  ? `${(m.scorable_accuracy * 100).toFixed(1)}%`
                                  : 'N/A'}
                              </div>
                              <div className="text-[10px] text-slate-500">Scorable Acc</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Section 3: Detailed Model-Result Inspection */}
              <div className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                      <Eye className="w-4 h-4 text-brand-400" />
                      Detailed Model-Result Inspector
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Inspect verbatim model prompts, extracted answers, ground truth references, latency, and telemetry.
                    </p>
                  </div>

                  {/* Filter Controls */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Model filter */}
                    <select
                      value={comparisonFilterModel}
                      onChange={(e) => setComparisonFilterModel(e.target.value)}
                      className="bg-dark-850 border border-dark-750 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:border-brand-500 focus:outline-none"
                    >
                      <option value="all">All Models ({comparisonResults.length})</option>
                      {selectedComparisonRun.model_configs?.map((cfg) => {
                        const count = comparisonResults.filter((r) => r.model_id === cfg.model_id).length;
                        return (
                          <option key={cfg.model_id} value={cfg.model_id}>
                            {cfg.display_name} ({count})
                          </option>
                        );
                      })}
                    </select>

                    {/* Outcome filter */}
                    <div className="flex items-center gap-1 bg-dark-850 border border-dark-750 rounded-lg p-0.5 text-xs">
                      {[
                        { id: 'all', label: 'All' },
                        { id: 'correct', label: 'Correct', color: 'text-emerald-400' },
                        { id: 'incorrect', label: 'Incorrect', color: 'text-red-400' },
                        { id: 'unparseable', label: 'Unparseable', color: 'text-amber-400' },
                        { id: 'failed', label: 'Failed', color: 'text-rose-400' },
                      ].map((item) => (
                        <button
                          key={item.id}
                          onClick={() => setComparisonFilterOutcome(item.id)}
                          className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                            comparisonFilterOutcome === item.id
                              ? 'bg-dark-700 text-slate-100 font-semibold'
                              : 'text-slate-400 hover:text-slate-200'
                          } ${item.color || ''}`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>

                    {/* Search box */}
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search records..."
                        value={comparisonSearchText}
                        onChange={(e) => setComparisonSearchText(e.target.value)}
                        className="bg-dark-850 border border-dark-750 text-slate-200 text-xs rounded-lg pl-8 pr-3 py-1.5 focus:border-brand-500 focus:outline-none w-44"
                      />
                    </div>
                  </div>
                </div>

                {/* Filtered records counter */}
                <div className="text-xs text-slate-400 flex items-center justify-between">
                  <span>
                    Showing {filteredComparisonResults.length} of {comparisonResults.length} recorded evaluations
                  </span>
                  {comparisonLoading && (
                    <span className="flex items-center gap-1.5 text-brand-400 text-xs">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      Loading evaluation records...
                    </span>
                  )}
                </div>

                {/* Results List */}
                {filteredComparisonResults.length === 0 ? (
                  <div className="dev-card p-12 text-center border-dark-800">
                    <p className="text-xs text-slate-400">
                      No evaluation results match the active filter criteria.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredComparisonResults.map((res) => {
                      const status = res.evaluation_status || 'unevaluated';
                      const isCorrect = status === 'correct';
                      const isIncorrect = status === 'incorrect';
                      const isUnparseable = status === 'unparseable';
                      const isFailed = status === 'failed';

                      return (
                        <div
                          key={res.id}
                          className={`dev-card p-4 border transition-colors ${
                            isCorrect
                              ? 'border-emerald-900/60 bg-emerald-950/10'
                              : isIncorrect
                              ? 'border-red-900/60 bg-red-950/10'
                              : isUnparseable
                              ? 'border-amber-900/60 bg-amber-950/10'
                              : isFailed
                              ? 'border-rose-900/60 bg-rose-950/10'
                              : 'border-dark-800'
                          }`}
                        >
                          {/* Card Header */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-dark-800/80">
                            <div className="flex flex-wrap items-center gap-2">
                              {/* Status Badge */}
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                                  isCorrect
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                    : isIncorrect
                                    ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                                    : isUnparseable
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                    : isFailed
                                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                    : 'bg-dark-800 text-slate-400'
                                }`}
                              >
                                {isCorrect && <Check className="w-3 h-3 text-emerald-400" />}
                                {isIncorrect && <XCircle className="w-3 h-3 text-red-400" />}
                                {isUnparseable && <HelpCircle className="w-3 h-3 text-amber-400" />}
                                {isFailed && <AlertCircle className="w-3 h-3 text-rose-400" />}
                                <span className="uppercase text-[10px] tracking-wide">{status}</span>
                              </span>

                              {/* Model name & config */}
                              <span className="text-xs font-semibold text-slate-100">
                                {res.model_display_name}
                              </span>
                              <span className="text-[10px] font-mono text-slate-400">
                                ({res.provider_model_id})
                              </span>

                              <span className="text-slate-600">•</span>
                              <span className="text-[11px] font-mono text-slate-400">
                                Record: <strong className="text-slate-300">{res.record_id}</strong>
                              </span>
                            </div>

                            {/* Telemetry metadata */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 font-mono">
                              {res.latency_ms !== null && res.latency_ms !== undefined && (
                                <span className="flex items-center gap-1" title="End-to-end latency">
                                  <Clock className="w-3 h-3 text-slate-500" />
                                  {res.latency_ms}ms
                                </span>
                              )}
                              {res.ttft_ms !== null && res.ttft_ms !== undefined && (
                                <span title="Time to first token">TTFT: {res.ttft_ms}ms</span>
                              )}
                              {res.total_tokens !== null && res.total_tokens !== undefined && (
                                <span title="Prompt + completion tokens">
                                  {res.total_tokens} toks ({res.token_provenance || 'unknown'})
                                </span>
                              )}
                              {res.cost_usd !== null && res.cost_usd !== undefined ? (
                                <span className="text-emerald-400/90" title="Estimated cost">
                                  ${res.cost_usd.toFixed(5)}
                                </span>
                              ) : (
                                <span className="text-slate-500 italic">Cost: Unknown</span>
                              )}
                            </div>
                          </div>

                          {/* Error Banner if any */}
                          {res.error_message && (
                            <div className="mt-3 p-2.5 rounded bg-rose-950/40 border border-rose-800/50 text-xs text-rose-300 flex items-start gap-2">
                              <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                              <span className="font-mono">{res.error_message}</span>
                            </div>
                          )}

                          {/* Evaluation Answer Verification Box */}
                          <div className="mt-3 p-3 rounded-lg bg-dark-900 border border-dark-800 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                            <div>
                              <span className="text-[10px] uppercase font-semibold text-slate-400 block mb-0.5">
                                Ground Truth Reference
                              </span>
                              <span className="font-mono font-semibold text-emerald-400 text-sm">
                                {res.reference_answer || 'N/A'}
                              </span>
                            </div>

                            <div>
                              <span className="text-[10px] uppercase font-semibold text-slate-400 block mb-0.5">
                                Extracted Model Answer
                              </span>
                              <span
                                className={`font-mono font-semibold text-sm ${
                                  isCorrect
                                    ? 'text-emerald-400'
                                    : isIncorrect
                                    ? 'text-red-400'
                                    : 'text-amber-400 italic'
                                }`}
                              >
                                {res.extracted_answer || 'None (Unparseable)'}
                              </span>
                            </div>

                            <div>
                              <span className="text-[10px] uppercase font-semibold text-slate-400 block mb-0.5">
                                Evaluation Method
                              </span>
                              <span className="text-slate-300 text-[11px]">
                                {res.metric_name || 'exact_match_normalized'}
                              </span>
                              {res.evaluation_details?.reason && (
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                  {res.evaluation_details.reason}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Question Prompt */}
                          <div className="mt-3 space-y-1">
                            <span className="text-[11px] font-semibold text-slate-300 block">
                              Question Prompt:
                            </span>
                            <div className="p-2.5 rounded bg-dark-950/80 border border-dark-800 text-xs text-slate-200 whitespace-pre-wrap font-sans leading-relaxed">
                              {res.prompt_text}
                            </div>
                          </div>

                          {/* Verbatim Model Output */}
                          {res.output_text && (
                            <div className="mt-3 space-y-1">
                              <span className="text-[11px] font-semibold text-slate-300 block">
                                Verbatim Model Output:
                              </span>
                              <div className="p-2.5 rounded bg-dark-950/90 border border-dark-800 font-mono text-[11px] text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                                {res.output_text}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
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
                  {resultsModalRun.progress?.completed_items + resultsModalRun.progress?.failed_items || resultsModalData.length} evaluations
                </span>
              </div>
              <button onClick={() => setResultsModalRun(null)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scoring Summary Bar */}
            {resultsModalRun.results_summary?.scorable_accuracy !== undefined && resultsModalRun.results_summary?.scorable_accuracy !== null ? (
              <div className="p-3 border-b border-dark-800 bg-emerald-950/20 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    Scorable Accuracy: {(resultsModalRun.results_summary.scorable_accuracy * 100).toFixed(1)}%
                  </span>
                  <span className="px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">
                    E2E Correct Rate: {resultsModalRun.results_summary.end_to_end_accuracy !== null ? `${(resultsModalRun.results_summary.end_to_end_accuracy * 100).toFixed(1)}%` : 'N/A'}
                  </span>
                  <span className="text-[11px] text-slate-300 font-mono">
                    Correct: <strong>{resultsModalRun.results_summary.total_correct}</strong> • Incorrect: <strong>{resultsModalRun.results_summary.total_incorrect}</strong> • Unparseable: <strong>{resultsModalRun.results_summary.total_unparseable}</strong> • Failed: <strong>{resultsModalRun.results_summary.total_failed}</strong>
                  </span>
                </div>
                <button
                  onClick={() => handleScoreRun(resultsModalRun.id)}
                  disabled={scoringRunId === resultsModalRun.id}
                  className="dev-btn-secondary text-xs px-3 py-1 flex items-center gap-1.5"
                >
                  {scoringRunId === resultsModalRun.id ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <Calculator className="w-3.5 h-3.5" />
                  )}
                  Re-Score Run
                </button>
              </div>
            ) : (
              resultsModalRun.task_type === 'math_reasoning' && (
                <div className="p-3 border-b border-dark-800 bg-amber-950/20 flex items-center justify-between gap-3 text-xs">
                  <span className="text-amber-300 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5" />
                    Model responses captured. Click Score Run to evaluate numerical answers against GSM8K ground truth.
                  </span>
                  <button
                    onClick={() => handleScoreRun(resultsModalRun.id)}
                    disabled={scoringRunId === resultsModalRun.id}
                    className="dev-btn-primary text-xs px-3 py-1 flex items-center gap-1.5"
                  >
                    {scoringRunId === resultsModalRun.id ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Calculator className="w-3.5 h-3.5" />
                    )}
                    Score Run
                  </button>
                </div>
              )
            )}

            {/* Sub-header with search and outcome filters */}
            <div className="p-3 border-b border-dark-800 bg-dark-850/50 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative flex-1 w-full sm:w-auto">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter results by model, prompt, response, or extracted answer..."
                  value={resultsFilterText}
                  onChange={(e) => setResultsFilterText(e.target.value)}
                  className="w-full pl-8 pr-3 py-1 bg-dark-900 border border-dark-750 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-brand-500"
                />
              </div>

              {/* Outcome filter pills */}
              <div className="flex items-center gap-1.5 self-start sm:self-auto overflow-x-auto text-[11px]">
                <button
                  onClick={() => setResultsOutcomeFilter('all')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    resultsOutcomeFilter === 'all'
                      ? 'bg-brand-500/20 text-brand-300 font-semibold border border-brand-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All ({resultsModalData.length})
                </button>
                <button
                  onClick={() => setResultsOutcomeFilter('correct')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    resultsOutcomeFilter === 'correct'
                      ? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Correct ({resultsModalData.filter((r) => r.evaluation_status === 'correct').length})
                </button>
                <button
                  onClick={() => setResultsOutcomeFilter('incorrect')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    resultsOutcomeFilter === 'incorrect'
                      ? 'bg-rose-500/20 text-rose-300 font-semibold border border-rose-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Incorrect ({resultsModalData.filter((r) => r.evaluation_status === 'incorrect').length})
                </button>
                <button
                  onClick={() => setResultsOutcomeFilter('unparseable')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    resultsOutcomeFilter === 'unparseable'
                      ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Unparseable ({resultsModalData.filter((r) => r.evaluation_status === 'unparseable').length})
                </button>
                <button
                  onClick={() => setResultsOutcomeFilter('failed')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    resultsOutcomeFilter === 'failed'
                      ? 'bg-slate-700 text-slate-200 font-semibold border border-slate-600'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Failed ({resultsModalData.filter((r) => r.evaluation_status === 'failed').length})
                </button>
              </div>
            </div>

            {/* Results list */}
            <div className="p-4 overflow-y-auto space-y-4 text-xs flex-1">
              {resultsLoading ? (
                <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-brand-400" />
                  <span>Loading benchmark results...</span>
                </div>
              ) : filteredResults.length === 0 ? (
                <div className="py-12 text-center text-slate-400">No results found matching filter criteria.</div>
              ) : (
                filteredResults.map((res) => {
                  const evalStatus = res.evaluation_status || 'unevaluated';

                  return (
                    <div
                      key={res.id}
                      className="p-3.5 rounded-xl bg-dark-850 border border-dark-800 space-y-2.5 hover:border-dark-750 transition-colors"
                    >
                      <div className="flex flex-wrap items-center justify-between text-[11px] pb-1.5 border-b border-dark-800">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-100 flex items-center gap-1.5">
                            <Cpu className="w-3.5 h-3.5 text-brand-400" />
                            {res.model_display_name}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">({res.provider_model_id})</span>

                          {/* Evaluation Status Badge */}
                          {evalStatus === 'correct' && (
                            <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              CORRECT (Score: 1.0)
                            </span>
                          )}
                          {evalStatus === 'incorrect' && (
                            <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                              <XCircle className="w-3 h-3 text-rose-400" />
                              INCORRECT (Score: 0.0)
                            </span>
                          )}
                          {evalStatus === 'unparseable' && (
                            <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                              <HelpCircle className="w-3 h-3 text-amber-400" />
                              UNPARSEABLE
                            </span>
                          )}
                          {evalStatus === 'failed' && (
                            <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-slate-700 text-slate-300 border border-slate-600 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3 text-slate-400" />
                              FAILED INFERENCE
                            </span>
                          )}
                          {evalStatus === 'unevaluated' && (
                            <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-dark-800 text-slate-400 border border-dark-750">
                              UNEVALUATED
                            </span>
                          )}
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

                      {/* Extracted Answer vs Ground Truth Comparison */}
                      <div className="p-2.5 rounded bg-dark-900/90 border border-dark-800 text-[11px] space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dark-800/80 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase font-semibold text-slate-400">Extracted Model Answer:</span>
                            {res.extracted_answer !== undefined && res.extracted_answer !== null ? (
                              <span className="font-mono font-bold text-amber-300 text-xs px-2 py-0.5 rounded bg-dark-950 border border-dark-750">
                                {res.extracted_answer}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">None (no numerical answer detected)</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase font-semibold text-slate-400">Canonical Ground-Truth Target:</span>
                            <span className="font-mono font-bold text-cyan-300 text-xs px-2 py-0.5 rounded bg-dark-950 border border-dark-750">
                              {res.reference_metadata?.extracted_answer || res.reference_answer}
                            </span>
                          </div>
                        </div>

                        <div>
                          <span className="text-[10px] uppercase font-semibold text-slate-400 block mb-0.5">
                            Canonical Reference Solution:
                          </span>
                          <p className="text-slate-300 text-[11px] whitespace-pre-wrap">{res.reference_answer}</p>
                        </div>
                      </div>
                    </div>
                  );
                })
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
