/**
 * Force download an image from any source (base64, blob URL, cross-origin URL).
 * Works around the browser limitation where <a download> is ignored for
 * cross-origin URLs (like Supabase signed URLs) and unreliable for data URLs.
 */
export async function forceDownloadImage(
    imageUrl: string,
    filename: string = 'render.png'
): Promise<void> {
    try {
        let blob: Blob;

        if (imageUrl.startsWith('data:')) {
            // Convert base64 data URL to Blob
            blob = dataUrlToBlob(imageUrl);
        } else {
            // Fetch the image (works for blob: URLs and cross-origin URLs)
            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.statusText}`);
            }
            blob = await response.blob();
        }

        // Create a temporary object URL and trigger download
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();

        // Cleanup
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        }, 200);
    } catch (error) {
        console.error('Download failed:', error);
        // Fallback: open image in new tab
        window.open(imageUrl, '_blank');
    }
}

/**
 * Convert a data URL (base64) to a Blob.
 */
function dataUrlToBlob(dataUrl: string): Blob {
    const parts = dataUrl.split(',');
    const mime = parts[0]?.match(/:(.*?);/)?.[1] || 'image/png';
    const raw = atob(parts[1] || parts[0]);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        arr[i] = raw.charCodeAt(i);
    }
    return new Blob([arr], { type: mime });
}
