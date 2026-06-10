
import { AUTOCAD_PROMPT_LOGIC, buildIntentClassifierPrompt, buildSceneAnalysisPrompt, buildEditPrompt } from "./autocadService";
import { PlanAnalysis, Room, FloorPlan, EditIntent, SceneAnalysis, PageRole, EditContextPreferences } from "../types";
import { AIContext, formatContextForPrompt, formatContextForImagePrompt } from "./contextService";
import { backendApi, GenerationMeta } from "./backendApiService";
import { compressImageForTier } from "./fileService";

// SECURITY: All Gemini API calls go through the backend proxy.
// The API key is NEVER present in the frontend bundle.
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
if (!BACKEND_URL) {
  console.error('[SECURITY] VITE_BACKEND_URL is not configured. AI features will not work.');
}

/**
 * Convert a blob: URL to a data:base64 string.
 * Returns the input unchanged if it's already a data: URL or plain base64.
 */
async function ensureBase64(urlOrData: string | null | undefined): Promise<string | null> {
  if (!urlOrData) return null;
  if (urlOrData.startsWith('data:')) return urlOrData;
  if (urlOrData.startsWith('blob:')) {
    try {
      const resp = await fetch(urlOrData);
      const blob = await resp.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.error('[ensureBase64] Failed to convert blob URL:', e);
      return null;
    }
  }
  // Assume it's already raw base64 or a valid string
  return urlOrData;
}

// --- Scene analysis cache (per-session) ---
let cachedSceneAnalysis: SceneAnalysis | null = null;
let cachedSceneImageHash: string | null = null;

/**
 * Compute a better hash for cache keying base64 images.
 * Samples characters from different positions to avoid the identical prefix problem.
 */
function imageHash(str: string): string {
  if (str.length < 200) return str;
  // Sample from multiple positions + length for uniqueness
  const s1 = str.slice(100, 200);
  const s2 = str.slice(Math.floor(str.length / 2), Math.floor(str.length / 2) + 100);
  const s3 = str.slice(-100);
  return `${s1}|${s2}|${s3}|${str.length}`;
}

export function clearSceneCache(): void {
  cachedSceneAnalysis = null;
  cachedSceneImageHash = null;
}

// ==========================================
// INTELLIGENCE LAYER
// ==========================================

/**
 * Step 1: Classify user intent (fast, text-only).
 * Uses gemini-3-flash for speed.
 */
export const classifyIntent = async (userCommand: string): Promise<EditIntent> => {
  try {
    const result = await backendApi.classifyIntent({ command: userCommand });
    return result.intent;
  } catch (e) {
    console.error("Intent classification failed, using defaults:", e);
    return {
      mode: 'EDIT',
      scale: 'MIXED',
      preserveLayout: true,
      preserveLighting: true,
      preservePerspective: true,
      elementsToChange: [],
      elementsToKeep: [],
      confidence: 0.5
    };
  }
};

/**
 * Step 2: Analyze the scene in the image (cached per image).
 * Uses gemini-3-flash vision for speed.
 */
export const analyzeScene = async (imageBase64: string): Promise<SceneAnalysis> => {
  const hash = imageHash(imageBase64);

  // Return cached if same image
  if (cachedSceneAnalysis && cachedSceneImageHash === hash) {
    return cachedSceneAnalysis;
  }

  try {
    const result = await backendApi.analyzeScene({ image: imageBase64 });
    cachedSceneAnalysis = result.analysis;
    cachedSceneImageHash = hash;
    return result.analysis;
  } catch (e) {
    console.error("Scene analysis failed:", e);
    return {
      description: 'Scene analysis unavailable',
      objects: [],
      architecture: 'Unknown',
      cameraAngle: 'Unknown',
      lighting: 'Unknown',
      colorPalette: [],
      spatialLayout: 'Unknown'
    };
  }
};


// ==========================================
// WATERMARK
// ==========================================

const applyWatermark = async (base64Image: string, text: string): Promise<string> => {
  if (!text) return base64Image;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // CRITICAL: Use exact pixel dimensions from the original image
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) { resolve(base64Image); return; }

      // Use high-quality smoothing for the base image draw to prevent jagged edges
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);

      const fontSize = Math.max(16, Math.floor(img.naturalHeight * 0.025));
      const padding = Math.floor(fontSize);

      ctx.font = `500 ${fontSize}px "Inter", sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';

      const x = canvas.width - padding;
      const y = canvas.height - padding;
      const watermarkText = text.toUpperCase();

      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 2;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;

      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.fillText(watermarkText, x, y);

      // Use toBlob for better quality, fallback to toDataURL
      canvas.toBlob((blob) => {
        if (blob) {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        } else {
          resolve(canvas.toDataURL('image/png'));
        }
      }, 'image/png');
    };

    img.onerror = (e) => {
      console.error("Watermark failed to load image", e);
      resolve(base64Image);
    };

    img.src = base64Image;
  });
};


// ==========================================
// EXISTING SERVICES (upgraded)
// ==========================================

export const auditArchitecture = async (_manifest: string): Promise<string> => {
  // TODO: Implement via backend proxy endpoint when needed
  return "Geometric analysis pending...";
};

export const analyzePlanImage = async (base64Image: string): Promise<PlanAnalysis> => {
  try {
    const { result } = await backendApi.analyzePlan({
      image: base64Image,
      prompt: AUTOCAD_PROMPT_LOGIC.PLAN_ANALYSIS,
    });
    return result as PlanAnalysis;
  } catch (e) {
    console.error("Plan analysis failed", e);
    return { rooms: [], notes: "Analysis failed due to model error." };
  }
};

export const modifyPlanVector = async (plan: FloorPlan, instruction: string): Promise<{ operations: any[], reasoning: string }> => {
  const simplifiedPlan = {
    walls: plan.walls.map(w => ({ id: w.id, start: w.start, end: w.end })),
    doors: plan.doors.map(d => ({ id: d.id, position: d.position })),
    meta: plan.meta
  };

  const prompt = `
      CURRENT PLAN JSON:
      ${JSON.stringify(simplifiedPlan)}

      USER INSTRUCTION:
      ${instruction}

      Return the JSON operations to modify this plan.
    `;

  try {
    const { result } = await backendApi.modifyPlanVector({
      prompt,
      systemInstruction: AUTOCAD_PROMPT_LOGIC.buildContextualInstruction('', 'PLAN'),
    });
    return result;
  } catch (e) {
    console.error("Failed to parse vector modification response", e);
    throw new Error("AI produced invalid geometry data.");
  }
};

/**
 * Main image generation/editing function — NOW WITH INTELLIGENCE.
 *
 * Flow:
 *  1. If image exists → classify intent → analyze scene → build smart prompt
 *  2. If no image → pure generation (pass prompt as-is)
 *  3. Use gemini-3-pro-image for maximum quality
 */
export const generateArchitecturalVariations = async (
  img: string | null,
  mime: string,
  prompt: string,
  initials?: string,
  mask?: string,
  context?: AIContext,
  pageRole: PageRole = 'PHOTO',
  editPreferences?: { preserveLayout: boolean; preserveLighting: boolean; preservePerspective: boolean },
  referenceImage?: string | null,
  qualityTier: number = 2,  // 0=Draft, 1=Standard, 2=HD, 3=Ultra
  additionalViews?: string[],  // Phase 6: extra views of same space (max 3)
  editHistory?: string[],      // Phase 2: cumulative previous commands
  signal?: AbortSignal         // lets the UI cancel a long generation mid-flight
): Promise<{ images: string[]; sceneAnalysis: SceneAnalysis | null; intent: EditIntent | null; promptSent: string; suggestMask?: boolean; meta?: GenerationMeta }> => {

  // --- NORMALIZE ALL IMAGES: convert blob: URLs to data:base64 ---
  let normalizedImg = await ensureBase64(img);
  let normalizedMask = await ensureBase64(mask);
  let normalizedRef = await ensureBase64(referenceImage);
  // Phase 6: normalize additional views (max 3, drop any that fail to convert)
  const normalizedExtraViews: string[] = [];
  if (additionalViews && additionalViews.length) {
    for (const v of additionalViews.slice(0, 3)) {
      const nv = await ensureBase64(v);
      if (nv) normalizedExtraViews.push(nv);
    }
  }

  // --- TIER-AWARE INPUT QUALITY: compress/scale context image based on quality tier ---
  // Higher tiers get higher-resolution input for better model output
  if (normalizedImg) {
    normalizedImg = await compressImageForTier(normalizedImg, qualityTier);
  }

  // Build context-enriched system instruction for the correct page role
  const contextBlock = context ? formatContextForPrompt(context) : '';
  const systemInstruction = AUTOCAD_PROMPT_LOGIC.buildContextualInstruction(contextBlock, pageRole);

  let finalPrompt = prompt;
  let sceneAnalysis: SceneAnalysis | null = null;
  let intent: EditIntent | null = null;

  // --- INTELLIGENCE PIPELINE (only when editing an existing image) ---
  if (normalizedImg) {
    try {
      // Step 1: Classify intent
      intent = await classifyIntent(prompt);
      console.log('[EditEngine] Intent:', intent);

      // Step 2: Analyze scene (cached)
      sceneAnalysis = await analyzeScene(normalizedImg);
      console.log('[EditEngine] Scene:', sceneAnalysis.description);

      // Step 3: Build smart prompt
      if (intent.mode !== 'GENERATE') {
        // Apply user's explicit UI preferences over AI classification
        if (editPreferences) {
          intent.preserveLayout = editPreferences.preserveLayout;
          intent.preserveLighting = editPreferences.preserveLighting;
          intent.preservePerspective = editPreferences.preservePerspective;
        }
        finalPrompt = buildEditPrompt(sceneAnalysis, intent, prompt, !!normalizedRef);
        console.log('[EditEngine] Smart prompt built, mode:', intent.mode, 'scale:', (intent as any).scale, 'hasRef:', !!normalizedRef, 'framing:', (intent as any).framingTarget);
      }
    } catch (e) {
      console.warn('[EditEngine] Intelligence pipeline failed, using raw prompt:', e);
    }
  }

  // --- FIX B: Current instruction FIRST, context history AFTER ---
  // Putting context history before the instruction caused the model to anchor to old state.
  // Now: instruction is built first, then context is appended below it as reference.
  if (context) {
    const contextPromptBlock = formatContextForImagePrompt(context);
    if (contextPromptBlock) {
      // Context goes AFTER the instruction, labeled as background reference only
      finalPrompt = `${finalPrompt}\n\n--- DESIGN SESSION BACKGROUND (for reference only — the instruction above takes priority) ---\n${contextPromptBlock}\n--- END BACKGROUND ---`;
    }
  }

  // --- FIX C: When mask is provided, use it as THE scope control — skip the heavy keepList ---
  // The mask already defines exactly where changes happen. A long keepList alongside
  // the mask creates conflicting constraints and confuses the model.
  if (normalizedMask) {
    // Simplified mask-mode prompt: WHAT to do, not what not to do
    const maskHeader = `MASK IMAGE PROVIDED: The black-and-white mask defines the EXACT edit region.\nWHITE = apply changes here ONLY. BLACK = leave completely untouched.\nDo not modify ANYTHING outside the white mask area.\n\n`;
    // Strip the keepList from finalPrompt if mask is present (it causes contradictions)
    // by rebuilding with mask-aware prompt that focuses on the task, not the restrictions
    finalPrompt = `${maskHeader}${finalPrompt}`;
  }

  // --- REFERENCE IMAGE: Strong structured context ---
  if (normalizedRef && finalPrompt === prompt) {
    finalPrompt = `REFERENCE IMAGE PROVIDED:\n- IMAGE 1 (first image) is the CURRENT architectural design to modify.\n- IMAGE 2 (second image) is the STYLE/MATERIAL REFERENCE to draw inspiration from.\n- Extract materials, colors, textures, furniture styles, and architectural details from IMAGE 2.\n- Apply them to IMAGE 1 exactly as the user instructs below.\n- Do NOT copy the layout or composition of IMAGE 2 — only extract the stylistic elements.\n\nUSER REQUEST: ${prompt}`;
  }

  // --- IMAGE GENERATION (backend proxy only — API key never touches the frontend) ---
  const { images, meta } = await backendApi.generateImage({
    prompt: finalPrompt,
    systemInstruction,
    image: normalizedImg,
    imageMime: mime,
    mask: normalizedMask || undefined,
    referenceImage: normalizedRef || undefined,
    referenceImageMime: 'image/png',
    qualityTier,
    additionalViews: normalizedExtraViews.length ? normalizedExtraViews : undefined,
    editHistory: editHistory && editHistory.length ? editHistory : undefined,
  }, signal);

  if (!images || images.length === 0) throw new Error("No image generated");
  // Keep EVERY image the backend returned — tiers 1/2 generate n=2 variations
  // and the user already paid for both. Discarding all but the first was
  // burning 50% of the spend on those tiers.
  const result = initials
    ? await Promise.all(images.map(im => applyWatermark(im, initials)))
    : images;

  // --- FIX A: Clear scene cache after every successful edit ---
  // Each edit produces a new image. Next edit should analyze the updated state,
  // not the previous one. Stale cache was causing keepList to describe old objects.
  clearSceneCache();

  return { images: result, sceneAnalysis, intent, promptSent: finalPrompt, suggestMask: intent?.suggestMask, meta };
};

/**
 * Generates a video using Veo logic.
 */
export const generateArchitecturalVideo = async (
  base64Image: string,
  prompt: string
): Promise<string> => {
  // Normalize blob: URLs to base64
  const normalizedImage = await ensureBase64(base64Image);
  if (!normalizedImage) throw new Error("Failed to process image for video");

  // SECURITY: Video generation goes through backend proxy only
  const { video } = await backendApi.generateVideo({
    image: normalizedImage,
    prompt,
  });

  // The backend returns a data: URL — convert to blob for playback
  const response = await fetch(video);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};
