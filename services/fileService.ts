
import DxfParser from 'https://esm.sh/dxf-parser@1.1.2';
import { FloorPlan } from '../types';
import { parseRawEntitiesToFloorPlan, renderPlanToCanvas, MOCK_FLOOR_PLAN } from './cadService';

// Declare pdfjsLib
declare const pdfjsLib: any;

export const processPdf = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const typedarray = new Uint8Array(e.target?.result as ArrayBuffer);
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 3.0 });
        const canvas = document.createElement('canvas');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        resolve(canvas.toDataURL('image/png'));
      } catch (err) { reject(err); }
    };
    reader.readAsArrayBuffer(file);
  });
};

export const processDxf = async (file: File): Promise<{ image: string, manifest: string, floorPlan?: FloorPlan }> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        
        // --- BACKEND SIMULATION ---
        // If it's a binary DWG (starts with AC), we simulate a backend conversion by returning our MOCK_FLOOR_PLAN.
        // This is necessary because binary DWG conversion is impossible in a pure browser environment without a server.
        if (content.startsWith('AC') || file.name.toLowerCase().endsWith('.dwg')) {
           
           // Render the Mock Plan to an image for the thumbnail
           const canvas = document.createElement('canvas');
           canvas.width = 1024; canvas.height = 768;
           renderPlanToCanvas(MOCK_FLOOR_PLAN, canvas);
           
           resolve({ 
             image: canvas.toDataURL('image/png'), 
             manifest: `[BACKEND SIMULATION] Converted ${file.name} to vector data.`,
             floorPlan: MOCK_FLOOR_PLAN // <--- KEY: Return vector data so the editor works
           });
           return;
        }

        // Handle Text-based DXF (Real parsing)
        const parser = new DxfParser();
        let dxf = null;
        try {
            dxf = parser.parseSync(content);
        } catch (parseErr) {
            console.error("DXF Parse Error", parseErr);
            throw new Error("Invalid DXF structure");
        }

        if (!dxf || !dxf.entities) throw new Error("No entities found");
        
        const floorPlan = parseRawEntitiesToFloorPlan(dxf.entities, file.name);
        
        const canvas = document.createElement('canvas');
        canvas.width = 2048;
        canvas.height = 1536;
        renderPlanToCanvas(floorPlan, canvas);

        resolve({ 
            image: canvas.toDataURL('image/png'), 
            manifest: `Parsed ${dxf.entities.length} vector entities.`, 
            floorPlan 
        });

      } catch (err) {
        console.warn("File processing failed.", err);
        resolve({
            image: "",
            manifest: "Error parsing file."
        });
      }
    };
    
    // Read as text. For binary DWG, this produces garbage characters, but enough for us to detect the 'AC' header.
    reader.readAsText(file);
  });
};
