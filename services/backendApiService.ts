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

export const backendApi = {
  generateImage: (data: {
    prompt: string;
    systemInstruction?: string;
    image?: string | null;
    imageMime?: string;
    mask?: string;
    referenceImage?: string | null;
    referenceImageMime?: string;
    useFastModel?: boolean;
  }) => apiCall<{ images: string[] }>('/api/generate-image', data),

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

  healthCheck: async () => {
    const res = await fetch(`${BACKEND_URL}/api/health`);
    return res.json();
  },
};
