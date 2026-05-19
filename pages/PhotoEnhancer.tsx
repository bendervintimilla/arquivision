
import React, { useState, useEffect, useRef } from 'react';
import { ImageUploader } from '../components/ImageUploader';
import { MaskEditor } from '../components/MaskEditor';
import { DESIGN_PRESETS } from '../constants';
import { AppState, DesignStep, RenderAsset, EditContextPreferences, EditMode } from '../types';
import { generateArchitecturalVariations, clearSceneCache, classifyIntent } from '../services/geminiService';
import { backendApi } from '../services/backendApiService';
import { forceDownloadImage } from '../services/downloadHelper';
import { compressImage } from '../services/fileService';
import { useConversation } from '../hooks/useConversation';

interface PhotoEnhancerProps {
  onAssetCreated: (asset: RenderAsset) => void;
  userId: string;
  loadConversationId?: string | null;
  onConversationLoaded?: () => void;
  triggerNewConversation?: number;
}

export const PhotoEnhancer: React.FC<PhotoEnhancerProps> = ({
  onAssetCreated,
  userId,
  loadConversationId,
  onConversationLoaded,
  triggerNewConversation,
}) => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [currentPrompt, setCurrentPrompt] = useState<string>('');
  const [initials, setInitials] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isMasking, setIsMasking] = useState(false);
  const [pendingMask, setPendingMask] = useState<string | null>(null);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  // Phase 6: up to 3 extra views of the SAME space from different angles.
  // Lets gpt-image-2 resolve rotation / hidden-side requests structurally.
  const [additionalViews, setAdditionalViews] = useState<string[]>([]);
  const additionalViewInputRef = useRef<HTMLInputElement>(null);
  // Phase 8.1: one-time onboarding tip for the multi-view button.
  // Dismissed via localStorage so returning users don't see it again.
  const [showMultiViewTip, setShowMultiViewTip] = useState<boolean>(() => {
    try { return !localStorage.getItem('av_seen_multiview_tip'); } catch { return false; }
  });
  const dismissMultiViewTip = () => {
    setShowMultiViewTip(false);
    try { localStorage.setItem('av_seen_multiview_tip', '1'); } catch { /* private mode */ }
  };
  const [maskSuggestion, setMaskSuggestion] = useState<string | null>(null);
  const [enhancingIdx, setEnhancingIdx] = useState<number | null>(null);
  // Surfaced when the backend silently fell back from OpenAI/Pro to a lower
  // model. User selected and is paying for a higher tier than they actually
  // got — they deserve to know.
  const [downgradeWarning, setDowngradeWarning] = useState<string | null>(null);
  // Surfaced when the user hit the daily $ cap and was forced to Tier 0.
  const [capHitWarning, setCapHitWarning] = useState<string | null>(null);
  // Modal shown when classify-intent flags a 3D rotation / spatial rearrange
  // (high failure rate). Lets the user confirm, cancel, or use the AI
  // reformulation that's more likely to succeed.
  const [spatialModal, setSpatialModal] = useState<{
    message: string;
    suggestedPrompt?: string | null;
    onProceed: () => void;
    onUseSuggestion?: () => void;
    onCancel: () => void;
  } | null>(null);
  // Holds the setInterval that cycles OpenAI progress phases. Cleared on
  // result arrival, error, or component unmount.
  const phaseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // UI States
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(true);
  const [showPresets, setShowPresets] = useState(true);

  // Quality tier: 0=Draft (Flash), 1=Standard (Pro 1K), 2=HD (Pro 2K), 3=Ultra (Pro 4K)
  const [qualityTier, setQualityTier] = useState<number>(2); // Default: HD

  // For Text-to-Image start
  const [startTextPrompt, setStartTextPrompt] = useState('');

  // --- Edit Intelligence Engine ---
  const [showContextToggle, setShowContextToggle] = useState(false);
  const [editPreferences, setEditPreferences] = useState<EditContextPreferences>({
    mode: 'EDIT' as EditMode,
    preserveLayout: true,
    preserveLighting: true,
    preservePerspective: true,
    rememberPreference: false,
  });
  const [contextConfigured, setContextConfigured] = useState(false);
  const [generationPhase, setGenerationPhase] = useState<string>('');

  const scrollBottomRef = useRef<HTMLDivElement>(null);

  // --- Conversation hook (replaces raw useState<DesignStep[]>) ---
  const {
    steps: designSteps,
    setSteps: setDesignSteps,
    currentConversationId,
    addStep,
    loadConversation,
    startNewConversation,
    getAIContext,
    reset: resetConversation,
    loading: conversationLoading,
  } = useConversation({ userId, tabSource: 'PHOTO' });

  // Handle loading a conversation from sidebar
  useEffect(() => {
    if (loadConversationId) {
      loadConversation(loadConversationId).then(() => {
        setAppState(AppState.COMPLETE);
        onConversationLoaded?.();
      });
    }
  }, [loadConversationId]);

  // Handle new conversation trigger from sidebar
  useEffect(() => {
    if (triggerNewConversation && triggerNewConversation > 0) {
      handleReset();
    }
  }, [triggerNewConversation]);

  useEffect(() => {
    if (appState !== AppState.IDLE) {
      setTimeout(() => {
        scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [designSteps, appState]);

  // Ensure the phase-cycling timer never leaks across unmounts or re-renders.
  useEffect(() => () => {
    if (phaseTimerRef.current) {
      clearInterval(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
  }, []);

  // Start the OpenAI-aware progress timer. Tier 0 (Gemini Flash) is fast
  // enough that we don't need this — only kick it in for tiers 1+.
  const startProgressTimer = (tier: number) => {
    if (phaseTimerRef.current) clearInterval(phaseTimerRef.current);
    if (tier === 0) return;
    const startedAt = Date.now();
    phaseTimerRef.current = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      let msg = '';
      if (elapsed < 8)        msg = `💭 Razonando antes de dibujar... (${elapsed}s)`;
      else if (elapsed < 30)  msg = `🎨 Generando render... (${elapsed}s)`;
      else if (elapsed < 70)  msg = `🎨 Generando render — esto puede tomar 1–2 min (${elapsed}s)`;
      else if (elapsed < 110) msg = `✨ Finalizando detalles... (${elapsed}s)`;
      else                    msg = `⏳ Casi listo, pulendo los últimos detalles... (${elapsed}s)`;
      setGenerationPhase(msg);
    }, 1000);
  };

  const stopProgressTimer = () => {
    if (phaseTimerRef.current) {
      clearInterval(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
  };

  const handleReset = () => {
    setAppState(AppState.IDLE);
    resetConversation();
    setCurrentPrompt('');
    setStartTextPrompt('');
    setErrorMsg(null);
    setPendingMask(null);
    setContextConfigured(false);
    setGenerationPhase('');
    setReferenceImage(null);
    setAdditionalViews([]);
    setMaskSuggestion(null);
    setEnhancingIdx(null);
    setSpatialModal(null);
    clearSceneCache();
  };

  const handleReferenceImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Compress reference image to 2048px / 80% JPEG before attaching to payload
      const compressedBase64 = await compressImage(file, 2048, 2048, 0.8);
      setReferenceImage(compressedBase64);
    } catch (err) {
      console.error('Failed to parse reference image:', err);
    }

    e.target.value = ''; // reset so same file can be re-selected
  };

  // Phase 6: handle additional view upload (max 3 total)
  const handleAdditionalViewSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (additionalViews.length >= 3) {
      setMaskSuggestion('⚠️ Máximo 3 vistas adicionales');
      setTimeout(() => setMaskSuggestion(null), 4000);
      e.target.value = '';
      return;
    }
    try {
      const compressed = await compressImage(file, 2048, 2048, 0.8);
      setAdditionalViews(prev => [...prev, compressed]);
    } catch (err) {
      console.error('Failed to parse additional view:', err);
    }
    e.target.value = '';
  };

  const removeAdditionalView = (idx: number) => {
    setAdditionalViews(prev => prev.filter((_, i) => i !== idx));
  };

  const handleImageSelected = (base64: string) => {
    const step: DesignStep = {
      id: 'step-0',
      role: 'user',
      images: [base64],
      selectedImageIndex: 0,
      text: 'Original Upload'
    };
    addStep(step);
    setAppState(AppState.READY);
    setErrorMsg(null);
  };

  const handleTextStart = () => {
    if (!startTextPrompt.trim()) return;

    const step: DesignStep = {
      id: 'step-0-text',
      role: 'user',
      text: startTextPrompt,
      images: [],
      selectedImageIndex: -1
    };
    addStep(step);
    setAppState(AppState.READY);

    setTimeout(() => {
      handleGenerate(startTextPrompt);
    }, 100);
  };

  const getActiveContextImage = () => {
    const lastImageStep = [...designSteps].reverse().find(s => s.images && s.images.length > 0);
    if (!lastImageStep || !lastImageStep.images) return null;
    return lastImageStep.images[lastImageStep.selectedImageIndex || 0];
  };

  // Show context toggle before first edit on an uploaded image
  const handleFirstEdit = (prompt: string) => {
    if (!contextConfigured && getActiveContextImage()) {
      setShowContextToggle(true);
      setCurrentPrompt(prompt);
      return;
    }
    handleGenerate(prompt);
  };

  const handleContextConfirm = () => {
    setShowContextToggle(false);
    setContextConfigured(true);
    // Now run the generation with the stored prompt
    handleGenerate();
  };

  const handleGenerate = async (overridePrompt?: string, skipSpatialCheck = false) => {
    const promptToUse = overridePrompt || currentPrompt;
    if (!promptToUse) return;

    const contextImage = getActiveContextImage();

    // PRE-FLIGHT: For paid tiers with a source image, check if this is a
    // 3D rotation / spatial rearrange — these have a high failure rate
    // across ALL image-to-image models (Gemini, GPT, Flux). Better to warn
    // the user upfront than spend 2 min + $0.12 on something unlikely to
    // work. The classify call is cheap (~$0.0001).
    if (!skipSpatialCheck && qualityTier > 0 && contextImage) {
      setAppState(AppState.GENERATING);
      setGenerationPhase('🧠 Verificando intención...');
      try {
        const preIntent = await classifyIntent(promptToUse);
        const isRotation = (preIntent as any).is3DRotation === true;
        const warning = (preIntent as any).spatialWarning;
        const suggestedPrompt = (preIntent as any).suggestedPrompt;
        if (isRotation && warning) {
          setAppState(AppState.IDLE);
          setGenerationPhase('');
          setSpatialModal({
            message: warning,
            suggestedPrompt,
            onProceed: () => {
              setSpatialModal(null);
              handleGenerate(promptToUse, true); // skip the check this time
            },
            onUseSuggestion: suggestedPrompt
              ? () => {
                  setSpatialModal(null);
                  // Replace prompt in steps with the suggestion so the
                  // history reflects what was actually requested.
                  setDesignSteps(prev => {
                    const updated = [...prev];
                    const lastUserIdx = [...updated].reverse().findIndex(s => s.role === 'user' && s.text === promptToUse);
                    if (lastUserIdx >= 0) {
                      const realIdx = updated.length - 1 - lastUserIdx;
                      updated[realIdx] = { ...updated[realIdx], text: suggestedPrompt };
                    }
                    return updated;
                  });
                  handleGenerate(suggestedPrompt, true);
                }
              : undefined,
            onCancel: () => {
              setSpatialModal(null);
            },
          });
          return;
        }
      } catch (e) {
        // Pre-classify failed — proceed normally rather than block
        console.warn('Pre-classify spatial check failed, proceeding:', e);
      }
    }

    setAppState(AppState.GENERATING);
    setErrorMsg(null);
    setGenerationPhase('🧠 Clasificando intención...');

    if (!overridePrompt) {
      const userStep: DesignStep = {
        id: `step-${Date.now()}-user`,
        role: 'user',
        text: promptToUse,
        isMaskEdit: !!pendingMask
      };
      addStep(userStep);
    }

    setCurrentPrompt('');

    try {
      // Get AI context (memory + conversation summary + recent messages)
      const aiContext = await getAIContext();

      if (contextImage) {
        setGenerationPhase('🔬 Analizando escena...');
      }

      // For Tier 0 (Gemini Flash, ~5-10s) a static phase is fine.
      // For Tier 1+ (OpenAI gpt-image-2, ~90-120s) we cycle through phases
      // so the user doesn't think the app froze during the reasoning loop.
      if (qualityTier === 0) {
        setGenerationPhase('⚡ Generando borrador rápido...');
      } else {
        startProgressTimer(qualityTier);
      }

      // Phase 2: collect previous user commands from this session for
      // cumulative-context anchoring. Only "user" role steps with text.
      // Skip the current one (it's added to the steps right before this).
      const editHistory = designSteps
        .filter(s => s.role === 'user' && s.text && s.text !== promptToUse && s.text !== 'Original Upload')
        .map(s => s.text!)
        .slice(-10);

      const result = await generateArchitecturalVariations(
        contextImage || null,
        'image/png',
        promptToUse,
        initials,
        pendingMask || undefined,
        aiContext,
        'PHOTO',
        editPreferences,
        referenceImage,
        qualityTier,
        additionalViews,  // Phase 6
        editHistory,      // Phase 2
      );

      stopProgressTimer();
      setGenerationPhase('');

      const modelStep: DesignStep = {
        id: `step-${Date.now()}-model`,
        role: 'model',
        images: result.images,
        selectedImageIndex: 0,
        text: promptToUse
      };

      addStep(modelStep);
      setAppState(AppState.COMPLETE);
      setPendingMask(null);

      // Show mask suggestion if AI recommends it
      if (result.suggestMask && !pendingMask) {
        setMaskSuggestion('💡 Para ediciones más precisas, usa la herramienta de máscara (✏️) para marcar la zona exacta');
        setTimeout(() => setMaskSuggestion(null), 8000);
      }

      // Tell the user when the backend silently downgraded the tier
      if (result.meta?.tier_downgrade) {
        setDowngradeWarning(
          `⚠️ El modelo principal no estaba disponible y se generó este render con un modelo de respaldo (${result.meta.used_model}). La calidad puede estar por debajo del tier ${result.meta.tier_label} que seleccionaste.`
        );
        setTimeout(() => setDowngradeWarning(null), 12000);
      }

      // Tell the user when they hit the daily budget cap and were forced to Draft
      if (result.meta?.cap_hit) {
        const spent = result.meta.spent_usd_today;
        setCapHitWarning(
          `🚫 Alcanzaste el límite de gasto diario${spent != null ? ` ($${spent.toFixed(2)})` : ''}. Este render se generó en modo Draft (gratuito). El límite se reinicia mañana.`
        );
        setTimeout(() => setCapHitWarning(null), 15000);
      }

      // SAVE TO GALLERY
      if (result.images[0]) {
        onAssetCreated({
          id: `asset-${Date.now()}`,
          url: result.images[0],
          type: 'IMAGE',
          source: 'PHOTO',
          prompt: promptToUse,
          timestamp: Date.now()
        });
      }

      // SAVE CREATIVE DATAPOINT (fire & forget)
      try {
        backendApi.saveCreativeDatapoint({
          input_scene_analysis: result.sceneAnalysis,
          user_command: promptToUse,
          detected_intent: result.intent,
          prompt_sent: result.promptSent,
          // Use the model the backend actually used (may differ from the
          // requested one when the OpenAI→Gemini fallback fires).
          model_used: result.meta?.used_model || 'unknown',
          user_accepted: true,
          page_source: 'PHOTO',
          style_tags: result.intent?.targetStyle ? [result.intent.targetStyle] : [],
          object_tags: result.sceneAnalysis?.objects || [],
        }).catch(() => { }); // Non-blocking
      } catch { /* ignore */ }

    } catch (err: any) {
      stopProgressTimer();
      setAppState(AppState.ERROR);
      setGenerationPhase('');
      setErrorMsg(err.message || "Generation failed.");
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-y-auto custom-scrollbar">
      <div className="max-w-6xl mx-auto w-full p-4 lg:p-8 space-y-8">

        {/* Loading overlay for conversation restore */}
        {conversationLoading && (
          <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Restoring project...</p>
            </div>
          </div>
        )}

        {appState === AppState.IDLE ? (
          <div className="min-h-[80vh] flex flex-col justify-center space-y-12 animate-in fade-in duration-700">
            <div className="space-y-4 text-center">
              <h1 className="text-5xl font-black text-white tracking-tight">ARCHITECTURAL <span className="text-emerald-500">RENDER</span></h1>
              <p className="text-slate-400 max-w-lg mx-auto text-lg">Create stunning visualizations from sketches, existing photos, or pure imagination.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto w-full">
              {/* OPTION 1: UPLOAD */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-8 hover:border-slate-600 transition-all flex flex-col gap-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  </div>
                  <h3 className="text-xl font-bold text-white">Enhance Image</h3>
                </div>
                <p className="text-slate-400 text-sm">Upload a sketch, photo, or CAD screenshot to iterate on.</p>
                <div className="flex-grow">
                  <ImageUploader onImageSelected={handleImageSelected} />
                </div>
              </div>

              {/* OPTION 2: TEXT START */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-8 hover:border-emerald-500/50 transition-all flex flex-col gap-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </div>
                  <h3 className="text-xl font-bold text-white">Start from Text</h3>
                </div>
                <p className="text-slate-400 text-sm">Describe your vision and generate a render from scratch.</p>
                <div className="flex-grow flex flex-col gap-4">
                  <textarea
                    value={startTextPrompt}
                    onChange={(e) => setStartTextPrompt(e.target.value)}
                    placeholder="E.g. A modern minimalist living room with floor to ceiling windows, overlooking a snowy forest, warm lighting..."
                    className="w-full h-40 bg-slate-950 border border-slate-700 rounded-xl p-4 text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none resize-none transition-all"
                  />
                  <button
                    onClick={handleTextStart}
                    disabled={!startTextPrompt.trim()}
                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold shadow-lg shadow-emerald-900/50 transition-all flex items-center justify-center gap-2"
                  >
                    <span>Generate Concept</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* TOP CONTROLS SECTION */}
            <div className={`bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl transition-all duration-300 sticky top-0 z-30 backdrop-blur-xl bg-slate-900/80 ${isWorkspaceOpen ? 'space-y-6' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-black text-slate-300 uppercase tracking-widest">Workspace</h2>
                    <button
                      onClick={() => setIsWorkspaceOpen(!isWorkspaceOpen)}
                      className="text-[10px] uppercase font-bold text-emerald-500 hover:text-emerald-400 transition-colors ml-2"
                    >
                      {isWorkspaceOpen ? '[Hide]' : '[Show]'}
                    </button>
                  </div>
                  {currentConversationId && (
                    <span className="text-[10px] text-slate-600 bg-slate-800 px-2 py-1 rounded-full">
                      Saved
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  {isWorkspaceOpen && (
                    <>
                      <div className="flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200 border-r border-slate-700 pr-4 mr-2">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Initials:</span>
                        <input
                          type="text" value={initials} maxLength={3}
                          onChange={(e) => setInitials(e.target.value.toUpperCase())}
                          className="w-12 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white uppercase text-center focus:border-emerald-500 outline-none"
                        />
                      </div>

                      {/* Quality Tier Selector */}
                      <div className="flex items-center gap-1 bg-slate-800/70 border border-slate-700/50 rounded-full p-0.5">
                        {([{ t: 0, icon: '⚡', label: 'Draft' }, { t: 1, icon: '✨', label: 'Std' }, { t: 2, icon: '🔥', label: 'HD' }, { t: 3, icon: '💎', label: '4K' }] as { t: number, icon: string, label: string }[]).map(({ t, icon, label }) => (
                          <button
                            key={t}
                            onClick={() => setQualityTier(t)}
                            title={[
                              'Draft — Flash model, fast & cheap',
                              'Standard — Pro model, 1K resolution',
                              'HD — Pro model, 2K resolution (default)',
                              'Ultra — Pro model, 4K resolution, slowest'
                            ][t]}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${qualityTier === t
                              ? t === 0 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : t === 1 ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                                  : t === 2 ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                    : 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                              : 'text-slate-500 hover:text-slate-300 border border-transparent'
                              }`}
                          >
                            {icon} {label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  <button
                    onClick={handleReset}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-red-900/20 hover:text-red-400 hover:border-red-900/50 border border-slate-700 rounded-full text-xs font-bold text-slate-400 transition-all"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    New Project
                  </button>
                </div>
              </div>

              {isWorkspaceOpen && showPresets && (
                <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar no-scrollbar animate-in fade-in slide-in-from-top-2">
                  {DESIGN_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      onClick={() => setCurrentPrompt(prev => prev ? `${prev} ${preset.promptSuffix}` : preset.promptSuffix)}
                      className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition-all"
                    >
                      <span className="text-lg">{preset.icon}</span>
                      <span className="text-[10px] font-bold text-slate-200 whitespace-nowrap uppercase">{preset.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* CHAT/GENERATION FLOW */}
            <div className="space-y-12 pb-32">
              {designSteps.map((step, idx) => (
                <div key={step.id} className={`flex flex-col ${step.role === 'user' ? 'items-end' : 'items-start'} space-y-4`}>

                  {step.role === 'user' && step.text && (
                    <div className="max-w-xl bg-emerald-600/10 border border-emerald-500/20 rounded-2xl p-4 text-emerald-100 text-sm shadow-lg">
                      {step.text}
                    </div>
                  )}

                  {step.images && step.images.length > 0 && (
                    <div className="w-full space-y-4">
                      <div className="flex items-center justify-between px-2">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">
                            {idx === 0 ? 'Start' : `Iteration ${Math.floor(idx / 2)}`}
                          </span>
                          {step.role === 'model' && step.text && step.text !== 'Edit Complete' && step.text !== 'Render Generated' && (
                            <span className="text-xs text-slate-400 mt-1 line-clamp-2">{step.text}</span>
                          )}
                        </div>
                      </div>
                      <div className={`grid gap-4 ${step.images.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                        {step.images.map((img, imgIdx) => (
                          <div
                            key={imgIdx}
                            onClick={() => {
                              const next = [...designSteps];
                              next[idx].selectedImageIndex = imgIdx;
                              setDesignSteps(next);
                            }}
                            className={`group relative rounded-3xl overflow-hidden border-2 transition-all duration-300 cursor-pointer
                              ${step.selectedImageIndex === imgIdx ? 'border-emerald-500 shadow-2xl ring-4 ring-emerald-500/10 scale-[1.01]' : 'border-slate-800 opacity-60 hover:opacity-100'}
                            `}
                          >
                            <img src={img} alt="Variation" className="w-full object-contain bg-black" style={{ maxHeight: '70vh' }} />
                            {step.selectedImageIndex === imgIdx && (
                              <div className="absolute top-4 right-4 bg-emerald-500 text-white p-1 rounded-full shadow-xl z-10">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1-.143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" /></svg>
                              </div>
                            )}
                            <button onClick={(e) => { e.stopPropagation(); forceDownloadImage(img, `render-${idx}-${imgIdx}.png`); }} className="absolute bottom-4 right-4 p-2 bg-black/60 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-emerald-500 z-10 border-none cursor-pointer">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" /><path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" /></svg>
                            </button>
                            {step.role === 'model' && step.selectedImageIndex === imgIdx && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setEnhancingIdx(idx);
                                  try {
                                    const { images: enhanced } = await backendApi.enhanceImage({ image: img });
                                    if (enhanced?.[0]) {
                                      const next = [...designSteps];
                                      next[idx].images![imgIdx] = enhanced[0];
                                      setDesignSteps(next);
                                    }
                                  } catch (err) {
                                    console.error('Enhance failed:', err);
                                  } finally {
                                    setEnhancingIdx(null);
                                  }
                                }}
                                disabled={enhancingIdx === idx}
                                className="absolute bottom-4 left-4 px-3 py-1.5 bg-black/60 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-purple-500 z-10 border-none cursor-pointer flex items-center gap-1.5 text-xs font-bold"
                              >
                                {enhancingIdx === idx ? (
                                  <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />HD...</>
                                ) : (
                                  <>✨ HD</>
                                )}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {appState === AppState.GENERATING && (
                <div className="flex flex-col items-center py-12 space-y-4 animate-pulse">
                  <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                    {generationPhase || (['⚡ Draft — Quick Gen...', '✨ Standard Quality...', '🔥 HD Generating...', '💎 Ultra 4K...'][qualityTier])}
                  </p>
                </div>
              )}
              {errorMsg && (
                <div className="p-4 bg-red-900/20 border border-red-800 rounded-xl text-red-300 text-sm text-center">
                  {errorMsg}
                </div>
              )}
              <div ref={scrollBottomRef} />
            </div>

            {/* MASK SUGGESTION TOAST */}
            {maskSuggestion && (
              <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-amber-500/10 border border-amber-500/30 text-amber-200 px-6 py-3 rounded-2xl text-sm font-medium shadow-2xl backdrop-blur-xl animate-in slide-in-from-top-4 fade-in duration-300 max-w-lg text-center">
                {maskSuggestion}
                <button onClick={() => setMaskSuggestion(null)} className="ml-3 text-amber-400 hover:text-white font-bold">×</button>
              </div>
            )}

            {/* TIER DOWNGRADE WARNING */}
            {downgradeWarning && (
              <div className="fixed top-36 left-1/2 -translate-x-1/2 z-50 bg-yellow-500/10 border border-yellow-500/40 text-yellow-100 px-6 py-3 rounded-2xl text-sm font-medium shadow-2xl backdrop-blur-xl animate-in slide-in-from-top-4 fade-in duration-300 max-w-xl text-center">
                {downgradeWarning}
                <button onClick={() => setDowngradeWarning(null)} className="ml-3 text-yellow-300 hover:text-white font-bold">×</button>
              </div>
            )}

            {/* DAILY CAP WARNING */}
            {capHitWarning && (
              <div className="fixed top-52 left-1/2 -translate-x-1/2 z-50 bg-red-500/10 border border-red-500/40 text-red-100 px-6 py-3 rounded-2xl text-sm font-medium shadow-2xl backdrop-blur-xl animate-in slide-in-from-top-4 fade-in duration-300 max-w-xl text-center">
                {capHitWarning}
                <button onClick={() => setCapHitWarning(null)} className="ml-3 text-red-300 hover:text-white font-bold">×</button>
              </div>
            )}

            {/* SPATIAL ROTATION WARNING MODAL */}
            {spatialModal && (
              <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-slate-900 border border-amber-500/40 rounded-3xl p-8 max-w-lg w-full shadow-2xl space-y-5">
                  <div className="space-y-2">
                    <div className="text-3xl">🔄</div>
                    <h3 className="text-xl font-bold text-white">Rotación 3D detectada</h3>
                    <p className="text-amber-200 text-sm leading-relaxed">{spatialModal.message}</p>
                  </div>

                  {/* SUGGESTED REFORMULATION (Phase 7.2) */}
                  {spatialModal.suggestedPrompt && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">💡 Sugerencia con mayor probabilidad de éxito:</p>
                      <p className="text-sm text-emerald-100 italic leading-relaxed">"{spatialModal.suggestedPrompt}"</p>
                    </div>
                  )}

                  <div className="space-y-2 pt-2 border-t border-slate-800 text-xs text-slate-400">
                    <p className="font-bold uppercase tracking-wider text-slate-500">Otras alternativas:</p>
                    <ul className="space-y-1 list-disc list-inside">
                      <li><span className="text-sky-400 font-bold">⊞ Sube vistas adicionales</span> del mismo espacio desde otro ángulo (botón cuadrícula 2×2 abajo)</li>
                      <li>Usa Plan Studio (modo vector) para mover muebles por coordenada</li>
                    </ul>
                  </div>

                  <div className={`grid gap-3 ${spatialModal.onUseSuggestion ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    {spatialModal.onUseSuggestion && (
                      <button
                        onClick={spatialModal.onUseSuggestion}
                        className="py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-900/50 transition-all"
                      >
                        ✨ Usar la sugerencia
                      </button>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={spatialModal.onCancel}
                        className="py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-sm font-bold transition-all"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={spatialModal.onProceed}
                        className="py-3 bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/50 text-amber-100 rounded-xl text-sm font-bold transition-all"
                      >
                        Intentar igual
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STICKY BOTTOM INPUT */}
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-950 via-slate-950 to-transparent z-40">
              {/* Reference Image + Additional Views Preview */}
              {(referenceImage || additionalViews.length > 0) && (
                <div className="max-w-4xl mx-auto mb-2 flex items-center gap-3 flex-wrap">
                  {referenceImage && (
                    <div className="flex items-center gap-2">
                      <div className="relative group">
                        <img src={referenceImage} alt="Reference" className="h-16 w-16 object-cover rounded-xl border-2 border-purple-500/50" />
                        <button
                          onClick={() => setReferenceImage(null)}
                          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      </div>
                      <span className="text-[10px] text-purple-400 font-medium uppercase tracking-wider">Referencia</span>
                    </div>
                  )}
                  {additionalViews.map((v, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <div className="relative group">
                        <img src={v} alt={`View ${idx + 1}`} className="h-16 w-16 object-cover rounded-xl border-2 border-sky-500/50" />
                        <button
                          onClick={() => removeAdditionalView(idx)}
                          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      </div>
                      <span className="text-[10px] text-sky-400 font-medium uppercase tracking-wider">Vista {idx + 1}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="max-w-4xl mx-auto bg-slate-900 border border-slate-700 rounded-2xl p-2 shadow-2xl flex items-center gap-2">
                <button
                  onClick={() => setIsMasking(true)}
                  disabled={!getActiveContextImage()}
                  className={`p-3 rounded-xl transition-all ${pendingMask ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-500 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed'}`}
                  title="Masking Tool"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="m2.695 14.762-1.262 3.155a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.886L17.5 5.501a2.121 2.121 0 0 0-3-3L3.58 13.419a4 4 0 0 0-.885 1.343Z" /></svg>
                </button>
                {/* Reference Image Button (style/material reference) */}
                <input
                  ref={referenceInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleReferenceImageSelected}
                  className="hidden"
                />
                <button
                  onClick={() => referenceInputRef.current?.click()}
                  className={`p-3 rounded-xl transition-all ${referenceImage ? 'text-purple-400 bg-purple-500/10' : 'text-slate-500 hover:text-white hover:bg-slate-800'}`}
                  title="Imagen de referencia (estilo/material)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909-3.22-3.22a.75.75 0 0 0-1.06 0L2.5 11.06Zm12.5-4.31a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z" clipRule="evenodd" />
                  </svg>
                </button>
                {/* Additional View Button — Phase 6 (multi-view input) */}
                <input
                  ref={additionalViewInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAdditionalViewSelected}
                  className="hidden"
                />
                <div className="relative">
                  <button
                    onClick={() => { dismissMultiViewTip(); additionalViewInputRef.current?.click(); }}
                    disabled={additionalViews.length >= 3}
                    className={`p-3 rounded-xl transition-all relative ${additionalViews.length > 0 ? 'text-sky-400 bg-sky-500/10' : 'text-slate-500 hover:text-white hover:bg-slate-800'} disabled:opacity-30 disabled:cursor-not-allowed ${showMultiViewTip && getActiveContextImage() && additionalViews.length === 0 ? 'ring-2 ring-sky-500/60 animate-pulse' : ''}`}
                    title={`Vista adicional del mismo espacio desde otro ángulo (${additionalViews.length}/3) — resuelve rotaciones`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                    {additionalViews.length > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-sky-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">{additionalViews.length}</span>
                    )}
                  </button>
                  {/* ONBOARDING TIP — Phase 8.1 */}
                  {showMultiViewTip && getActiveContextImage() && additionalViews.length === 0 && (
                    <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-64 bg-sky-500/10 border border-sky-500/50 backdrop-blur-xl rounded-2xl p-3 shadow-2xl animate-in fade-in slide-in-from-bottom-2">
                      <div className="text-[10px] font-bold text-sky-400 uppercase tracking-wider mb-1">🆕 Multi-vista</div>
                      <p className="text-xs text-sky-100 leading-relaxed">
                        Sube hasta 3 fotos del mismo espacio desde ángulos distintos. El AI usa las caras ocultas para girar muebles, ver "el otro lado" y rotaciones 3D.
                      </p>
                      <button
                        onClick={(e) => { e.stopPropagation(); dismissMultiViewTip(); }}
                        className="absolute top-1 right-2 text-sky-300 hover:text-white text-xs"
                      >
                        ×
                      </button>
                      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-sky-500/50" />
                    </div>
                  )}
                </div>
                <textarea
                  value={currentPrompt}
                  onChange={(e) => setCurrentPrompt(e.target.value)}
                  placeholder={referenceImage ? "Describe what to use from the reference image..." : "Describe architectural changes..."}
                  className="flex-grow bg-transparent border-none outline-none text-sm text-white placeholder-slate-600 px-2 py-2 resize-none"
                  rows={1}
                />
                <button
                  onClick={() => handleFirstEdit(currentPrompt)}
                  disabled={!currentPrompt || appState === AppState.GENERATING}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 text-white p-3 rounded-xl transition-all shadow-lg"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.925A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.087l-1.414 4.926a.75.75 0 0 0 .826.95 48.556 48.556 0 0 0 16.03-7.864.75.75 0 0 0 0-1.212L3.105 2.288Z" /></svg>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {isMasking && getActiveContextImage() && (
        <MaskEditor imageBase64={getActiveContextImage()!} onConfirm={(mask) => { setPendingMask(mask); setIsMasking(false); }} onCancel={() => setIsMasking(false)} />
      )}

      {/* CONTEXT PRESERVATION TOGGLE MODAL */}
      {showContextToggle && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-6">
            <div className="text-center space-y-2">
              <div className="text-3xl">🧠</div>
              <h3 className="text-xl font-bold text-white">How should I handle this image?</h3>
              <p className="text-slate-400 text-sm">Choose how the AI processes your edits</p>
            </div>

            <div className="space-y-3">
              {[
                { mode: 'EDIT' as EditMode, label: 'Edit this image', desc: 'Preserve scene, change only what you ask', icon: '✏️', default: true },
                { mode: 'STYLE_TRANSFER' as EditMode, label: 'Style transfer only', desc: 'Keep layout, change the design style', icon: '🎨' },
                { mode: 'GENERATE' as EditMode, label: 'Use as inspiration', desc: 'Free creation based on this image', icon: '✨' },
              ].map(opt => (
                <button
                  key={opt.mode}
                  onClick={() => setEditPreferences(prev => ({ ...prev, mode: opt.mode }))}
                  className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${editPreferences.mode === opt.mode
                    ? 'border-emerald-500 bg-emerald-500/10 shadow-lg shadow-emerald-500/5'
                    : 'border-slate-700 hover:border-slate-600 bg-slate-800/50'
                    }`}
                >
                  <span className="text-2xl">{opt.icon}</span>
                  <div>
                    <p className={`font-bold text-sm ${editPreferences.mode === opt.mode ? 'text-emerald-400' : 'text-slate-200'}`}>{opt.label}</p>
                    <p className="text-xs text-slate-500">{opt.desc}</p>
                  </div>
                  {editPreferences.mode === opt.mode && (
                    <div className="ml-auto text-emerald-400">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1-.143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" /></svg>
                    </div>
                  )}
                </button>
              ))}
            </div>

            {editPreferences.mode !== 'GENERATE' && (
              <div className="space-y-3 pt-2 border-t border-slate-800">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Preserve:</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'preserveLayout', label: '📐 Layout', field: 'preserveLayout' as const },
                    { key: 'preserveLighting', label: '💡 Lighting', field: 'preserveLighting' as const },
                    { key: 'preservePerspective', label: '📷 Camera angle', field: 'preservePerspective' as const },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setEditPreferences(prev => ({ ...prev, [opt.field]: !prev[opt.field] }))}
                      className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${editPreferences[opt.field]
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-500 border border-slate-700'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editPreferences.rememberPreference}
                  onChange={(e) => setEditPreferences(prev => ({ ...prev, rememberPreference: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500"
                />
                <span className="text-xs text-slate-400">Remember my preference</span>
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowContextToggle(false)}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-bold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleContextConfirm}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-900/50 transition-all"
              >
                Continue →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
