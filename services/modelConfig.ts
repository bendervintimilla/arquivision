/**
 * Single source of truth for model IDs and tier configuration on the
 * frontend. Mirrors backend/models_config.py.
 *
 * Phase 0 (today): mirrors current Gemini-only setup.
 * Phase 1 (next): flip TIER_CONFIG providers for tiers 1/2/3 to "openai".
 *
 * Rule of thumb: no component or service should hardcode a model name.
 * Always import from here.
 */

// ---------- Image models ----------

export const GEMINI_PRO_IMAGE = 'gemini-3-pro-image-preview';
export const GEMINI_FAST_IMAGE = 'gemini-2.5-flash-image';
export const OPENAI_IMAGE_MODEL = 'gpt-image-2'; // Phase 1 target

// ---------- Text / vision models ----------

export const GEMINI_FAST_TEXT = 'gemini-2.5-flash';

// ---------- Video model ----------

export const VIDEO_MODEL = 'veo-3.1-fast-generate-preview';
export const VIDEO_MODEL_STANDARD = 'veo-3.1-generate-preview';

// ---------- Backwards-compat exports ----------
// Anything that used to import { MODEL_NAME } / { FAST_IMAGE_MODEL_NAME } /
// { FAST_MODEL_NAME } from '../constants' now gets the same string from
// here. constants.ts re-exports these to avoid a wide refactor.

export const MODEL_NAME = GEMINI_PRO_IMAGE;
export const PRO_MODEL_NAME = GEMINI_PRO_IMAGE;
export const FAST_IMAGE_MODEL_NAME = GEMINI_FAST_IMAGE;
export const FAST_MODEL_NAME = GEMINI_FAST_TEXT;

// ---------- Tier configuration ----------

export type Provider = 'gemini' | 'openai';

export interface TierConfig {
  provider: Provider;
  model: string;
  imageSize: string | null;
  n: number;
  label: string;
}

// Phase 1 ACTIVE: tiers 1/2/3 route to OpenAI gpt-image-2. Std/HD return
// 2 variations each (architects pick the best); Ultra stays single hero shot.
export const TIER_CONFIG: Record<number, TierConfig> = {
  0: { provider: 'gemini', model: GEMINI_FAST_IMAGE,  imageSize: null, n: 1, label: 'Draft' },
  1: { provider: 'openai', model: OPENAI_IMAGE_MODEL, imageSize: '1K', n: 2, label: 'Standard' },
  2: { provider: 'openai', model: OPENAI_IMAGE_MODEL, imageSize: '2K', n: 2, label: 'HD' },
  3: { provider: 'openai', model: OPENAI_IMAGE_MODEL, imageSize: '4K', n: 1, label: 'Ultra' },
};

export function getTierConfig(tier: number): TierConfig {
  const clamped = Math.max(0, Math.min(3, Math.floor(tier)));
  return TIER_CONFIG[clamped];
}

// Tier metadata used by the quality selector UI
export const TIER_UI_META: Array<{ t: number; icon: string; label: string; tooltip: string }> = [
  { t: 0, icon: '⚡', label: 'Draft', tooltip: 'Draft — Flash model, fast & cheap' },
  { t: 1, icon: '✨', label: 'Std',   tooltip: 'Standard — Pro model, 1K resolution' },
  { t: 2, icon: '🔥', label: 'HD',    tooltip: 'HD — Pro model, 2K resolution (default)' },
  { t: 3, icon: '💎', label: '4K',    tooltip: 'Ultra — Pro model, 4K resolution, slowest' },
];
