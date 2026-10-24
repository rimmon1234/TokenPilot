import React, { useState } from 'react';
import {
  MessageSquare,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Search,
  Shield,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Conversation } from '../../types';

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, newTitle: string) => void;
  onDelete: (id: string) => void;
  retainPrompts: boolean;
  onToggleRetention: () => void;
  isOpen: boolean;
  onClose?: () => void;
}

export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  retainPrompts,
  onToggleRetention,
  isOpen,
  onClose,
}) => {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleStartEdit = (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const handleSaveEdit = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (editTitle.trim()) {
      onRename(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeletingId(id);
  };

  const handleConfirmDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    onDelete(id);
    setDeletingId(null);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(null);
  };

  const formatTimestamp = (iso: string) => {
    try {
      const date = new Date(iso);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      if (isToday) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <div
      className={`flex flex-col bg-dark-900 border border-dark-800 rounded-xl overflow-hidden transition-all duration-200 ${
        isOpen ? 'w-full lg:w-72 h-[620px] max-h-[820px]' : 'hidden lg:flex lg:w-72 h-[620px] max-h-[820px]'
      }`}
    >
      {/* Top Header & New Chat */}
      <div className="p-3 border-b border-dark-800 space-y-2.5 bg-dark-850/80">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-brand-400" />
            Conversations ({conversations.length})
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="lg:hidden text-slate-400 hover:text-slate-200 text-xs p-1"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <Button
          size="sm"
          variant="primary"
          className="w-full justify-center"
          icon={<Plus className="w-3.5 h-3.5" />}
          onClick={onNewChat}
        >
          New Conversation
        </Button>

        {conversations.length > 3 && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats..."
              className="w-full py-1.5 pl-8 pr-2.5 rounded-lg bg-dark-800 border border-dark-700 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-brand-500"
            />
          </div>
        )}
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 divide-y divide-dark-800/40">
        {filtered.length === 0 ? (
          <div className="text-center py-10 px-4 text-slate-400">
            <Sparkles className="w-6 h-6 text-brand-400/40 mx-auto mb-2" />
            <p className="text-xs">
              {search ? 'No matching conversations' : 'No previous chats'}
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              Start chatting in the playground to record history and metrics.
            </p>
          </div>
        ) : (
          filtered.map((conv) => {
            const isActive = conv.id === activeId;
            const isEditing = editingId === conv.id;
            const isDeleting = deletingId === conv.id;

            return (
              <div
                key={conv.id}
                onClick={() => !isEditing && onSelect(conv.id)}
                className={`group relative p-2.5 rounded-lg text-xs cursor-pointer transition-all border ${
                  isActive
                    ? 'bg-brand-500/10 border-brand-500/40 text-slate-100'
                    : 'bg-dark-850/40 hover:bg-dark-800/60 border-transparent text-slate-300 hover:text-slate-100'
                }`}
              >
                {isEditing ? (
                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(e as any, conv.id);
                        if (e.key === 'Escape') handleCancelEdit(e as any);
                      }}
                      autoFocus
                      className="flex-1 bg-dark-800 border border-brand-500 rounded px-1.5 py-0.5 text-xs text-slate-100 focus:outline-none"
                    />
                    <button
                      onClick={(e) => handleSaveEdit(e, conv.id)}
                      className="p-1 hover:text-emerald-400 text-slate-400"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="p-1 hover:text-rose-400 text-slate-400"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : isDeleting ? (
                  <div
                    className="p-1.5 bg-rose-950/40 border border-rose-800/60 rounded flex items-center justify-between gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-[10px] text-rose-300">Delete chat?</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => handleConfirmDelete(e, conv.id)}
                        className="px-1.5 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px]"
                      >
                        Yes
                      </button>
                      <button
                        onClick={handleCancelDelete}
                        className="px-1.5 py-0.5 bg-dark-700 hover:bg-dark-600 text-slate-300 rounded text-[10px]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <span className="font-medium truncate flex-1 block" title={conv.title}>
                        {conv.title}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {formatTimestamp(conv.updated_at)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                      <span className="truncate max-w-[140px]" title={conv.model_display_name_snapshot || 'Model'}>
                        {conv.model_display_name_snapshot || 'Model'}
                      </span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => handleStartEdit(e, conv)}
                          title="Rename conversation"
                          className="p-1 hover:text-brand-300 text-slate-400"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteClick(e, conv.id)}
                          title="Delete conversation"
                          className="p-1 hover:text-rose-400 text-slate-400"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Retention & Privacy Footer */}
      <div className="p-2.5 border-t border-dark-800 bg-dark-850/90 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {retainPrompts ? (
              <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            )}
            <div>
              <span className="text-[11px] font-medium text-slate-200 block">
                Prompt Retention
              </span>
              <span className="text-[9px] text-slate-400 block">
                {retainPrompts ? 'Prompts saved locally' : 'Raw prompts excluded'}
              </span>
            </div>
          </div>

          <button
            onClick={onToggleRetention}
            className={`text-[10px] px-2 py-1 rounded font-medium transition-colors ${
              retainPrompts
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20'
            }`}
          >
            {retainPrompts ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </div>
    </div>
  );
};
