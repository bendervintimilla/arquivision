import React, { useState } from 'react';
import { DBConversation, deleteConversation, updateConversation } from '../services/conversationService';

interface ConversationSidebarProps {
  conversations: DBConversation[];
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onRefresh: () => void;
  isOpen: boolean;
  onClose: () => void;
}

export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onRefresh,
  isOpen,
  onClose,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const handleRename = async (id: string) => {
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await updateConversation(id, { title: editTitle.trim() });
      setEditingId(null);
      onRefresh();
    } catch (e) {
      console.error('Rename failed:', e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteConversation(id);
      onRefresh();
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed left-0 top-0 bottom-0 w-80 bg-slate-900 border-r border-slate-800 z-50 transform transition-transform duration-300 flex flex-col
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-sm font-black text-slate-300 uppercase tracking-widest">Projects</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onNewConversation}
              className="p-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-all"
              title="New Project"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-white rounded-lg transition-all"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-grow overflow-y-auto custom-scrollbar">
          {conversations.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-slate-600 text-sm">No projects yet</p>
              <button
                onClick={onNewConversation}
                className="mt-3 text-emerald-400 hover:text-emerald-300 text-sm font-medium"
              >
                Start your first project
              </button>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`group relative rounded-xl p-3 cursor-pointer transition-all
                    ${currentConversationId === conv.id
                      ? 'bg-emerald-500/10 border border-emerald-500/20'
                      : 'hover:bg-slate-800/50 border border-transparent'
                    }`}
                  onClick={() => {
                    if (editingId !== conv.id) {
                      onSelectConversation(conv.id);
                      onClose();
                    }
                  }}
                >
                  {editingId === conv.id ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => handleRename(conv.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(conv.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white outline-none focus:border-emerald-500"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-medium text-slate-200 truncate flex-grow">
                          {conv.title}
                        </h3>
                        <span className="text-[10px] text-slate-600 whitespace-nowrap flex-shrink-0">
                          {formatDate(conv.updated_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded
                          ${conv.tab_source === 'PHOTO' ? 'bg-emerald-500/10 text-emerald-400' :
                            conv.tab_source === 'PLAN' ? 'bg-blue-500/10 text-blue-400' :
                            'bg-purple-500/10 text-purple-400'}`}>
                          {conv.tab_source}
                        </span>
                        <span className="text-[10px] text-slate-600">
                          {conv.message_count} msgs
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="absolute right-2 top-2 hidden group-hover:flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(conv.id);
                            setEditTitle(conv.title);
                          }}
                          className="p-1 text-slate-500 hover:text-white rounded transition-all"
                          title="Rename"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm('Delete this project?')) handleDelete(conv.id);
                          }}
                          className="p-1 text-slate-500 hover:text-red-400 rounded transition-all"
                          title="Delete"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
