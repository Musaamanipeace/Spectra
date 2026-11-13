/**
 * Client-Side Browser Storage for Spectra Binary Tensors
 * Specification Anchor: Implementation Plan §3.1
 * Persistent L2 Storage using Browser IndexedDB
 */

export interface CachedTensorEntry {
  cacheKey: string;           // sha256(ra:dec:fov:release)
  timestamp: number;          // Epoch ms
  eTag?: string;              // Server ETag
  shape: [number, number, number, number]; // [epochs, bands, H, W]
  buffer: ArrayBuffer;        // Float32 raw binary payload
  sourceBadge: string;        // 'IRSA Live' | 'NASA Benchmark'
}

const DB_NAME = 'spectra_tensor_store_v1';
const DB_VERSION = 1;
const STORE_NAME = 'tensors';

/**
 * Open or upgrade the Spectra IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in this environment'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Compute SHA-256 or fast hex hash for coordinate cache key
 */
export async function computeTensorCacheKey(
  ra: number,
  dec: number,
  fov: number,
  release: string = 'spherex_qr2'
): Promise<string> {
  const normRa = Number(ra).toFixed(5);
  const normDec = Number(dec).toFixed(5);
  const normFov = Math.round(fov);
  const rawKey = `${normRa}:${normDec}:${normFov}:${release.trim().toLowerCase()}`;

  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    try {
      const encoder = new TextEncoder();
      const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(rawKey));
      const hashArr = Array.from(new Uint8Array(hashBuf));
      return hashArr.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fall through to JS hash
    }
  }

  // Fast deterministic fallback hash
  let h = 0x811c9dc5;
  for (let i = 0; i < rawKey.length; i++) {
    h ^= rawKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `hash_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Save tensor entry to IndexedDB
 */
export async function saveCachedTensor(entry: CachedTensorEntry): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(entry);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    });
  } catch (err) {
    console.warn('[tensorStore] Failed to save tensor to IndexedDB:', err);
  }
}

/**
 * Get cached tensor by key from IndexedDB
 */
export async function getCachedTensor(cacheKey: string): Promise<CachedTensorEntry | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(cacheKey);

      req.onsuccess = () => {
        resolve((req.result as CachedTensorEntry) || null);
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    });
  } catch (err) {
    console.warn('[tensorStore] Failed to retrieve tensor from IndexedDB:', err);
    return null;
  }
}

/**
 * Delete a single cached tensor
 */
export async function deleteCachedTensor(cacheKey: string): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(cacheKey);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    });
  } catch (err) {
    console.warn('[tensorStore] Failed to delete tensor from IndexedDB:', err);
  }
}

/**
 * Clear all cached tensors
 */
export async function clearTensorCache(): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    });
  } catch (err) {
    console.warn('[tensorStore] Failed to clear IndexedDB:', err);
  }
}
