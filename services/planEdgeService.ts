/**
 * Browser-side edge extraction for architectural floor plans.
 *
 * Phase 3.1 — pseudo-ControlNet workaround:
 * gpt-image-2 accepts multiple input images. When we render a 2D plan to a
 * 3D scene, we send (a) the original plan, (b) an edge-isolated version of
 * the same plan, and (c) instruct the model to treat the edge map as the
 * exact wall geometry to trace.
 *
 * Architectural plans are inherently line-based — a simple grayscale +
 * threshold pass isolates walls/openings cleanly, no Canny library needed.
 * If the plan has thin lines, we dilate them so the model "sees" the
 * geometry as a clean B&W stencil.
 */

/**
 * Convert a base64/data-URL image into a high-contrast edge stencil.
 * Returns a data:image/png base64 string.
 *
 * Pipeline:
 *   1. Load image into an OffscreenCanvas (or HTMLCanvas fallback)
 *   2. Grayscale
 *   3. Threshold (dark pixels → black/line; light → white/space)
 *   4. Optional dilation pass to thicken thin lines (architects' plans
 *      often have hairline strokes that a vision model misses)
 *   5. Encode to PNG
 *
 * threshold: 0-255. Default 160 — covers typical printed/DWG-export plans.
 * dilate: number of 1-pixel passes to thicken lines. Default 1.
 */
export async function planToEdgeMap(
  source: string,
  options: { threshold?: number; dilate?: number; maxSize?: number } = {},
): Promise<string> {
  const threshold = options.threshold ?? 160;
  const dilate = options.dilate ?? 1;
  const maxSize = options.maxSize ?? 2048;

  const img = await loadImage(source);
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d unavailable');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const px = imageData.data;

  // 1. Grayscale + threshold inline
  const bin = new Uint8Array(w * h); // 1 = line, 0 = space
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const gray = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
    bin[j] = gray < threshold ? 1 : 0;
  }

  // 2. Dilate (4-neighbor) — thicken thin lines
  for (let pass = 0; pass < dilate; pass++) {
    const next = new Uint8Array(bin.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (bin[idx]) { next[idx] = 1; continue; }
        if (
          (x > 0     && bin[idx - 1]) ||
          (x < w - 1 && bin[idx + 1]) ||
          (y > 0     && bin[idx - w]) ||
          (y < h - 1 && bin[idx + w])
        ) {
          next[idx] = 1;
        }
      }
    }
    bin.set(next);
  }

  // 3. Render bin back to canvas: line = pure black, space = pure white
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = bin[j] ? 0 : 255;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}
