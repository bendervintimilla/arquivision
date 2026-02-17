import { supabase } from './supabaseClient';

const BUCKET = 'user-images';

/**
 * Convert a base64 data URL to a Blob.
 */
function base64ToBlob(base64: string): Blob {
  const parts = base64.split(',');
  const mime = parts[0]?.match(/:(.*?);/)?.[1] || 'image/png';
  const raw = atob(parts[1] || parts[0]);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return new Blob([arr], { type: mime });
}

/**
 * Upload an image (base64) to Supabase Storage.
 * Returns the storage path.
 */
export async function uploadImage(
  userId: string,
  conversationId: string,
  messageId: string,
  imageIndex: number,
  base64Image: string
): Promise<string> {
  const blob = base64ToBlob(base64Image);
  const path = `${userId}/${conversationId}/${messageId}_${imageIndex}.png`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      contentType: 'image/png',
      upsert: true,
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}

/**
 * Get a signed URL for a storage path (1 hour expiry).
 */
export async function getSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600); // 1 hour

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to get signed URL: ${error?.message}`);
  }
  return data.signedUrl;
}

/**
 * Download image as Blob from storage.
 */
export async function downloadImage(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(path);

  if (error || !data) {
    throw new Error(`Download failed: ${error?.message}`);
  }
  return data;
}

/**
 * Delete images from storage.
 */
export async function deleteImages(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove(paths);

  if (error) {
    console.error('Failed to delete images:', error);
  }
}

/**
 * Upload a video blob to storage. Returns the storage path.
 */
export async function uploadVideo(
  userId: string,
  conversationId: string,
  videoBlob: Blob
): Promise<string> {
  const path = `${userId}/${conversationId}/video_${Date.now()}.mp4`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, videoBlob, {
      contentType: 'video/mp4',
      upsert: true,
    });

  if (error) throw new Error(`Video upload failed: ${error.message}`);
  return path;
}
