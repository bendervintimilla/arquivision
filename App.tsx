
import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { PhotoEnhancer } from './pages/PhotoEnhancer';
import { PlanToRender } from './pages/PlanToRender';
import { VideoStudio } from './pages/VideoStudio';
import { ConversationSidebar } from './components/ConversationSidebar';
import { RenderAsset } from './types';
import { useAuth } from './contexts/AuthContext';
import { listConversations, DBConversation, loadGallery, DBAsset } from './services/conversationService';
import { getSignedUrl } from './services/imageStorageService';

type ActiveTab = 'PHOTO' | 'PLAN' | 'VIDEO';

const App: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>('PHOTO');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversations, setConversations] = useState<DBConversation[]>([]);
  const [loadConversationId, setLoadConversationId] = useState<string | null>(null);
  const [triggerNewConv, setTriggerNewConv] = useState(0);

  // Shared Gallery State for all assets
  const [gallery, setGallery] = useState<RenderAsset[]>([]);

  // Load gallery from DB on mount
  useEffect(() => {
    if (user) {
      loadGalleryFromDB();
    }
  }, [user]);

  const loadGalleryFromDB = useCallback(async () => {
    if (!user) return;
    try {
      const assets = await loadGallery(user.id);
      const galleryItems: RenderAsset[] = await Promise.all(
        assets.map(async (a: DBAsset) => {
          let url = a.public_url || '';
          if (!url && a.storage_path) {
            try {
              url = await getSignedUrl(a.storage_path);
            } catch {
              url = '';
            }
          }
          return {
            id: a.id,
            url,
            type: a.type as 'IMAGE' | 'VIDEO',
            source: a.source as 'PHOTO' | 'PLAN' | 'VIDEO',
            prompt: a.prompt,
            timestamp: new Date(a.created_at).getTime(),
          };
        })
      );
      setGallery(galleryItems);
    } catch (e) {
      console.error('Failed to load gallery:', e);
    }
  }, [user]);

  // Load conversations for sidebar
  const refreshConversations = useCallback(async () => {
    if (!user) return;
    try {
      const convos = await listConversations(user.id);
      setConversations(convos);
    } catch (e) {
      console.error('Failed to load conversations:', e);
    }
  }, [user]);

  useEffect(() => {
    if (user && sidebarOpen) {
      refreshConversations();
    }
  }, [user, sidebarOpen]);

  const handleAssetCreated = (asset: RenderAsset) => {
    setGallery(prev => [asset, ...prev]);
  };

  if (!user) return null;

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      <Header />

      {/* Tab Navigation */}
      <div className="flex-shrink-0 border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm z-40">
        <div className="max-w-7xl mx-auto px-4 flex gap-8 items-center">
          {/* Sidebar Toggle */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="py-4 text-slate-500 hover:text-emerald-400 transition-all"
            title="Open projects"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </button>

          <button
            onClick={() => setActiveTab('PHOTO')}
            className={`py-4 text-sm font-medium border-b-2 transition-all ${activeTab === 'PHOTO'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
          >
            Render Image
          </button>
          <button
            onClick={() => setActiveTab('PLAN')}
            className={`py-4 text-sm font-medium border-b-2 transition-all ${activeTab === 'PLAN'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
          >
            Plan to Render <span className="ml-2 text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Beta</span>
          </button>
          <button
            onClick={() => setActiveTab('VIDEO')}
            className={`py-4 text-sm font-medium border-b-2 transition-all ${activeTab === 'VIDEO'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
          >
            Video Studio <span className="ml-2 text-[10px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">New</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-grow relative overflow-hidden">
        <div className={`w-full h-full ${activeTab === 'PHOTO' ? 'block' : 'hidden'}`}>
          <PhotoEnhancer
            onAssetCreated={handleAssetCreated}
            userId={user.id}
            loadConversationId={loadConversationId}
            onConversationLoaded={() => setLoadConversationId(null)}
            triggerNewConversation={triggerNewConv}
          />
        </div>
        <div className={`w-full h-full ${activeTab === 'PLAN' ? 'block' : 'hidden'}`}>
          <PlanToRender onAssetCreated={handleAssetCreated} />
        </div>
        <div className={`w-full h-full ${activeTab === 'VIDEO' ? 'block' : 'hidden'}`}>
          <VideoStudio gallery={gallery} />
        </div>
      </div>

      {/* Conversation Sidebar */}
      <ConversationSidebar
        conversations={conversations}
        currentConversationId={loadConversationId}
        onSelectConversation={(id) => {
          setLoadConversationId(id);
          setSidebarOpen(false);
        }}
        onNewConversation={() => {
          setTriggerNewConv(prev => prev + 1);
          setSidebarOpen(false);
        }}
        onRefresh={refreshConversations}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
    </div>
  );
};

export default App;
