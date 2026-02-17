import { supabase } from './supabaseClient';
import { DesignStep, FloorPlan } from '../types';
import { uploadImage, getSignedUrl, downloadImage } from './imageStorageService';
import { getCachedImage, cacheImage } from './imageCacheService';

// ---------- DB Types ----------

export interface DBConversation {
  id: string;
  user_id: string;
  title: string;
  tab_source: 'PHOTO' | 'PLAN' | 'VIDEO';
  summary: string;
  message_count: number;
  thumbnail_path: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface DBMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  role: 'user' | 'model';
  text: string | null;
  image_paths: string[];
  selected_image_index: number;
  is_mask_edit: boolean;
  floor_plan_data: FloorPlan | null;
  metadata: Record<string, any>;
  sequence_order: number;
  created_at: string;
}

// ---------- Conversations ----------

export async function createConversation(
  userId: string,
  tabSource: 'PHOTO' | 'PLAN' | 'VIDEO',
  title?: string
): Promise<string> {
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      tab_source: tabSource,
      title: title || 'Untitled Project',
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create conversation: ${error.message}`);
  return data.id;
}

export async function listConversations(
  userId: string,
  tabSource?: string
): Promise<DBConversation[]> {
  let query = supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .eq('is_archived', false)
    .order('updated_at', { ascending: false });

  if (tabSource) {
    query = query.eq('tab_source', tabSource);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list conversations: ${error.message}`);
  return data || [];
}

export async function updateConversation(
  conversationId: string,
  updates: Partial<Pick<DBConversation, 'title' | 'summary' | 'message_count' | 'thumbnail_path' | 'is_archived'>>
): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  if (error) throw new Error(`Failed to update conversation: ${error.message}`);
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId);

  if (error) throw new Error(`Failed to delete conversation: ${error.message}`);
}

// ---------- Messages ----------

export async function saveMessage(
  conversationId: string,
  userId: string,
  step: DesignStep,
  sequenceOrder: number
): Promise<string> {
  // Upload images to storage if present
  const imagePaths: string[] = [];
  if (step.images && step.images.length > 0) {
    const msgId = step.id || `msg-${Date.now()}`;
    for (let i = 0; i < step.images.length; i++) {
      const img = step.images[i];
      // Only upload if it's a base64 data URL (not already an object URL or storage path)
      if (img.startsWith('data:')) {
        try {
          const path = await uploadImage(userId, conversationId, msgId, i, img);
          imagePaths.push(path);
        } catch (e) {
          console.error(`Failed to upload image ${i}:`, e);
        }
      } else if (img.startsWith('blob:')) {
        // Skip object URLs - these are already cached locally
      } else {
        // Already a storage path
        imagePaths.push(img);
      }
    }
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      role: step.role,
      text: step.text || null,
      image_paths: imagePaths,
      selected_image_index: step.selectedImageIndex || 0,
      is_mask_edit: step.isMaskEdit || false,
      floor_plan_data: step.floorPlanData || null,
      metadata: {},
      sequence_order: sequenceOrder,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to save message: ${error.message}`);

  // Update conversation message count and timestamp
  await supabase.rpc('increment_message_count', { conv_id: conversationId }).catch(() => {
    // Fallback: manual update
    updateConversation(conversationId, { message_count: sequenceOrder + 1 });
  });

  return data.id;
}

export async function loadMessages(conversationId: string): Promise<DBMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('sequence_order', { ascending: true });

  if (error) throw new Error(`Failed to load messages: ${error.message}`);
  return data || [];
}

/**
 * Convert DB messages back to DesignStep[] for the UI.
 * Resolves image storage paths to displayable URLs (from cache or signed URLs).
 */
export async function messagesToDesignSteps(messages: DBMessage[]): Promise<DesignStep[]> {
  const steps: DesignStep[] = [];

  for (const msg of messages) {
    const images: string[] = [];

    for (const path of msg.image_paths) {
      try {
        // Check IndexedDB cache first
        const cachedBlob = await getCachedImage(path);
        if (cachedBlob) {
          images.push(URL.createObjectURL(cachedBlob));
        } else {
          // Download from Supabase Storage
          const blob = await downloadImage(path);
          // Cache for next time
          await cacheImage(path, blob);
          images.push(URL.createObjectURL(blob));
        }
      } catch (e) {
        console.error(`Failed to load image ${path}:`, e);
        // Try signed URL as fallback
        try {
          const url = await getSignedUrl(path);
          images.push(url);
        } catch {
          // Skip this image
        }
      }
    }

    steps.push({
      id: msg.id,
      role: msg.role,
      text: msg.text || undefined,
      images: images.length > 0 ? images : undefined,
      selectedImageIndex: msg.selected_image_index,
      isMaskEdit: msg.is_mask_edit,
      floorPlanData: msg.floor_plan_data || undefined,
    });
  }

  return steps;
}

// ---------- Assets (Gallery) ----------

export interface DBAsset {
  id: string;
  user_id: string;
  conversation_id: string | null;
  message_id: string | null;
  storage_path: string;
  public_url: string | null;
  type: 'IMAGE' | 'VIDEO';
  source: 'PHOTO' | 'PLAN' | 'VIDEO';
  prompt: string;
  created_at: string;
}

export async function saveAsset(
  userId: string,
  storagePath: string,
  type: 'IMAGE' | 'VIDEO',
  source: 'PHOTO' | 'PLAN' | 'VIDEO',
  prompt: string,
  conversationId?: string,
  messageId?: string
): Promise<string> {
  const { data, error } = await supabase
    .from('assets')
    .insert({
      user_id: userId,
      storage_path: storagePath,
      type,
      source,
      prompt,
      conversation_id: conversationId || null,
      message_id: messageId || null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to save asset: ${error.message}`);
  return data.id;
}

export async function loadGallery(userId: string): Promise<DBAsset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(`Failed to load gallery: ${error.message}`);
  return data || [];
}

// ---------- User Preferences ----------

export interface DBUserPreferences {
  id: string;
  user_id: string;
  preferred_styles: string[];
  default_initials: string;
  ai_memory_summary: string;
  created_at: string;
  updated_at: string;
}

export async function getUserPreferences(userId: string): Promise<DBUserPreferences | null> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) return null;
  return data;
}

export async function updateUserPreferences(
  userId: string,
  updates: Partial<Pick<DBUserPreferences, 'preferred_styles' | 'default_initials' | 'ai_memory_summary'>>
): Promise<void> {
  const { error } = await supabase
    .from('user_preferences')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to update preferences: ${error.message}`);
}
