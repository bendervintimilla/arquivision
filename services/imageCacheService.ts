/**
 * IndexedDB-based image cache for offline access and fast loading.
 * Max cache size: 200MB with LRU eviction.
 */

const DB_NAME = 'archivision-cache';
const STORE_NAME = 'images';
const DB_VERSION = 1;
const MAX_CACHE_SIZE = 200 * 1024 * 1024; // 200MB

interface CacheEntry {
  path: string;
  blob: Blob;
  size: number;
  cachedAt: number;
  lastAccessed: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'path' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get a cached image blob by storage path.
 */
export async function getCachedImage(path: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(path);

      request.onsuccess = () => {
        const entry = request.result as CacheEntry | undefined;
        if (entry) {
          // Update last accessed time
          entry.lastAccessed = Date.now();
          store.put(entry);
          resolve(entry.blob);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Cache an image blob by storage path.
 */
export async function cacheImage(path: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();

    // Check if we need to evict
    const totalSize = await getCacheSize(db);
    if (totalSize + blob.size > MAX_CACHE_SIZE) {
      await evictLRU(db, blob.size);
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const entry: CacheEntry = {
        path,
        blob,
        size: blob.size,
        cachedAt: Date.now(),
        lastAccessed: Date.now(),
      };
      const request = store.put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.warn('Failed to cache image:', e);
  }
}

/**
 * Get total cache size in bytes.
 */
async function getCacheSize(db: IDBDatabase): Promise<number> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const entries = request.result as CacheEntry[];
      const total = entries.reduce((sum, e) => sum + e.size, 0);
      resolve(total);
    };

    request.onerror = () => resolve(0);
  });
}

/**
 * Evict least recently used entries until we free enough space.
 */
async function evictLRU(db: IDBDatabase, neededBytes: number): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const entries = (request.result as CacheEntry[])
        .sort((a, b) => a.lastAccessed - b.lastAccessed); // Oldest accessed first

      let freed = 0;
      for (const entry of entries) {
        if (freed >= neededBytes) break;
        store.delete(entry.path);
        freed += entry.size;
      }
      resolve();
    };

    request.onerror = () => resolve();
  });
}

/**
 * Clear entire cache.
 */
export async function clearCache(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
    });
  } catch {
    // Ignore
  }
}
