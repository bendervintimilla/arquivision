
import React, { useState, useRef } from "react";
import { processPdf, processDxf } from "../services/fileService";

interface ImageUploaderProps {
  onImageSelected: (base64: string, mimeType: string, meta?: any) => void;
  maxSizeMB?: number;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({
  onImageSelected,
  maxSizeMB = 50,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<'IDLE' | 'PROCESSING'>('IDLE');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    
    setStatus('PROCESSING');
    try {
      if (ext === 'pdf') {
        const img = await processPdf(file);
        onImageSelected(img, "image/png", { format: 'Vector PDF', name: file.name });
      } else if (ext === 'dxf' || ext === 'dwg') {
        // Process both DWG and DXF via our service (which handles binary fallback)
        const result = await processDxf(file);
        onImageSelected(result.image, "image/png", { 
            format: ext.toUpperCase() + ' Drawing', 
            manifest: result.manifest, 
            name: file.name,
            isPlaceholder: result.image.includes('BINARY_DWG_MODE') // Flag for UI to auto-trigger AI
        });
      } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext || '')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          onImageSelected(e.target?.result as string, file.type, { format: 'Raster Image', name: file.name });
        };
        reader.readAsDataURL(file);
      } else {
        alert("File format not supported. Please use .dwg, .dxf, .pdf, or images.");
      }
    } catch (err) {
      console.error(err);
      alert("An unexpected error occurred reading the file.");
    } finally {
      setStatus('IDLE');
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]); }}
      className={`relative border-2 border-dashed rounded-[1.5rem] p-10 text-center transition-all duration-300 group cursor-pointer
        ${isDragging ? "border-emerald-500 bg-emerald-500/10 scale-[1.02]" : "border-slate-700 bg-slate-900/40 hover:bg-slate-800 hover:border-slate-500"}
        ${status === 'PROCESSING' ? 'opacity-50 pointer-events-none' : ''}
      `}
      onClick={() => fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".dxf,.dwg,.pdf,image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0]!)}
      />
      <div className="flex flex-col items-center gap-4">
        {status === 'PROCESSING' ? (
          <div className="flex flex-col items-center py-6">
            <div className="w-14 h-14 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-emerald-400 font-mono text-xs uppercase tracking-[0.2em] animate-pulse">
              Parsing CAD Geometry...
            </p>
          </div>
        ) : (
          <>
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center text-slate-400 group-hover:text-emerald-400 group-hover:from-slate-800 group-hover:to-emerald-900/20 transition-all shadow-xl border border-slate-700 group-hover:border-emerald-500/30">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-white tracking-tight">Open Project Plan</h3>
              <p className="text-xs text-slate-500 font-mono">
                Supports <span className="text-emerald-400 font-bold">.DWG, .DXF</span>, PDF, Images
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
