import React, { useState } from 'react';
import {
  Search,
  RotateCcw,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { HuggingFaceDiscoveredModel, ModelTemplate } from '../../types';
import { searchHuggingFaceHub } from '../../services/api';
import { ModelCard } from './ModelCard';
import { Button } from '../ui/Button';

interface HuggingFaceSearchProps {
  onAddModel: (model: HuggingFaceDiscoveredModel | ModelTemplate) => void;
  existingModelIds: string[];
}

export const HuggingFaceSearch: React.FC<HuggingFaceSearchProps> = ({
  onAddModel,
  existingModelIds,
}) => {
  const [query, setQuery] = useState('');
  const [task, setTask] = useState('text-generation');
  const [permissiveOnly, setPermissiveOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<HuggingFaceDiscoveredModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const quickSearchTags = ['Qwen 2.5', 'Llama 3.1', 'DeepSeek', 'Phi-3.5', 'Mistral'];

  const executeSearch = async (searchQuery: string, forceRefresh: boolean = false) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setError(null);
      setHasSearched(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const resp = await searchHuggingFaceHub(searchQuery.trim(), task, 24, forceRefresh);
      if (resp.error) {
        setError(resp.error);
        setResults([]);
      } else {
        setResults(resp.models || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to search Hugging Face Hub. Please check connection and retry.');
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch(query);
  };

  const handleQuickTagClick = (tag: string) => {
    setQuery(tag);
    executeSearch(tag);
  };

  const filteredResults = permissiveOnly
    ? results.filter((m) => {
        const lic = m.license.toLowerCase();
        return lic.includes('apache') || lic.includes('mit') || lic.includes('bsd');
      })
    : results;

  return (
    <div className="space-y-6">
      {/* Search Header and Input */}
      <div className="dev-card p-5 bg-dark-900/90 border-dark-750">
        <form onSubmit={handleSearchSubmit} className="space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Hugging Face Hub by repository ID, name, or keyword (e.g. qwen, deepseek, llama)..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-dark-850 border border-dark-700 text-slate-100 placeholder-slate-500 text-sm focus:border-brand-500 focus:outline-none transition-colors"
              />
            </div>

            {/* Task Filter */}
            <div className="flex items-center gap-2">
              <select
                value={task}
                onChange={(e) => {
                  setTask(e.target.value);
                  if (query) executeSearch(query);
                }}
                className="px-3 py-2.5 rounded-xl bg-dark-850 border border-dark-700 text-slate-300 text-xs focus:border-brand-500 focus:outline-none"
              >
                <option value="text-generation">Task: Text Generation</option>
                <option value="conversational">Task: Conversational</option>
              </select>

              <Button
                type="submit"
                variant="primary"
                loading={isLoading}
                icon={<Search className="w-4 h-4" />}
              >
                Search Hub
              </Button>
            </div>
          </div>

          {/* Quick Filter Tags & Permissive Checkbox */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-slate-400 text-[11px]">Popular searches:</span>
              {quickSearchTags.map((tag) => (
                <button
                  type="button"
                  key={tag}
                  onClick={() => handleQuickTagClick(tag)}
                  className="px-2.5 py-1 rounded-md bg-dark-800 hover:bg-dark-750 text-slate-300 border border-dark-700 text-[11px] transition-colors"
                >
                  {tag}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-2 text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={permissiveOnly}
                onChange={(e) => setPermissiveOnly(e.target.checked)}
                className="rounded bg-dark-800 border-dark-700 text-brand-600 focus:ring-0"
              />
              <span className="text-[11px]">Permissive licenses only (Apache / MIT / BSD)</span>
            </label>
          </div>
        </form>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="dev-card p-12 text-center flex flex-col items-center justify-center">
          <div className="w-10 h-10 border-2 border-brand-500/20 border-t-brand-500 rounded-full animate-spin mb-4" />
          <h4 className="text-sm font-semibold text-slate-200">Querying Hugging Face Hub...</h4>
          <p className="text-xs text-slate-400 mt-1">Retrieving verified licenses, gated flags, and provider compatibility.</p>
        </div>
      )}

      {/* Error / Rate Limit State with Retry */}
      {!isLoading && error && (
        <div className="dev-card p-8 border-amber-500/30 bg-amber-500/5 text-center flex flex-col items-center justify-center max-w-xl mx-auto">
          <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400 mb-3">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h4 className="text-sm font-semibold text-slate-100">Hub Discovery Notice</h4>
          <p className="text-xs text-slate-300 mt-2 mb-4 leading-relaxed">{error}</p>
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={() => executeSearch(query, true)}
          >
            Retry Hugging Face Query
          </Button>
        </div>
      )}

      {/* Search Results Grid */}
      {!isLoading && !error && hasSearched && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-slate-400">
              Found <strong className="text-slate-200">{filteredResults.length}</strong> models matching "
              <span className="text-brand-300">{query}</span>"
              {permissiveOnly && ' (filtered to permissive licenses)'}
            </p>
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw className="w-3 h-3" />}
              onClick={() => executeSearch(query, true)}
              title="Refresh cached Hub results"
            >
              Refresh
            </Button>
          </div>

          {filteredResults.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredResults.map((model) => (
                <ModelCard
                  key={model.repo_id}
                  model={model}
                  isAlreadyAdded={existingModelIds.includes(model.repo_id)}
                  onAdd={() => onAddModel(model)}
                />
              ))}
            </div>
          ) : (
            <div className="dev-card p-12 text-center text-slate-400">
              <p className="text-sm">No models found matching your search criteria.</p>
              <p className="text-xs mt-1 text-slate-500">Try searching for generic family names like "llama", "qwen", or "mistral".</p>
            </div>
          )}
        </div>
      )}

      {/* Initial Empty State when no query entered */}
      {!isLoading && !hasSearched && !error && (
        <div className="dev-card p-10 border-dashed border-dark-750 text-center flex flex-col items-center">
          <div className="w-12 h-12 rounded-2xl bg-brand-500/10 flex items-center justify-center text-brand-400 mb-3">
            <Sparkles className="w-6 h-6" />
          </div>
          <h4 className="text-base font-semibold text-slate-100">Search 100,000+ Hugging Face Models</h4>
          <p className="text-xs text-slate-400 max-w-md mt-1 mb-4 leading-relaxed">
            Search the public Hugging Face Hub for open weights, instruction-tuned checkpoints, and distilled reasoning models. Verified metadata is extracted without downloading weight files.
          </p>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            {quickSearchTags.map((tag) => (
              <Button
                key={tag}
                size="sm"
                variant="outline"
                onClick={() => handleQuickTagClick(tag)}
              >
                Explore {tag}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
