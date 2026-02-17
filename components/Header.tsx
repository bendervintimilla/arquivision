import React, { useState } from 'react';
import { UserMenu } from './UserMenu';

export const Header: React.FC = () => {
  const [logoError, setLogoError] = useState(false);

  return (
    <header className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Logo Container */}
          <div className="relative w-10 h-10 rounded-lg overflow-hidden border border-slate-600 bg-slate-800 shadow-lg shadow-emerald-500/20 flex items-center justify-center">
             {!logoError ? (
               <img
                 src="./logo.png"
                 alt="Bender Logo"
                 className="w-full h-full object-cover"
                 onError={() => setLogoError(true)}
               />
             ) : (
               /* Robot Fallback Icon */
               <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-emerald-400">
                 <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M7.5 13a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5m9 0a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5" />
               </svg>
             )}
          </div>
          <span className="text-xl font-bold text-slate-100 tracking-tight">Bender archivision<span className="text-emerald-500">AI</span></span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs font-mono text-slate-400 border border-slate-700 rounded-full px-2 py-1 bg-slate-800 hidden md:inline">
            Powered by Gemini 2.5 & BENDERVP
          </span>
          <UserMenu />
        </div>
      </div>
    </header>
  );
};