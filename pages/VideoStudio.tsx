
import React, { useState } from 'react';
import { RenderAsset, AppState } from '../types';
import { generateArchitecturalVideo } from '../services/geminiService';

interface VideoStudioProps {
    gallery: RenderAsset[];
}

const MOTION_PRESETS = [
    { id: 'pan', label: 'Slow Pan', prompt: 'Slow smooth camera pan showing the entire space' },
    { id: 'zoom', label: 'Dolly In', prompt: 'Slow cinematic dolly in movement towards the focal point' },
    { id: 'orbit', label: 'Orbit', prompt: 'Gentle orbital camera movement around the center' },
    { id: 'drone', label: 'Drone Fly', prompt: 'Smooth drone flythrough showing depth' },
];

export const VideoStudio: React.FC<VideoStudioProps> = ({ gallery }) => {
    const [selectedAsset, setSelectedAsset] = useState<RenderAsset | null>(null);
    const [motionType, setMotionType] = useState(MOTION_PRESETS[0]);
    const [customPrompt, setCustomPrompt] = useState('');
    const [status, setStatus] = useState<AppState>(AppState.IDLE);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string>('');

    const handleGenerate = async () => {
        if (!selectedAsset) return;
        setStatus(AppState.GENERATING);
        setVideoUrl(null);
        setErrorMessage('');
        try {
            // Combine the user's custom description with the technical motion preset
            // AND inject architectural context from the source render
            const sceneContext = selectedAsset.prompt ? `Scene: ${selectedAsset.prompt}. ` : '';
            const finalPrompt = `${sceneContext}${customPrompt ? customPrompt + '. ' : ''}${motionType.prompt}`;
            const url = await generateArchitecturalVideo(selectedAsset.url, finalPrompt);
            setVideoUrl(url);
            setStatus(AppState.COMPLETE);
        } catch (e: any) {
            console.error('[VideoStudio] Generation failed:', e);
            setErrorMessage(e?.message || 'Unknown error during video generation');
            setStatus(AppState.ERROR);
        }
    };

    const compatibleAssets = gallery.filter(g => g.type === 'IMAGE');

    return (
        <div className="flex flex-col md:flex-row h-full bg-[#0a0f1d] text-slate-200">

            {/* GALLERY SELECTION (Sidebar on Desktop, Horizontal Strip on Mobile) */}
            <div className="w-full md:w-80 h-auto md:h-full border-b md:border-b-0 md:border-r border-slate-800 bg-[#161b2e] flex flex-col flex-shrink-0 z-10 shadow-xl md:shadow-none">
                <div className="p-4 border-b border-slate-800 flex justify-between items-center md:block">
                    <div>
                        <h2 className="text-sm font-black uppercase tracking-widest text-emerald-500">Render Gallery</h2>
                        <p className="text-xs text-slate-500 mt-1 hidden md:block">Select an image to animate</p>
                    </div>
                    <span className="text-[10px] text-slate-500 md:hidden bg-slate-800 px-2 py-1 rounded-full">
                        {compatibleAssets.length} Available
                    </span>
                </div>

                {/* Scroll Container */}
                <div className="flex md:flex-col overflow-x-auto md:overflow-y-auto p-4 gap-4 custom-scrollbar snap-x">
                    {compatibleAssets.length === 0 && (
                        <div className="text-center py-4 md:py-10 text-slate-600 text-xs w-full">
                            No renders yet. <br className="hidden md:block" />Generate images in the other tabs first.
                        </div>
                    )}
                    {compatibleAssets.map(asset => (
                        <div
                            key={asset.id}
                            onClick={() => { setSelectedAsset(asset); setVideoUrl(null); setStatus(AppState.IDLE); }}
                            className={`
                            relative flex-shrink-0 cursor-pointer rounded-xl overflow-hidden border-2 transition-all snap-center
                            w-40 md:w-full aspect-video md:aspect-video
                            ${selectedAsset?.id === asset.id ? 'border-emerald-500 ring-2 ring-emerald-500/30 scale-[1.02]' : 'border-transparent opacity-70 hover:opacity-100'}
                        `}
                        >
                            <img src={asset.url} className="w-full h-full object-cover" />
                            <div className="absolute bottom-0 left-0 right-0 bg-slate-900/90 p-2 text-[10px] text-slate-400 truncate border-t border-slate-800">
                                {asset.prompt.substring(0, 30)}...
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* CENTER: STUDIO (Scrollable) */}
            <div className="flex-grow flex flex-col overflow-y-auto custom-scrollbar bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-fixed">
                <div className="min-h-full p-4 md:p-8 flex flex-col items-center pb-20 md:pb-8">
                    <div className="w-full max-w-5xl space-y-6 md:space-y-8">

                        {/* PREVIEW AREA */}
                        <div className="aspect-video bg-black rounded-2xl border border-slate-700 shadow-2xl overflow-hidden relative group">
                            {!selectedAsset && (
                                <div className="absolute inset-0 flex items-center justify-center text-slate-600 flex-col gap-4 p-4 text-center">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 md:w-16 md:h-16 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.818v6.364a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                    <span className="text-sm">Select a render from the {window.innerWidth < 768 ? 'top' : 'left'} gallery</span>
                                </div>
                            )}

                            {selectedAsset && !videoUrl && status !== AppState.GENERATING && (
                                <img src={selectedAsset.url} className="w-full h-full object-contain opacity-50 blur-sm scale-105" />
                            )}

                            {status === AppState.GENERATING && (
                                <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center z-20 p-4">
                                    <div className="w-16 h-16 md:w-20 md:h-20 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-6" />
                                    <div className="text-center">
                                        <span className="text-lg md:text-xl font-bold text-emerald-400 animate-pulse">Generating Video</span>
                                        <p className="text-slate-500 text-xs md:text-sm mt-2">Running Veo-3.1 Model... <br />This may take a minute.</p>
                                    </div>
                                </div>
                            )}

                            {videoUrl && (
                                <video src={videoUrl} controls autoPlay loop className="w-full h-full object-contain bg-black" />
                            )}

                            {/* Status Error Message */}
                            {status === AppState.ERROR && (
                                <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-30 p-4">
                                    <div className="text-red-400 text-center p-6 border border-red-900 bg-red-900/20 rounded-xl max-w-sm">
                                        <p className="font-bold mb-2">Generation Failed</p>
                                        <p className="text-sm opacity-70">{errorMessage || 'Unknown error. Check console for details.'}</p>
                                        <button onClick={() => { setStatus(AppState.IDLE); setErrorMessage(''); }} className="mt-4 px-4 py-2 bg-slate-800 rounded hover:bg-slate-700 text-xs">Try Again</button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* CONTROLS */}
                        {selectedAsset && (
                            <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-700 p-4 md:p-6 rounded-2xl animate-in slide-in-from-bottom-4 shadow-2xl">

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                                    {/* Motion Selection */}
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-4">
                                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">1. Camera Motion</span>
                                            <div className="h-px bg-slate-800 flex-grow"></div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            {MOTION_PRESETS.map(preset => (
                                                <button
                                                    key={preset.id}
                                                    onClick={() => setMotionType(preset)}
                                                    className={`p-3 rounded-xl border text-left transition-all ${motionType.id === preset.id ? 'bg-emerald-900/20 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}
                                                >
                                                    <div className="font-bold text-sm mb-1">{preset.label}</div>
                                                    <div className="text-[10px] opacity-70 leading-tight hidden sm:block">{preset.prompt}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Prompt Input */}
                                    <div className="space-y-4 flex flex-col">
                                        <div className="flex items-center gap-4">
                                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">2. Video Style Description</span>
                                            <div className="h-px bg-slate-800 flex-grow"></div>
                                        </div>
                                        <textarea
                                            value={customPrompt}
                                            onChange={(e) => setCustomPrompt(e.target.value)}
                                            placeholder="E.g. Warm sunset lighting, shadows moving across the floor, cinematic film grain, highly detailed 8k..."
                                            className="flex-grow min-h-[100px] md:min-h-0 bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none resize-none transition-all"
                                        />
                                    </div>
                                </div>

                                {/* Generate Button */}
                                <div className="mt-8 pt-6 border-t border-slate-800 flex justify-end">
                                    <button
                                        onClick={handleGenerate}
                                        disabled={status === AppState.GENERATING}
                                        className="w-full md:w-auto px-8 py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl md:rounded-full font-bold text-lg shadow-2xl shadow-emerald-900/50 hover:scale-105 transition-all flex items-center justify-center gap-3"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        {status === AppState.GENERATING ? 'GENERATING...' : 'GENERATE VIDEO'}
                                    </button>
                                </div>

                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
