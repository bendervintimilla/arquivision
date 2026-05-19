
import DxfParser from 'dxf-parser';
import { FloorPlan } from '../types';
import { parseRawEntitiesToFloorPlan, renderPlanToCanvas, MOCK_FLOOR_PLAN } from './cadService';

// Declare pdfjsLib
declare const pdfjsLib: any;

/**
 * Compresses and resizes an image to prevent massive Base64 payloads 
 * crashing mobile Safari or throwing HTTP 413/504 errors.
 * 
 * @param file The original image File.
 * @param maxWidth Max permitted width in pixels (default 2048)
 * @param maxHeight Max permitted height in pixels (default 2048)
 * @param quality JPEG compression quality (0.0 to 1.0)
 * @returns A promise that resolves to the compressed Data URL (image/jpeg)
 */
export const compressImage = async (
  file: File,
  maxWidth: number = 2048,
  maxHeight: number = 2048,
  quality: number = 0.8
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Calculate new dimensions preserving aspect ratio
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }

        // Draw onto canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          // Fallback if canvas fails
          resolve(event.target?.result as string);
          return;
        }

        // Fill background with white in case of transparent PNGs -> JPEG
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        // Smooth scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to highly-compressed JPEG base64 Data URL
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };

      img.onerror = () => reject(new Error('Failed to load image for compression'));
      img.src = event.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file for compression'));
    reader.readAsDataURL(file);
  });
};

/**
 * Quality-tier-aware compression for image generation input.
 * Higher tiers preserve more resolution and use lossless PNG to give the 
 * Gemini model the best possible input for high-fidelity output.
 * 
 * @param base64DataUrl - The existing base64 data URL image
 * @param qualityTier - 0=Draft, 1=Standard, 2=HD, 3=Ultra
 * @returns A promise that resolves to the appropriately compressed Data URL
 */
export const compressImageForTier = async (
  base64DataUrl: string,
  qualityTier: number = 2
): Promise<string> => {
  // Tier-specific settings
  const tierSettings: Record<number, { maxDim: number; format: string; quality: number }> = {
    0: { maxDim: 1024, format: 'image/jpeg', quality: 0.70 },
    1: { maxDim: 1536, format: 'image/jpeg', quality: 0.80 },
    2: { maxDim: 2048, format: 'image/jpeg', quality: 0.85 },
    3: { maxDim: 4096, format: 'image/png', quality: 1.0 }, // Ultra: full resolution PNG
  };

  const settings = tierSettings[qualityTier] ?? tierSettings[2];

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.naturalWidth;
      let height = img.naturalHeight;

      // Skip re-compression if image is already smaller than tier limit
      // and we're not changing format
      if (width <= settings.maxDim && height <= settings.maxDim) {
        // For Ultra tier, still convert to PNG if it's currently JPEG
        if (qualityTier === 3 && base64DataUrl.includes('image/jpeg')) {
          // Fall through to re-encode as PNG
        } else {
          resolve(base64DataUrl);
          return;
        }
      }

      // Scale down if needed
      if (width > settings.maxDim) {
        height = Math.round((height * settings.maxDim) / width);
        width = settings.maxDim;
      }
      if (height > settings.maxDim) {
        width = Math.round((width * settings.maxDim) / height);
        height = settings.maxDim;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(base64DataUrl); return; }

      // High-quality scaling
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // White background for JPEG (transparent PNG doesn't need it)
      if (settings.format === 'image/jpeg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Use toBlob for better quality control
      canvas.toBlob((blob) => {
        if (blob) {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        } else {
          resolve(canvas.toDataURL(settings.format, settings.quality));
        }
      }, settings.format, settings.quality);
    };

    img.onerror = () => resolve(base64DataUrl);
    img.src = base64DataUrl;
  });
};

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
