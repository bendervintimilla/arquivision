import React from 'react';

interface ComparisonViewProps {
  original: string;
  generated: string | null;
  isLoading: boolean;
}

export const ComparisonView: React.FC<ComparisonViewProps> = ({ original, generated, isLoading }) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
      {/* Original Image */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Original Input</h3>
        </div>
        <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-800 border border-slate-700 shadow-xl group">
          <img 
            src={original} 
            alt="Original" 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
            <span className="text-white text-sm font-medium">Source Screenshot</span>
          </div>
        </div>
      </div>

      {/* Generated Result */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider">
            {isLoading ? 'Generating...' : generated ? 'Render Result' : 'Output Preview'}
          </h3>
          {generated && (
             <a 
               href={generated} 
               download="architectural-render.png"
               className="text-xs flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors"
             >
               <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                 <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                 <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
               </svg>
               Download
             </a>
          )}
        </div>
        
        <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-800 border border-slate-700 shadow-xl flex items-center justify-center">
          {isLoading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm z-10">
               <div className="w-12 h-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mb-4"></div>
               <p className="text-emerald-400 text-sm font-medium animate-pulse">Designing...</p>
               <p className="text-slate-500 text-xs mt-2">Gemini 2.5 is thinking</p>
            </div>
          ) : null}

          {generated ? (
            <img 
              src={generated} 
              alt="Generated" 
              className="w-full h-full object-cover animate-in fade-in duration-700"
            />
          ) : (
            !isLoading && (
              <div className="text-slate-600 flex flex-col items-center text-center p-6">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mb-2 opacity-50">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                 </svg>
                 <span className="text-sm">Output will appear here</span>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};