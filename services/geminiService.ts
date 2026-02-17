
import { GoogleGenAI } from "@google/genai";
import { MODEL_NAME, FAST_MODEL_NAME } from "../constants";
import { AUTOCAD_PROMPT_LOGIC, buildIntentClassifierPrompt, buildSceneAnalysisPrompt, buildEditPrompt } from "./autocadService";
import { PlanAnalysis, Room, FloorPlan, EditIntent, SceneAnalysis, PageRole } from "../types";
import { AIContext, formatContextForPrompt } from "./contextService";
import { backendApi } from "./backendApiService";

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

// Global instance (fallback when backend unavailable)
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Flag: use backend proxy or direct API
const USE_BACKEND_PROXY = !!import.meta.env.VITE_BACKEND_URL;

// --- Scene analysis cache (per-session) ---
let cachedSceneAnalysis: SceneAnalysis | null = null;
let cachedSceneImageHash: string | null = null;

function simpleHash(str: string): string {
  return str.slice(0, 100) + str.length.toString();
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
  const prompt = buildIntentClassifierPrompt(userCommand);

  try {
    if (USE_BACKEND_PROXY) {
      const result = await backendApi.classifyIntent({ command: userCommand });
      return result.intent;
    }

    const response = await ai.models.generateContent({
      model: FAST_MODEL_NAME,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' }
    });

    return JSON.parse(response.text || '{}') as EditIntent;
  } catch (e) {
    console.error("Intent classification failed, using defaults:", e);
    return {
      mode: 'EDIT',
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
  const hash = simpleHash(imageBase64);

  // Return cached if same image
  if (cachedSceneAnalysis && cachedSceneImageHash === hash) {
    return cachedSceneAnalysis;
  }

  const prompt = buildSceneAnalysisPrompt();

  try {
    if (USE_BACKEND_PROXY) {
      const result = await backendApi.analyzeScene({ image: imageBase64 });
      cachedSceneAnalysis = result.analysis;
      cachedSceneImageHash = hash;
      return result.analysis;
    }

    const clean = imageBase64.split(',')[1] || imageBase64;
    const response = await ai.models.generateContent({
      model: FAST_MODEL_NAME,
      contents: {
        parts: [
          { inlineData: { data: clean, mimeType: 'image/png' } },
          { text: prompt }
        ]
      },
      config: { responseMimeType: 'application/json' }
    });

    const analysis = JSON.parse(response.text || '{}') as SceneAnalysis;
    cachedSceneAnalysis = analysis;
    cachedSceneImageHash = hash;
    return analysis;
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
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(base64Image); return; }

      ctx.drawImage(img, 0, 0);

      const fontSize = Math.max(16, Math.floor(img.height * 0.03));
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

      resolve(canvas.toDataURL('image/png'));
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

export const auditArchitecture = async (manifest: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: FAST_MODEL_NAME,
      contents: [{ role: 'user', parts: [{ text: AUTOCAD_PROMPT_LOGIC.SEMANTIC_AUDIT(manifest) }] }]
    });
    return response.text || "Audit data unavailable.";
  } catch (e) {
    console.error("Audit error", e);
    return "Geometric analysis pending...";
  }
};

export const analyzePlanImage = async (base64Image: string): Promise<PlanAnalysis> => {
  const cleanBase64 = base64Image.split(',')[1] || base64Image;
  try {
    if (USE_BACKEND_PROXY) {
      const { result } = await backendApi.analyzePlan({
        image: base64Image,
        prompt: AUTOCAD_PROMPT_LOGIC.PLAN_ANALYSIS,
      });
      return result as PlanAnalysis;
    }

    const response = await ai.models.generateContent({
      model: FAST_MODEL_NAME,
      contents: {
        parts: [
          { inlineData: { data: cleanBase64, mimeType: 'image/png' } },
          { text: AUTOCAD_PROMPT_LOGIC.PLAN_ANALYSIS }
        ]
      },
      config: { responseMimeType: 'application/json' }
    });
    return JSON.parse(response.text || '{}') as PlanAnalysis;
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
    if (USE_BACKEND_PROXY) {
      const { result } = await backendApi.modifyPlanVector({
        prompt,
        systemInstruction: AUTOCAD_PROMPT_LOGIC.buildContextualInstruction('', 'PLAN'),
      });
      return result;
    }

    const response = await ai.models.generateContent({
      model: FAST_MODEL_NAME,
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        systemInstruction: AUTOCAD_PROMPT_LOGIC.buildContextualInstruction('', 'PLAN')
      }
    });

    const result = JSON.parse(response.text || '{}');
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
  referenceImage?: string | null
): Promise<{ images: string[]; sceneAnalysis: SceneAnalysis | null; intent: EditIntent | null; promptSent: string }> => {

  // --- NORMALIZE ALL IMAGES: convert blob: URLs to data:base64 ---
  let normalizedImg = await ensureBase64(img);
  let normalizedMask = await ensureBase64(mask);
  let normalizedRef = await ensureBase64(referenceImage);

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
        // Bug #7 fix: Apply user's explicit UI preferences over AI classification
        if (editPreferences) {
          intent.preserveLayout = editPreferences.preserveLayout;
          intent.preserveLighting = editPreferences.preserveLighting;
          intent.preservePerspective = editPreferences.preservePerspective;
        }
        finalPrompt = buildEditPrompt(sceneAnalysis, intent, prompt, !!normalizedRef);
        console.log('[EditEngine] Smart prompt built, mode:', intent.mode, 'hasRef:', !!normalizedRef);
      }
    } catch (e) {
      console.warn('[EditEngine] Intelligence pipeline failed, using raw prompt:', e);
      // Fallback: use the raw prompt
    }
  }

  // If reference image provided but no smart prompt, add reference context to raw prompt
  if (normalizedRef && finalPrompt === prompt) {
    finalPrompt = `REFERENCE IMAGE: A second image is provided as visual reference. Use elements, styles, materials, or details from it as the user requests.\n\nUSER REQUEST: ${prompt}`;
  }

  // --- IMAGE GENERATION ---
  if (USE_BACKEND_PROXY) {
    try {
      const { images } = await backendApi.generateImage({
        prompt: finalPrompt,
        systemInstruction,
        image: normalizedImg,
        imageMime: mime,
        mask: normalizedMask || undefined,
        referenceImage: normalizedRef || undefined,
        referenceImageMime: 'image/png',
      });

      if (!images || images.length === 0) throw new Error("No image generated");
      const result = initials ? [await applyWatermark(images[0], initials)] : [images[0]];
      return { images: result, sceneAnalysis, intent, promptSent: finalPrompt };
    } catch (e) {
      console.error("Backend proxy failed, falling back to direct API:", e);
    }
  }

  // Direct API call (fallback)
  const parts: any[] = [];

  if (normalizedImg) {
    const clean = normalizedImg.split(',')[1] || normalizedImg;
    parts.push({ inlineData: { data: clean, mimeType: mime } });
  }

  if (normalizedMask && normalizedImg) {
    const cleanMask = normalizedMask.split(',')[1] || normalizedMask;
    parts.push({ inlineData: { data: cleanMask, mimeType: 'image/png' } });
  }

  if (normalizedRef) {
    const cleanRef = normalizedRef.split(',')[1] || normalizedRef;
    parts.push({ inlineData: { data: cleanRef, mimeType: 'image/png' } });
  }

  parts.push({ text: finalPrompt });

  const res = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: parts,
    config: {
      responseModalities: ['Image'],
      systemInstruction
    }
  });

  const data = res.candidates?.[0]?.content?.parts.find(p => p.inlineData)?.inlineData?.data;
  if (!data) throw new Error("No image generated");

  const out = `data:image/png;base64,${data}`;
  const result = initials ? [await applyWatermark(out, initials)] : [out];
  return { images: result, sceneAnalysis, intent, promptSent: finalPrompt };
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

  if (USE_BACKEND_PROXY) {
    try {
      const { video } = await backendApi.generateVideo({
        image: normalizedImage,
        prompt,
      });
      const response = await fetch(video);
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (e) {
      console.error("Backend video proxy failed, falling back:", e);
    }
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");

  const videoAi = new GoogleGenAI({ apiKey });
  const cleanBase64 = normalizedImage.split(',')[1] || normalizedImage;

  let operation = await videoAi.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: `STRICT RULE: Do NOT add, remove, or modify ANY objects, furniture, or elements in the scene. The video must show EXACTLY what is in the source image — nothing more, nothing less. Only animate camera movement and natural lighting. Smooth cinematic architectural flythrough: ${prompt}`,
    image: {
      imageBytes: cleanBase64,
      mimeType: 'image/png',
    },
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: '16:9'
    }
  });

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    operation = await videoAi.operations.getVideosOperation({ operation: operation });
  }

  const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!videoUri) throw new Error("Video generation failed to return URI");

  const videoRes = await fetch(`${videoUri}&key=${apiKey}`);
  if (!videoRes.ok) {
    throw new Error(`Failed to fetch video bytes: ${videoRes.statusText}`);
  }
  const blob = await videoRes.blob();
  return URL.createObjectURL(blob);
};
