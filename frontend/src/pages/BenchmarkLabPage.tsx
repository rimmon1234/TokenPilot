import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import {
  DatasetTemplate,
  DatasetManifest,
  DatasetRecord,
  DatasetEvaluationRole,
} from '../types';

import {
  fetchDatasetTemplates,
  fetchImportedDatasets,
  fetchDatasetRecords,
  importDataset,
  deleteImportedDataset,
} from '../services/dataset_service';

export const BenchmarkLabPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'templates' | 'imported'>('templates');
  const [templates, setTemplates] = useState<DatasetTemplate[]>([]);
  const [importedDatasets, setImportedDatasets] = useState<DatasetManifest[]>([]);
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

  const loadData = async () => {
    setLoading(true);
    setErrorBanner(null);
    try {
      const [tmplData, importedData] = await Promise.all([
        fetchDatasetTemplates(),
        fetchImportedDatasets(),
      ]);
      setTemplates(tmplData);
      setImportedDatasets(importedData);

      // Initialize config states
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
      setErrorBanner(err.message || 'Failed to load dataset registry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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

      // Refresh imported datasets list
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

  const filteredModalRecords = recordsModalData.filter((r) => {
    if (!recordFilterText.trim()) return true;
    const term = recordFilterText.toLowerCase();
    const promptText = r.input_messages[0]?.content?.toLowerCase() || '';
    const ansText = r.reference_answer?.toLowerCase() || '';
    const idText = r.record_id.toLowerCase();
    return promptText.includes(term) || ansText.includes(term) || idText.includes(term);
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="pb-4 border-b border-dark-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
            <FlaskConical className="w-6 h-6 text-brand-400" />
            Benchmark Lab & Dataset Registry
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Reproducible ground-truth dataset registry and prompt import pipeline (Milestone M4.1).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="dev-btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"
            title="Refresh templates and imported datasets"
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
          <span className="font-semibold text-cyan-300">Milestone M4.1 Notice:</span> Importing a benchmark dataset creates an auditable, canonical prompt set for standardized evaluation. Models remain marked as{' '}
          <span className="inline-block px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 font-mono text-[10px] border border-amber-500/20">
            unbenchmarked
          </span>{' '}
          until automated benchmark evaluation runs are executed (arriving in Milestone M4.2). No model scores or latency numbers are simulated.
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

      {/* Tabs */}
      <div className="flex items-center gap-3 border-b border-dark-800">
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
      </div>

      {/* TAB 1: DATASET TEMPLATES */}
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
                    {/* Header */}
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

                    {/* Metadata chips */}
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

                    {/* Import Configuration Form */}
                    <div className="space-y-3 pt-2 border-t border-dark-800">
                      <div className="grid grid-cols-2 gap-3">
                        {/* Split selection */}
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

                        {/* Evaluation Role */}
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

                      {/* Subset Limit */}
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

                    {/* Inline Error Message */}
                    {cfg.error && (
                      <div className="p-2 rounded bg-red-950/40 border border-red-800/50 text-[11px] text-red-300 flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                        <span>{cfg.error}</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
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

      {/* TAB 2: IMPORTED DATASETS */}
      {activeTab === 'imported' && (
        <div className="space-y-4">
          {importedDatasets.length === 0 ? (
            <div className="dev-card p-12 text-center max-w-xl mx-auto border-dashed border-dark-750">
              <Database className="w-10 h-10 text-slate-500 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-slate-200">No Benchmark Datasets Imported Yet</h3>
              <p className="text-xs text-slate-400 mt-1 mb-5 leading-relaxed">
                Import GSM8K or HumanEval prompts from the templates registry to establish reproducible test fixtures for upcoming evaluation runs.
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

      {/* MODAL 1: TEMPLATE SAMPLE PREVIEW MODAL */}
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

      {/* MODAL 2: CANONICAL RECORDS VIEWER */}
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
    </div>
  );
};
