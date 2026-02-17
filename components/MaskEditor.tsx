import React, { useRef, useEffect, useState, useLayoutEffect } from 'react';

interface MaskEditorProps {
  imageBase64: string;
  onConfirm: (maskBase64: string) => void;
  onCancel: () => void;
}

export const MaskEditor: React.FC<MaskEditorProps> = ({ imageBase64, onConfirm, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(50); // Larger default for easier mobile use
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Track the actual rendered dimensions of the image on the screen
  const [renderedDims, setRenderedDims] = useState<{ width: number; height: number; left: number; top: number }>({ 
    width: 0, height: 0, left: 0, top: 0 
  });
  const [imageLoaded, setImageLoaded] = useState(false);

  // Measure the rendered image to align canvas perfectly
  const measureImage = () => {
    if (imageRef.current) {
        const rect = imageRef.current.getBoundingClientRect();
        const containerRect = containerRef.current?.getBoundingClientRect();
        
        if (rect.width > 0 && rect.height > 0 && containerRect) {
            // Calculate position relative to container
            setRenderedDims({
                width: rect.width,
                height: rect.height,
                left: rect.left - containerRect.left,
                top: rect.top - containerRect.top
            });

            // Update canvas resolution to match image natural resolution
            if (canvasRef.current) {
                // We keep the internal resolution matching the source image for high quality masking
                if (canvasRef.current.width !== imageRef.current.naturalWidth) {
                    canvasRef.current.width = imageRef.current.naturalWidth;
                    canvasRef.current.height = imageRef.current.naturalHeight;
                }
            }
        }
    }
  };

  useLayoutEffect(() => {
    if (imageLoaded) {
        measureImage();
        // Add listener for both resize and orientation change
        window.addEventListener('resize', measureImage);
        window.addEventListener('orientationchange', measureImage);
        return () => {
            window.removeEventListener('resize', measureImage);
            window.removeEventListener('orientationchange', measureImage);
        };
    }
  }, [imageLoaded]);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    if (!canvasRef.current || !imageRef.current) return { x: 0, y: 0 };
    
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;

    let clientX, clientY;

    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const scale = canvasRef.current.width / rect.width;
      
      ctx.lineWidth = brushSize * scale; 
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)'; // Red
      
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !canvasRef.current) return;
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) ctx.closePath();
  };

  const handleDone = () => {
    if (canvasRef.current && imageRef.current) {
      setIsProcessing(true);
      
      // Use requestAnimationFrame to let the UI update (show "Processing") before blocking the thread
      requestAnimationFrame(() => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvasRef.current!.width;
        tempCanvas.height = canvasRef.current!.height;
        const tCtx = tempCanvas.getContext('2d');
        
        if (tCtx) {
          // Optimized Mask Generation (GPU accelerated typically)
          // 1. Draw the user's Red strokes onto the fresh canvas
          tCtx.drawImage(canvasRef.current!, 0, 0);

          // 2. Change all Red pixels (anything drawn) to Pure White
          // 'source-in' keeps the intersection of the new fill (white) and existing alpha (strokes)
          tCtx.globalCompositeOperation = 'source-in';
          tCtx.fillStyle = '#FFFFFF';
          tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

          // 3. Fill the background (transparent areas) with Black
          // 'destination-over' draws behind existing content
          tCtx.globalCompositeOperation = 'destination-over';
          tCtx.fillStyle = '#000000';
          tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

          // Reset composite operation just in case
          tCtx.globalCompositeOperation = 'source-over';
          
          onConfirm(tempCanvas.toDataURL('image/png'));
        }
        setIsProcessing(false);
      });
    }
  };
  
  const handleClear = () => {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && canvasRef.current) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col items-center justify-center p-0 animate-in fade-in duration-200">
      
      {/* Toolbar */}
      <div className="absolute top-4 left-0 right-0 z-50 flex justify-center pointer-events-none">
        <div className="bg-slate-900/90 backdrop-blur-md p-3 rounded-2xl flex flex-wrap justify-center gap-4 items-center shadow-2xl border border-slate-700 pointer-events-auto">
            <span className="text-white text-xs font-bold px-2 border-r border-slate-700 hidden sm:block">MASK MODE</span>
            
            <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400 uppercase tracking-wider">Size</span>
                <input 
                type="range" 
                min="10" 
                max="300" 
                value={brushSize} 
                onChange={(e) => setBrushSize(parseInt(e.target.value))} 
                className="w-24 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-red-500"
                />
                <div 
                className="w-4 h-4 rounded-full bg-red-500/80 border border-slate-500"
                style={{ transform: `scale(${brushSize/40})` }}
                />
            </div>

            <div className="flex gap-2 border-l border-slate-700 pl-4">
                <button onClick={handleClear} disabled={isProcessing} className="px-3 py-1.5 bg-slate-800 text-slate-300 text-xs font-medium rounded hover:bg-slate-700 transition-all border border-slate-600">
                    Clear
                </button>
                <button onClick={onCancel} disabled={isProcessing} className="px-4 py-1.5 bg-slate-800 text-slate-300 text-xs font-medium rounded hover:bg-slate-700 transition-all border border-slate-600">
                    Cancel
                </button>
                <button onClick={handleDone} disabled={isProcessing} className="px-5 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-500 shadow-lg shadow-emerald-900/50 transition-all flex items-center gap-2">
                    {isProcessing ? 'Saving...' : 'Apply'}
                </button>
            </div>
        </div>
      </div>

      {/* Editor Area */}
      <div 
        ref={containerRef}
        className="relative w-full h-full flex items-center justify-center bg-black/80 overflow-hidden cursor-crosshair touch-none select-none"
      >
        {!imageLoaded && (
             <div className="text-white animate-pulse">Loading image for editing...</div>
        )}

        {/* Background Image */}
        <img 
          ref={imageRef}
          src={imageBase64} 
          className="max-w-full max-h-full object-contain pointer-events-none select-none"
          alt="Reference"
          onLoad={() => setImageLoaded(true)}
          draggable={false}
        />
        
        {/* Canvas Overlay */}
        <canvas
          ref={canvasRef}
          className="absolute touch-none"
          style={{ 
              width: renderedDims.width, 
              height: renderedDims.height,
              top: renderedDims.top,
              left: renderedDims.left,
              opacity: 0.8 // Slight transparency to see what's under the red
          }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
      
      <div className="absolute bottom-6 bg-slate-900/80 px-4 py-2 rounded-full text-slate-400 text-xs pointer-events-none backdrop-blur-sm border border-slate-800">
        Paint RED over the area to change.
      </div>
    </div>
  );
};