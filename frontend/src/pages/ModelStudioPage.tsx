import React, { useState, useEffect, useMemo } from 'react';
import {
  Cpu,
  Layers,
  Plus,
  Search,
  Sparkles,
  SlidersHorizontal,
  HardDrive,
  ShieldCheck,
} from 'lucide-react';
import {
  WorkspaceModel,
  RoutingPool,
  ModelTemplate,
  HuggingFaceDiscoveredModel,
} from '../types';
import { workspaceRepo } from '../storage/indexeddb_repository';
import { fetchModelTemplates, fetchDefaultPools } from '../services/api';
import { WorkspaceModelCard } from '../components/studio/WorkspaceModelCard';
import { ModelCard } from '../components/studio/ModelCard';
import { HuggingFaceSearch } from '../components/studio/HuggingFaceSearch';
import { ConfigureModelModal } from '../components/studio/ConfigureModelModal';
import { AddCustomModelModal } from '../components/studio/AddCustomModelModal';
import { PoolManagerModal } from '../components/studio/PoolManagerModal';
import { Button } from '../components/ui/Button';

export const ModelStudioPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'workspace' | 'hf_search' | 'templates'>('workspace');
  const [workspaceModels, setWorkspaceModels] = useState<WorkspaceModel[]>([]);
  const [routingPools, setRoutingPools] = useState<RoutingPool[]>([]);
  const [templates, setTemplates] = useState<ModelTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [selectedPoolFilter, setSelectedPoolFilter] = useState<string>('all');
  const [searchWorkspaceQuery, setSearchWorkspaceQuery] = useState('');

  // Modals
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [modelToConfigure, setModelToConfigure] = useState<
    WorkspaceModel | HuggingFaceDiscoveredModel | ModelTemplate | null
  >(null);
  const [isEditingExisting, setIsEditingExisting] = useState(false);

  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [isPoolModalOpen, setIsPoolModalOpen] = useState(false);

  // Load initial workspace state from IndexedDB
  const loadWorkspaceData = async () => {
    setIsLoading(true);
    try {
      const isInit = await workspaceRepo.isInitialized();
      let pools = await workspaceRepo.getRoutingPools();
      let models = await workspaceRepo.getWorkspaceModels();

      if (!isInit && pools.length === 0) {
        // First run: initialize default pools from API or fallback
        const defaultPoolsData = await fetchDefaultPools();
        const createdPools: RoutingPool[] = defaultPoolsData.map((p, idx) => ({
          id: `pool-${p.name.toLowerCase().replace(/\s+/g, '-')}-${idx}`,
          name: p.name,
          description: p.description,
          is_default: p.is_default,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));

        for (const pool of createdPools) {
          await workspaceRepo.saveRoutingPool(pool);
        }
        pools = createdPools;
        await workspaceRepo.setInitialized();
      }

      setRoutingPools(pools);
      setWorkspaceModels(models);

      // Load curated templates from API
      const tmpls = await fetchModelTemplates();
      setTemplates(tmpls);
    } catch (err) {
      console.error('Error loading workspace:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspaceData();
  }, []);

  // Filtered workspace models
  const filteredWorkspaceModels = useMemo(() => {
    return workspaceModels.filter((model) => {
      const matchesPool =
        selectedPoolFilter === 'all' || model.assigned_pool_ids.includes(selectedPoolFilter);
      const matchesSearch =
        searchWorkspaceQuery.trim() === '' ||
        model.display_name.toLowerCase().includes(searchWorkspaceQuery.toLowerCase()) ||
        model.provider_model_id.toLowerCase().includes(searchWorkspaceQuery.toLowerCase());
      return matchesPool && matchesSearch;
    });
  }, [workspaceModels, selectedPoolFilter, searchWorkspaceQuery]);

  // Model actions
  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    const model = workspaceModels.find((m) => m.id === id);
    if (!model) return;
    const updated = { ...model, enabled, updated_at: new Date().toISOString() };
    await workspaceRepo.saveWorkspaceModel(updated);
    setWorkspaceModels((prev) => prev.map((m) => (m.id === id ? updated : m)));
  };

  const handleEditModel = (model: WorkspaceModel) => {
    setModelToConfigure(model);
    setIsEditingExisting(true);
    setIsConfigModalOpen(true);
  };

  const handleDeleteModel = async (id: string) => {
    if (confirm('Remove this model from your workspace? Historical request analytics will be preserved.')) {
      await workspaceRepo.deleteWorkspaceModel(id);
      setWorkspaceModels((prev) => prev.filter((m) => m.id !== id));
    }
  };

  const handleSaveModel = async (model: WorkspaceModel) => {
    await workspaceRepo.saveWorkspaceModel(model);
    setWorkspaceModels((prev) => {
      const exists = prev.some((m) => m.id === model.id);
      if (exists) {
        return prev.map((m) => (m.id === model.id ? model : m));
      }
      return [model, ...prev];
    });
  };

  const handleOpenConfigureForTemplate = (item: HuggingFaceDiscoveredModel | ModelTemplate) => {
    setModelToConfigure(item);
    setIsEditingExisting(false);
    setIsConfigModalOpen(true);
  };

  // Pool management handlers
  const handleCreatePool = async (name: string, description: string) => {
    const newPool: RoutingPool = {
      id: `pool-${Date.now()}`,
      name,
      description: description || undefined,
      is_default: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await workspaceRepo.saveRoutingPool(newPool);
    setRoutingPools((prev) => [...prev, newPool]);
  };

  const handleRenamePool = async (id: string, newName: string, newDesc: string) => {
    const existing = routingPools.find((p) => p.id === id);
    if (!existing) return;
    const updated: RoutingPool = {
      ...existing,
      name: newName,
      description: newDesc,
      updated_at: new Date().toISOString(),
    };
    await workspaceRepo.saveRoutingPool(updated);
    setRoutingPools((prev) => prev.map((p) => (p.id === id ? updated : p)));
  };

  const handleDeletePool = async (id: string) => {
    await workspaceRepo.deleteRoutingPool(id);
    setRoutingPools((prev) => prev.filter((p) => p.id !== id));
    // Remove from models assigned_pool_ids
    const updatedModels = workspaceModels.map((m) => {
      if (m.assigned_pool_ids.includes(id)) {
        const newIds = m.assigned_pool_ids.filter((pId) => pId !== id);
        const updated = { ...m, assigned_pool_ids: newIds, updated_at: new Date().toISOString() };
        workspaceRepo.saveWorkspaceModel(updated);
        return updated;
      }
      return m;
    });
    setWorkspaceModels(updatedModels);
    if (selectedPoolFilter === id) setSelectedPoolFilter('all');
  };

  const handleToggleModelInPool = async (modelId: string, poolId: string) => {
    const model = workspaceModels.find((m) => m.id === modelId);
    if (!model) return;
    const isMember = model.assigned_pool_ids.includes(poolId);
    const newPoolIds = isMember
      ? model.assigned_pool_ids.filter((p) => p !== poolId)
      : [...model.assigned_pool_ids, poolId];
    const updated = { ...model, assigned_pool_ids: newPoolIds, updated_at: new Date().toISOString() };
    await workspaceRepo.saveWorkspaceModel(updated);
    setWorkspaceModels((prev) => prev.map((m) => (m.id === modelId ? updated : m)));
  };

  const existingModelIds = workspaceModels.map((m) => m.provider_model_id);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-dark-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
            <Cpu className="w-6 h-6 text-brand-400" />
            Model Studio
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Configure local runtimes, search Hugging Face Hub models, and assign models to dynamic routing pools.
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <Button
            size="sm"
            variant="secondary"
            icon={<Layers className="w-4 h-4 text-brand-400" />}
            onClick={() => setIsPoolModalOpen(true)}
          >
            Manage Pools ({routingPools.length})
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setIsCustomModalOpen(true)}
          >
            Add Custom Model
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-dark-800">
        <button
          onClick={() => setActiveTab('workspace')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'workspace'
              ? 'border-brand-500 text-brand-300 bg-brand-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <HardDrive className="w-4 h-4" />
          Active Workspace Models ({workspaceModels.length})
        </button>

        <button
          onClick={() => setActiveTab('hf_search')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'hf_search'
              ? 'border-brand-500 text-brand-300 bg-brand-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Search className="w-4 h-4" />
          Hugging Face Hub Discovery
        </button>

        <button
          onClick={() => setActiveTab('templates')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'templates'
              ? 'border-brand-500 text-brand-300 bg-brand-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Curated Suggestions ({templates.length})
        </button>
      </div>

      {/* TAB 1: ACTIVE WORKSPACE MODELS */}
      {activeTab === 'workspace' && (
        isLoading ? (
          <div className="dev-card p-12 text-center flex flex-col items-center justify-center">
            <div className="w-8 h-8 border-2 border-brand-500/20 border-t-brand-500 rounded-full animate-spin mb-3" />
            <p className="text-xs text-slate-400">Loading workspace from IndexedDB...</p>
          </div>
        ) : (
        <div className="space-y-4">
          {/* Controls Bar: Filter by Pool, Search in workspace */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <SlidersHorizontal className="w-3.5 h-3.5" /> Pool:
              </span>
              <button
                onClick={() => setSelectedPoolFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  selectedPoolFilter === 'all'
                    ? 'bg-brand-500/20 border-brand-500 text-brand-300'
                    : 'bg-dark-850 border-dark-750 text-slate-400 hover:text-slate-200'
                }`}
              >
                All Pools ({workspaceModels.length})
              </button>
              {routingPools.map((pool) => {
                const count = workspaceModels.filter((m) => m.assigned_pool_ids.includes(pool.id)).length;
                return (
                  <button
                    key={pool.id}
                    onClick={() => setSelectedPoolFilter(pool.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      selectedPoolFilter === pool.id
                        ? 'bg-brand-500/20 border-brand-500 text-brand-300'
                        : 'bg-dark-850 border-dark-750 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {pool.name} ({count})
                  </button>
                );
              })}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchWorkspaceQuery}
                onChange={(e) => setSearchWorkspaceQuery(e.target.value)}
                placeholder="Filter workspace models..."
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-dark-850 border border-dark-750 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          {/* Model Cards Grid */}
          {filteredWorkspaceModels.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredWorkspaceModels.map((model) => (
                <WorkspaceModelCard
                  key={model.id}
                  model={model}
                  allPools={routingPools}
                  onToggleEnabled={handleToggleEnabled}
                  onEdit={handleEditModel}
                  onDelete={handleDeleteModel}
                />
              ))}
            </div>
          ) : (
            <div className="dev-card p-12 text-center border-dashed border-dark-750">
              <Cpu className="w-10 h-10 text-slate-500 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-slate-200">No models in workspace</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1 mb-4">
                Add models from Hugging Face Hub, select curated suggestions, or register a local Ollama/vLLM server.
              </p>
              <div className="flex items-center justify-center gap-3">
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Search className="w-3.5 h-3.5" />}
                  onClick={() => setActiveTab('hf_search')}
                >
                  Search Hugging Face Hub
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Sparkles className="w-3.5 h-3.5" />}
                  onClick={() => setActiveTab('templates')}
                >
                  Browse Curated Suggestions
                </Button>
              </div>
            </div>
          )}
        </div>
        )
      )}

      {/* TAB 2: HUGGING FACE DISCOVERY */}
      {activeTab === 'hf_search' && (
        <HuggingFaceSearch
          onAddModel={handleOpenConfigureForTemplate}
          existingModelIds={existingModelIds}
        />
      )}

      {/* TAB 3: CURATED TEMPLATES */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-dark-850 border border-dark-800 text-xs text-slate-300 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Suggestions are populated with verified licenses, context windows, and token pricing baselines.
            </span>
            <span className="text-[11px] text-slate-400">Clicking "Add" creates an independent workspace copy</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((tmpl) => (
              <ModelCard
                key={tmpl.id}
                model={tmpl}
                isTemplate={true}
                isAlreadyAdded={existingModelIds.includes(tmpl.provider_model_id)}
                onAdd={handleOpenConfigureForTemplate}
              />
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      <ConfigureModelModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        initialModel={modelToConfigure}
        isEditingExisting={isEditingExisting}
        allPools={routingPools}
        onSave={handleSaveModel}
      />

      <AddCustomModelModal
        isOpen={isCustomModalOpen}
        onClose={() => setIsCustomModalOpen(false)}
        allPools={routingPools}
        onSave={handleSaveModel}
      />

      <PoolManagerModal
        isOpen={isPoolModalOpen}
        onClose={() => setIsPoolModalOpen(false)}
        pools={routingPools}
        models={workspaceModels}
        onCreatePool={handleCreatePool}
        onRenamePool={handleRenamePool}
        onDeletePool={handleDeletePool}
        onToggleModelInPool={handleToggleModelInPool}
      />
    </div>
  );
};
