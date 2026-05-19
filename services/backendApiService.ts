import { supabase } from './supabaseClient';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    // Dev mode: skip auth header when no session
    return { 'Content-Type': 'application/json' };
  }
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
  };
}

async function apiCall<T>(endpoint: string, body: any): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BACKEND_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API call failed: ${res.status}`);
  }

  return res.json();
}

export interface GenerationMeta {
  tier: number;
  tier_label: string;
  tier_downgrade: boolean;     // true when OpenAI→Gemini or 503 fallback fired
  requested_model: string;
  used_model: string;
  provider?: 'openai' | 'gemini';
  n?: number;                  // number of images returned in this batch
  cap_hit?: boolean;           // true when user hit DAILY_USER_CAP_USD; tier forced to 0
  spent_usd_today?: number;    // running total of today's spend for this user
  // Populated only on dry-run responses (dryRun: true in the request)
  dry_run?: boolean;
  final_prompt?: string;
  system_instruction?: string;
  image_size?: string | null;
  has_image?: boolean;
  has_mask?: boolean;
  has_reference?: boolean;
  estimated_cost_usd?: number;
}

export const backendApi = {
  generateImage: (data: {
    prompt: string;
    systemInstruction?: string;
    image?: string | null;
    imageMime?: string;
    mask?: string;
    referenceImage?: string | null;
    referenceImageMime?: string;
    qualityTier?: number;       // 0=Draft, 1=Standard, 2=HD, 3=Ultra
    useFastModel?: boolean;     // legacy — maps to tier 0
    dryRun?: boolean;           // when true, returns prompt+meta without calling the model
    // Phase 6: extra views of the same space from different angles.
    // Resolves rotation/hidden-side requests structurally. Max 3.
    additionalViews?: string[];
  }) => apiCall<{ images: string[]; meta?: GenerationMeta }>('/api/generate-image', data),


  analyzePlan: (data: {
    image: string;
    prompt: string;
  }) => apiCall<{ result: any }>('/api/analyze-plan', data),

  modifyPlanVector: (data: {
    prompt: string;
    systemInstruction?: string;
  }) => apiCall<{ result: any }>('/api/modify-plan-vector', data),

  summarizeContext: (data: {
    previousSummary: string;
    newMessages: Array<{ role: string; text: string }>;
    userMemory: string;
  }) => apiCall<{ summary: string }>('/api/summarize-context', data),

  updateUserMemory: (data: {
    currentMemory: string;
    conversationSummaries: string[];
  }) => apiCall<{ memory: string }>('/api/update-user-memory', data),

  generateVideo: (data: {
    image: string;
    prompt: string;
  }) => apiCall<{ video: string }>('/api/generate-video', data),

  // --- Edit Intelligence Engine ---

  classifyIntent: (data: {
    command: string;
  }) => apiCall<{ intent: any }>('/api/classify-intent', data),

  analyzeScene: (data: {
    image: string;
  }) => apiCall<{ analysis: any }>('/api/analyze-scene', data),

  saveCreativeDatapoint: (data: {
    input_image_path?: string;
    input_scene_analysis?: any;
    user_command: string;
    detected_intent?: any;
    output_image_path?: string;
    prompt_sent: string;
    model_used: string;
    user_accepted: boolean;
    page_source: string;
    style_tags?: string[];
    object_tags?: string[];
  }) => apiCall<{ id: string }>('/api/save-creative-data', data),

  enhanceImage: (data: {
    image: string;
  }) => apiCall<{ images: string[] }>('/api/enhance-image', data),

  healthCheck: async () => {
    const res = await fetch(`${BACKEND_URL}/api/health`);
    return res.json();
  },

  getAdminUsage: async () => {
    const headers = await getAuthHeaders();
    const res = await fetch(`${BACKEND_URL}/api/admin/usage`, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Admin fetch failed: ${res.status}`);
    }
    return res.json();
  },
};

