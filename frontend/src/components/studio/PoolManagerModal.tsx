import React, { useState } from 'react';
import { RoutingPool, WorkspaceModel } from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Layers, Plus, Trash2, Edit2, Check, ShieldAlert } from 'lucide-react';
import { Badge } from '../ui/Badge';

interface PoolManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  pools: RoutingPool[];
  models: WorkspaceModel[];
  onCreatePool: (name: string, description: string) => Promise<void>;
  onRenamePool: (id: string, newName: string, newDesc: string) => Promise<void>;
  onDeletePool: (id: string) => Promise<void>;
  onToggleModelInPool: (modelId: string, poolId: string) => Promise<void>;
}

export const PoolManagerModal: React.FC<PoolManagerModalProps> = ({
  isOpen,
  onClose,
  pools,
  models,
  onCreatePool,
  onRenamePool,
  onDeletePool,
  onToggleModelInPool,
}) => {
  const [selectedPoolId, setSelectedPoolId] = useState<string>(pools[0]?.id || '');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newPoolName, setNewPoolName] = useState('');
  const [newPoolDesc, setNewPoolDesc] = useState('');
  const [editingPoolId, setEditingPoolId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activePool = pools.find((p) => p.id === selectedPoolId) || pools[0];

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPoolName.trim()) {
      setErrorMessage('Pool name cannot be empty.');
      return;
    }
    try {
      await onCreatePool(newPoolName.trim(), newPoolDesc.trim());
      setNewPoolName('');
      setNewPoolDesc('');
      setIsCreatingNew(false);
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create pool.');
    }
  };

  const startEditing = (pool: RoutingPool) => {
    setEditingPoolId(pool.id);
    setEditName(pool.name);
    setEditDesc(pool.description || '');
  };

  const saveEdit = async (poolId: string) => {
    if (!editName.trim()) return;
    try {
      await onRenamePool(poolId, editName.trim(), editDesc.trim());
      setEditingPoolId(null);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to rename pool.');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Manage Routing Pools"
      subtitle="Define model clusters for cost-optimized, quality-focused, or local execution policies."
      maxWidth="2xl"
    >
      <div className="space-y-4">
        {errorMessage && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Layout: Sidebar for pools, Content for pool models */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[380px]">
          {/* Pools Sidebar */}
          <div className="border border-dark-800 rounded-xl p-3 bg-dark-850/50 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center justify-between pb-2 border-b border-dark-800">
                <span className="text-xs font-semibold text-slate-300">Routing Pools</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="p-1 h-auto text-brand-400 hover:text-brand-300"
                  icon={<Plus className="w-3.5 h-3.5" />}
                  onClick={() => setIsCreatingNew(!isCreatingNew)}
                >
                  New
                </Button>
              </div>

              {/* Pool Creation Form */}
              {isCreatingNew && (
                <form onSubmit={handleCreateSubmit} className="p-2.5 rounded-lg bg-dark-900 border border-brand-500/30 space-y-2">
                  <input
                    type="text"
                    required
                    placeholder="Pool name (e.g. Coding)"
                    value={newPoolName}
                    onChange={(e) => setNewPoolName(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs rounded bg-dark-800 border border-dark-700 text-slate-100 focus:outline-none focus:border-brand-500"
                  />
                  <input
                    type="text"
                    placeholder="Description (optional)"
                    value={newPoolDesc}
                    onChange={(e) => setNewPoolDesc(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs rounded bg-dark-800 border border-dark-700 text-slate-100 focus:outline-none focus:border-brand-500"
                  />
                  <div className="flex items-center justify-end gap-1.5">
                    <Button size="sm" variant="ghost" type="button" onClick={() => setIsCreatingNew(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="primary" type="submit">
                      Create
                    </Button>
                  </div>
                </form>
              )}

              {/* Pool List */}
              <div className="space-y-1">
                {pools.map((pool) => {
                  const isSelected = activePool?.id === pool.id;
                  const isEditing = editingPoolId === pool.id;

                  if (isEditing) {
                    return (
                      <div key={pool.id} className="p-2 rounded-lg bg-dark-900 border border-dark-700 space-y-1.5">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-2 py-1 text-xs rounded bg-dark-800 border border-dark-600 text-slate-100"
                        />
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditingPoolId(null)}>
                            Cancel
                          </Button>
                          <Button size="sm" variant="primary" onClick={() => saveEdit(pool.id)}>
                            <Check className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  const poolModelCount = models.filter((m) => m.assigned_pool_ids.includes(pool.id)).length;

                  return (
                    <div
                      key={pool.id}
                      onClick={() => setSelectedPoolId(pool.id)}
                      className={`group flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-brand-500/15 border border-brand-500/40 text-brand-200'
                          : 'hover:bg-dark-800 text-slate-300'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold truncate">{pool.name}</span>
                          {pool.is_default && (
                            <span className="text-[9px] uppercase px-1 rounded bg-dark-800 text-slate-400">Default</span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500">{poolModelCount} models</span>
                      </div>

                      <div className="hidden group-hover:flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditing(pool);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-200"
                          title="Rename pool"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        {pools.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Delete pool "${pool.name}"? Models assigned will remain in workspace.`)) {
                                onDeletePool(pool.id);
                              }
                            }}
                            className="p-1 text-rose-400 hover:text-rose-300"
                            title="Delete pool"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="text-[11px] text-slate-500 pt-3 border-t border-dark-800">
              Models can belong to multiple pools concurrently.
            </div>
          </div>

          {/* Active Pool Model Membership */}
          <div className="md:col-span-2 border border-dark-800 rounded-xl p-4 bg-dark-900/60 flex flex-col justify-between">
            {activePool ? (
              <div>
                <div className="mb-4">
                  <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-brand-400" />
                    {activePool.name} Pool
                  </h4>
                  {activePool.description && (
                    <p className="text-xs text-slate-400 mt-1">{activePool.description}</p>
                  )}
                </div>

                <div className="text-xs font-semibold text-slate-400 mb-2">
                  Select models to include in this routing pool:
                </div>

                <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                  {models.length > 0 ? (
                    models.map((model) => {
                      const isMember = model.assigned_pool_ids.includes(activePool.id);
                      return (
                        <div
                          key={model.id}
                          onClick={() => onToggleModelInPool(model.id, activePool.id)}
                          className={`p-3 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-all ${
                            isMember
                              ? 'bg-dark-800 border-brand-500/40 text-slate-100'
                              : 'bg-dark-850/60 border-dark-800 text-slate-400 hover:border-dark-700'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-200">{model.display_name}</span>
                              <Badge
                                variant={model.execution_location === 'local' ? 'info' : 'brand'}
                                className="text-[10px] py-0"
                              >
                                {model.execution_location}
                              </Badge>
                            </div>
                            <span className="text-[10px] font-mono text-slate-400 truncate block">
                              {model.provider_model_id}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isMember}
                              onChange={() => onToggleModelInPool(model.id, activePool.id)}
                              className="rounded bg-dark-900 border-dark-700 text-brand-600 focus:ring-0 cursor-pointer"
                            />
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center p-8 text-slate-500 text-xs">
                      No models in workspace yet. Add models from Hugging Face or templates first.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-slate-500 text-xs">Select or create a pool.</div>
            )}

            <div className="pt-3 border-t border-dark-800 flex justify-end">
              <Button size="sm" variant="secondary" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
