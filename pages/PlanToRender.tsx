
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ImageUploader } from '../components/ImageUploader';
import { MaskEditor } from '../components/MaskEditor';
import { DesignStep, AppState, FloorPlan, RenderAsset } from '../types';
import { analyzePlanImage, auditArchitecture, generateArchitecturalVariations, modifyPlanVector } from '../services/geminiService';
import { applyPlanOperations, exportPlanToDxf, renderPlanToCanvas, drawVectorPlan, getPlanBounds } from '../services/cadService';

// --- VECTOR CAD VIEWER ---
interface PanZoomViewerProps {
  src?: string; // Optional raster fallback
  floorPlan?: FloorPlan; // The Vector Data
  isLoading?: boolean;
  mode: 'PLAN' | 'RENDER';
  onCoordinateMove?: (x: number, y: number) => void;
}

const PanZoomViewer: React.FC<PanZoomViewerProps> = ({ src, floorPlan, isLoading, mode, onCoordinateMove }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transform = useRef({ x: 0, y: 0, scale: 20 }); // Default scale
  const [renderTrigger, setRenderTrigger] = useState(0);
  const initialized = useRef(false);

  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // Initial fit
  useEffect(() => {
    if (!initialized.current && containerRef.current && floorPlan) {
      const bounds = getPlanBounds(floorPlan);
      const { clientWidth, clientHeight } = containerRef.current;
      const padding = 50;

      // Calculate scale to fit
      const scaleX = (clientWidth - padding * 2) / bounds.width;
      const scaleY = (clientHeight - padding * 2) / bounds.height;
      const scale = Math.min(scaleX, scaleY);

      // Center
      const x = (clientWidth - (bounds.width * scale)) / 2 - (bounds.minX * scale);
      const y = (clientHeight - (bounds.height * scale)) / 2 - (bounds.minY * scale);

      transform.current = { x, y, scale };
      initialized.current = true;
      setRenderTrigger(p => p + 1);
    }
  }, [floorPlan]);

  const draw = useCallback(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const { clientWidth, clientHeight } = containerRef.current;

    // Handle Retina Display
    const dpr = window.devicePixelRatio || 1;
    if (canvasRef.current.width !== clientWidth * dpr || canvasRef.current.height !== clientHeight * dpr) {
      canvasRef.current.width = clientWidth * dpr;
      canvasRef.current.height = clientHeight * dpr;
      ctx.scale(dpr, dpr);
    }

    // Clear
    ctx.fillStyle = mode === 'PLAN' ? '#0f172a' : '#000000';
    ctx.fillRect(0, 0, clientWidth, clientHeight);

    // GRID (Infinite)
    if (mode === 'PLAN') {
      const t = transform.current;
      const gridSize = 100; // units

      ctx.beginPath();
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;

      // Calculate grid range visible
      // Simply drawing a dynamic grid based on transform
      // (Simplified for performance: just a large enough grid or screen-space grid)
      // Let's do screen space grid for visual reference
      const screenGridSize = 50 * (t.scale > 5 ? 1 : t.scale); // adaptive
      const offsetX = t.x % screenGridSize;
      const offsetY = t.y % screenGridSize;

      for (let x = offsetX; x < clientWidth; x += screenGridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, clientHeight); }
      for (let y = offsetY; y < clientHeight; y += screenGridSize) { ctx.moveTo(0, y); ctx.lineTo(clientWidth, y); }
      ctx.stroke();
    }

    // DRAW CONTENT
    if (floorPlan && mode === 'PLAN') {
      drawVectorPlan(ctx, floorPlan, transform.current, clientWidth, clientHeight);
    } else if (src) {
      // Fallback Raster Draw
      const img = new Image();
      img.src = src;
      if (img.complete) {
        ctx.save();
        ctx.translate(transform.current.x, transform.current.y);
        ctx.scale(transform.current.scale / 20, transform.current.scale / 20); // Normalize scale for raster
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      }
    }

  }, [mode, floorPlan, src, renderTrigger]);

  useEffect(() => {
    // Animation Loop or Trigger
    requestAnimationFrame(draw);
  }, [draw, renderTrigger]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const oldScale = transform.current.scale;
    const newScale = Math.max(0.1, Math.min(500, oldScale * factor));

    // Zoom towards mouse
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // World before zoom
      const wx = (mx - transform.current.x) / oldScale;
      const wy = (my - transform.current.y) / oldScale;

      // New position
      transform.current.x = mx - wx * newScale;
      transform.current.y = my - wy * newScale;
      transform.current.scale = newScale;
      setRenderTrigger(p => p + 1);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging.current) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      transform.current.x += dx;
      transform.current.y += dy;
      setRenderTrigger(p => p + 1);
    }

    // Update Coordinates Display
    if (containerRef.current && onCoordinateMove) {
      const rect = containerRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const wx = (mx - transform.current.x) / transform.current.scale;
      const wy = (my - transform.current.y) / transform.current.scale;
      onCoordinateMove(wx, wy);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden cursor-crosshair bg-[#0f172a] touch-none"
      onMouseDown={(e) => { isDragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY }; }}
      onMouseMove={handleMouseMove}
      onMouseUp={() => isDragging.current = false}
      onMouseLeave={() => isDragging.current = false}
      onWheel={handleWheel}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-20">
          <div className="flex flex-col items-center gap-6 bg-[#1a1a1a] p-8 border border-emerald-500/30 rounded-2xl shadow-2xl">
            <div className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-center">
              <span className="block text-emerald-400 font-mono text-xs uppercase tracking-[0.3em] animate-pulse mb-1">
                {mode === 'PLAN' ? 'Calculating Vectors' : 'Rendering Image'}
              </span>
              <span className="block text-slate-500 text-[10px]">Gemini 2.5 Inference</span>
            </div>
          </div>
        </div>
      )}

      {/* Zoom / Info Overlay */}
      <div className="absolute bottom-4 left-4 pointer-events-none select-none">
        <div className="bg-black/80 px-2 py-1 rounded text-[10px] text-slate-400 font-mono border border-slate-800">
          ZOOM: {(transform.current.scale).toFixed(1)}x
        </div>
      </div>
    </div>
  );
};

interface PlanToRenderProps {
  onAssetCreated: (asset: RenderAsset) => void;
}

export const PlanToRender: React.FC<PlanToRenderProps> = ({ onAssetCreated }) => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [history, setHistory] = useState<DesignStep[]>([]);
  const [currentPrompt, setCurrentPrompt] = useState('');

  const [mode, setMode] = useState<'PLAN' | 'RENDER'>('PLAN');

  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [auditText, setAuditText] = useState<string | null>(null);
  const [filename, setFilename] = useState("drawing1.dwg");

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [history]);

  const handleInitialUpload = async (base64: string, mime: string, meta?: any) => {
    setAppState(AppState.READY);
    if (meta?.name) setFilename(meta.name);

    const initialStep: DesignStep = {
      id: 'step-0',
      role: 'user',
      images: [base64],
      selectedImageIndex: 0,
      text: `Opened ${meta?.format || 'CAD File'}: ${meta?.name || 'Untitled'}`,
      floorPlanData: meta?.floorPlan // Capture the Semantic FloorPlan if available
    };
    setHistory([initialStep]);

    try {
      if (meta?.floorPlan) {
        setAuditText(`Vector Mode Enabled.\n\nSimulated Backend Conversion:\n- Walls: ${meta.floorPlan.walls.length}\n- Doors: ${meta.floorPlan.doors.length}\n- Windows: ${meta.floorPlan.windows.length}`);
      } else {
        const analysis = await analyzePlanImage(base64);
        setAuditText(meta?.manifest ? await auditArchitecture(meta.manifest) : `Layout Analysis: ${analysis.rooms?.length || 0} zones identified.`);
      }
    } catch (e) { console.error(e); }
  };

  const getActiveStep = () => {
    return [...history].reverse().find(s => (s.images && s.images.length > 0));
  };

  const getActiveImage = () => {
    const step = getActiveStep();
    return step ? step.images![step.selectedImageIndex || 0] : null;
  };

  const getActiveFloorPlan = () => {
    // Find the last step that has floor plan data
    return [...history].reverse().find(s => s.floorPlanData)?.floorPlanData;
  };

  const handleGenerate = async () => {
    const activeImage = getActiveImage();
    const activeFloorPlan = getActiveFloorPlan();

    if (!activeImage || !currentPrompt) return;

    setAppState(AppState.GENERATING);

    // PLAN MODE: Uses Vector Logic if available
    if (mode === 'PLAN' && activeFloorPlan) {
      try {
        const userStep: DesignStep = {
          id: `u-${Date.now()}`,
          role: 'user',
          text: currentPrompt
        };
        setHistory(prev => [...prev, userStep]);
        setCurrentPrompt('');

        // 1. Send JSON to Gemini
        const aiResponse = await modifyPlanVector(activeFloorPlan, userStep.text!);

        // 2. Apply operations to JSON
        const newFloorPlan = applyPlanOperations(activeFloorPlan, aiResponse.operations);

        // 3. Render new JSON to Canvas/Image for history thumbnail
        const canvas = document.createElement('canvas');
        canvas.width = 2048; canvas.height = 1536;
        renderPlanToCanvas(newFloorPlan, canvas);
        const newImage = canvas.toDataURL('image/png');

        const modelStep: DesignStep = {
          id: `m-${Date.now()}`,
          role: 'model',
          images: [newImage],
          selectedImageIndex: 0,
          text: aiResponse.reasoning || "Geometry Updated",
          floorPlanData: newFloorPlan
        };
        setHistory(prev => [...prev, modelStep]);
        setAppState(AppState.COMPLETE);

        // Save to Gallery
        onAssetCreated({
          id: `asset-${Date.now()}`,
          url: newImage,
          type: 'IMAGE',
          source: 'PLAN',
          prompt: userStep.text || "Modified Plan",
          timestamp: Date.now()
        });
        return;

      } catch (e) {
        console.error("Vector update failed", e);
        setAppState(AppState.ERROR);
      }
    } else {
      // RENDER MODE (Image Generation)
      let finalPrompt = `[RENDER MODE] Create a photorealistic 3D render: ${currentPrompt}. Perspective view.`;

      const userStep: DesignStep = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: currentPrompt
      };
      setHistory(prev => [...prev, userStep]);
      setCurrentPrompt('');

      try {
        const result = await generateArchitecturalVariations(
          activeImage!,
          'image/png',
          finalPrompt,
          undefined,
          undefined,
          undefined,
          'PLAN'
        );

        const modelStep: DesignStep = {
          id: `m-${Date.now()}`,
          role: 'model',
          images: result.images,
          selectedImageIndex: 0,
          text: "RENDER_GENERATED"
        };
        setHistory(prev => [...prev, modelStep]);
        setAppState(AppState.COMPLETE);

        // Save to Gallery
        if (result.images[0]) {
          onAssetCreated({
            id: `asset-${Date.now()}`,
            url: result.images[0],
            type: 'IMAGE',
            source: 'PLAN',
            prompt: userStep.text || "Rendered View",
            timestamp: Date.now()
          });
        }

      } catch (err) {
        setAppState(AppState.ERROR);
      }
    }
  };

  const downloadDxf = () => {
    const plan = getActiveFloorPlan();
    if (!plan) return;
    const dxfContent = exportPlanToDxf(plan);
    const blob = new Blob([dxfContent], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `modified_${filename.replace('.dwg', '')}.dxf`;
    a.click();
  };

  if (appState === AppState.IDLE) {
    return (
      <div className="absolute inset-0 bg-[#0a0f1d] overflow-y-auto custom-scrollbar animate-in fade-in zoom-in-95">
        <div className="min-h-full flex flex-col items-center justify-center p-8">
          <div className="max-w-2xl w-full space-y-12 text-center">
            <div className="space-y-4">
              <h1 className="text-5xl font-black text-white tracking-tighter italic uppercase">Plan <span className="text-emerald-500">Studio</span></h1>
              <p className="text-slate-400 text-lg">Import DWG/DXF. Real Vector Editing. 3D Visualization.</p>
              <p className="text-xs text-slate-600 bg-slate-900/50 p-2 rounded">Note: Binary DWG upload is simulated for demo purposes in this environment.</p>
            </div>
            <ImageUploader onImageSelected={handleInitialUpload} />
          </div>
        </div>
      </div>
    );
  }

  const activeImage = getActiveImage();
  const activeFloorPlan = getActiveFloorPlan();
  const hasVectorData = !!activeFloorPlan;

  return (
    <div className="flex flex-col h-full bg-[#1c1c1c] text-slate-300 font-mono text-[11px] overflow-hidden">

      {/* HEADER / RIBBON */}
      <div className="h-12 bg-[#2b2b2b] border-b border-black flex items-center px-4 justify-between shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">File</span>
            <span className="text-emerald-400 font-bold">{filename}</span>
          </div>
          <div className="h-8 w-px bg-slate-700"></div>
          <div className="flex gap-2">
            <button
              onClick={() => setMode('PLAN')}
              className={`px-4 py-1.5 rounded-sm font-bold uppercase tracking-wide transition-all ${mode === 'PLAN' ? 'bg-[#3f3f3f] text-white border-b-2 border-emerald-500 shadow-lg' : 'hover:bg-[#333] text-slate-400'}`}
            >
              2D Modify {hasVectorData && <span className="ml-2 text-[9px] bg-emerald-900 text-emerald-400 px-1 rounded">VECTOR</span>}
            </button>
            <button
              onClick={() => setMode('RENDER')}
              className={`px-4 py-1.5 rounded-sm font-bold uppercase tracking-wide transition-all ${mode === 'RENDER' ? 'bg-[#3f3f3f] text-purple-300 border-b-2 border-purple-500 shadow-lg' : 'hover:bg-[#333] text-slate-400'}`}
            >
              3D Render
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {hasVectorData && mode === 'PLAN' && (
            <button onClick={downloadDxf} className="flex items-center gap-2 px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded border border-slate-600 transition-colors uppercase font-bold">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Export DXF
            </button>
          )}
          <button onClick={() => setAppState(AppState.IDLE)} className="px-3 py-1 bg-red-900/20 hover:bg-red-900/50 text-red-400 rounded border border-red-900/50 transition-colors uppercase font-bold">Close Project</button>
        </div>
      </div>

      <div className="flex-grow flex overflow-hidden">

        {/* LEFT PANEL */}
        <div className="w-64 bg-[#262626] border-r border-black flex flex-col shrink-0 min-h-0">
          <div className="flex flex-col min-h-0 flex-[2] border-b border-black">
            <div className="p-2 bg-[#333] font-bold text-gray-100 border-b border-black text-[10px] uppercase tracking-wider shrink-0">Properties</div>
            <div className="flex-grow overflow-y-auto p-4 space-y-4 text-gray-400 bg-[#1a1a1a] custom-scrollbar">
              <div className="space-y-1">
                <div className="text-[9px] text-slate-500 uppercase">Engine Status</div>
                <div className="text-slate-200">
                  {appState === AppState.GENERATING ? 'PROCESSING...' : (hasVectorData ? 'VECTOR ENGINE ACTIVE' : 'RASTER ENGINE ACTIVE')}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[9px] text-slate-500 uppercase">Analysis</div>
                <div className="text-slate-300 italic text-[10px] leading-relaxed border-l-2 border-slate-700 pl-2 whitespace-pre-wrap">
                  {auditText || "Waiting for geometry..."}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col min-h-0 flex-1">
            <div className="p-2 bg-[#333] font-bold text-gray-100 border-b border-black text-[10px] uppercase tracking-wider shrink-0">Layer Control</div>
            <div className="flex-grow overflow-y-auto p-2 space-y-1 bg-[#1a1a1a] custom-scrollbar">
              {['0', 'A-WALL', 'A-DOOR', 'A-GLAZ', 'A-FURN'].map(layer => (
                <div key={layer} className="flex items-center gap-2 hover:bg-[#333] p-1.5 cursor-pointer rounded text-slate-400 hover:text-white">
                  <div className="w-3 h-3 rounded-sm border border-slate-600 bg-slate-800"></div>
                  <span>{layer}</span>
                  <span className="ml-auto text-[9px] text-emerald-600">ON</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CENTER: VIEWPORT */}
        <div className="flex-grow relative bg-[#0f172a] shadow-inner flex flex-col min-w-0">
          <div className="flex-grow relative overflow-hidden">
            {/* Render either the vector plan OR the image fallback */}
            {(activeFloorPlan || activeImage) && (
              <PanZoomViewer
                src={activeImage || undefined}
                floorPlan={activeFloorPlan}
                isLoading={appState === AppState.GENERATING}
                mode={mode}
                onCoordinateMove={(x, y) => setCoords({ x, y })}
              />
            )}

            <div className="absolute top-4 left-4 pointer-events-none">
              <div className={`px-3 py-1 rounded border shadow-2xl backdrop-blur-md ${mode === 'PLAN' ? 'bg-black/80 border-emerald-500/50 text-emerald-400' : 'bg-black/80 border-purple-500/50 text-purple-400'}`}>
                <span className="font-black uppercase tracking-[0.2em]">{mode} VIEW</span>
              </div>
            </div>
          </div>

          {/* COMMAND LINE */}
          <div className="h-auto min-h-[40px] bg-[#2b2b2b] border-t border-black p-2 flex items-center gap-2 shrink-0 z-10">
            <span className="font-black text-slate-400 uppercase text-[10px] select-none">COMMAND:</span>
            <input
              autoFocus
              className="flex-grow bg-[#1a1a1a] border border-slate-600 rounded-sm px-3 py-1.5 text-slate-200 font-mono text-[12px] outline-none focus:border-emerald-500 focus:bg-black transition-colors placeholder-slate-600"
              placeholder={mode === 'PLAN' ? "e.g. 'Move wall w1 2m right', 'Add door to w2'" : "e.g. 'Modern minimalist style', 'Sunset lighting'"}
              value={currentPrompt}
              onChange={(e) => setCurrentPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleGenerate(); }}
            />
            <button
              onClick={handleGenerate}
              className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white font-bold uppercase rounded-sm text-[10px] transition-colors"
            >
              {mode === 'PLAN' ? 'Execute' : 'Render'}
            </button>
          </div>

          {/* STATUS BAR */}
          <div className="h-6 bg-[#1a1a1a] border-t border-slate-800 flex items-center px-4 justify-between text-[9px] font-bold text-slate-500 uppercase select-none">
            <div className="flex gap-4">
              <span>{coords.x.toFixed(2)}, {coords.y.toFixed(2)}</span>
              <span className="text-slate-700">|</span>
              <span className="text-emerald-600">SNAP</span>
              <span className="text-emerald-600">ORTHO</span>
            </div>
            <div>
              <span>1:100</span>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: HISTORY */}
        <div className="w-72 bg-[#262626] border-l border-black flex flex-col shrink-0 min-h-0">
          <div className="p-2 bg-[#333] font-bold text-gray-100 border-b border-black text-[10px] uppercase tracking-wider shrink-0">Command History</div>
          <div className="flex-grow overflow-y-auto p-3 space-y-4 bg-[#1a1a1a] custom-scrollbar">
            {history.map((step, idx) => (
              <div key={step.id} className="flex flex-col gap-2 animate-in fade-in slide-in-from-right-2 duration-300">
                {step.role === 'user' && (
                  <div className="text-slate-400 flex gap-2 border-b border-slate-800 pb-1">
                    <span className="text-emerald-600 font-bold">{'>>>'}</span>
                    <span className="font-mono text-[10px]">{step.text}</span>
                  </div>
                )}
                {step.role === 'model' && (
                  <div className="space-y-2 pl-2">
                    <div className="text-[9px] text-emerald-500 font-bold bg-emerald-900/10 px-2 py-1 inline-block rounded">
                      {step.text || "DONE"}
                    </div>
                    {step.images && (
                      <div className="grid grid-cols-1 gap-2">
                        {step.images.map((img, i) => (
                          <div
                            key={i}
                            onClick={() => {
                              const newHistory = [...history];
                              newHistory[idx].selectedImageIndex = i;
                              setHistory(newHistory);
                            }}
                            className={`relative cursor-pointer border-2 transition-all group ${step.selectedImageIndex === i ? 'border-emerald-500' : 'border-slate-700 opacity-60 hover:opacity-100'}`}
                          >
                            <img src={img} className="w-full h-auto bg-black" />
                            {step.selectedImageIndex === i && <div className="absolute inset-0 bg-emerald-500/10 pointer-events-none"></div>}
                            <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 bg-black/80 text-white text-[8px] px-1 rounded">RESTORE</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={scrollRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
