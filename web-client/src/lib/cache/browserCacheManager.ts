/**
 * Browser-Native Data & Memory Caching Engine
 * Specification Anchor: Implementation Plan Phase A (Issue A.2)
 *
 * Tier 1: L1 In-Memory LRU Cache (capped at 128 MB) for < 1ms retrieval
 * Tier 2: L2 Persistent Storage via IndexedDB (tensorStore) for < 20ms retrieval
 * Direct HTTP Byte-Range fetching & ETag / 304 conditional request handler
 */

import {
  CachedTensorEntry,
  computeTensorCacheKey,
  getCachedTensor,
  saveCachedTensor,
  deleteCachedTensor,
  clearTensorCache,
} from './tensorStore';

export { computeTensorCacheKey, deleteCachedTensor, clearTensorCache };
export type { CachedTensorEntry };

const MAX_L1_BYTES = 128 * 1024 * 1024; // 128 MB

interface L1Item {
  entry: CachedTensorEntry;
  byteSize: number;
}

class BrowserCacheManager {
  private l1Cache: Map<string, L1Item> = new Map();
  private currentL1Bytes: number = 0;

  /**
   * Get tensor from L1 memory or L2 IndexedDB
   */
  async get(cacheKey: string): Promise<CachedTensorEntry | null> {
    // 1. Check L1 Memory Cache (< 1 ms)
    if (this.l1Cache.has(cacheKey)) {
      const item = this.l1Cache.get(cacheKey)!;
      // Refresh LRU order (delete & re-insert)
      this.l1Cache.delete(cacheKey);
      this.l1Cache.set(cacheKey, item);
      return item.entry;
    }

    // 2. Check L2 IndexedDB (< 20 ms)
    const entry = await getCachedTensor(cacheKey);
    if (entry) {
      this.putL1(cacheKey, entry);
      return entry;
    }

    return null;
  }

  /**
   * Put tensor into both L1 Memory and L2 IndexedDB
   */
  async set(entry: CachedTensorEntry): Promise<void> {
    this.putL1(entry.cacheKey, entry);
    await saveCachedTensor(entry);
  }

  /**
   * Put entry into L1 LRU cache with eviction
   */
  private putL1(cacheKey: string, entry: CachedTensorEntry): void {
    const byteSize = entry.buffer ? entry.buffer.byteLength : 0;

    // Remove existing if present
    if (this.l1Cache.has(cacheKey)) {
      const existing = this.l1Cache.get(cacheKey)!;
      this.currentL1Bytes -= existing.byteSize;
      this.l1Cache.delete(cacheKey);
    }

    // Evict oldest entries if capacity exceeded
    while (this.currentL1Bytes + byteSize > MAX_L1_BYTES && this.l1Cache.size > 0) {
      const oldestKey = this.l1Cache.keys().next().value;
      if (!oldestKey) break;
      const oldestItem = this.l1Cache.get(oldestKey);
      if (oldestItem) {
        this.currentL1Bytes -= oldestItem.byteSize;
        this.l1Cache.delete(oldestKey);
      }
    }

    this.l1Cache.set(cacheKey, { entry, byteSize });
    this.currentL1Bytes += byteSize;
  }

  /**
   * Direct HTTP Range Request for pre-computed cubes / static assets
   * Avoids round-tripping through heavy backend processing when slices are needed
   */
  async fetchByteRange(url: string, startByte: number, endByte: number): Promise<ArrayBuffer> {
    const response = await fetch(url, {
      headers: {
        Range: `bytes=${startByte}-${endByte}`,
      },
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`Byte range request failed with status ${response.status}`);
    }

    return await response.arrayBuffer();
  }

  /**
   * Conditional HTTP Fetch with ETag (If-None-Match) revalidation
   * If server responds with 304 Not Modified, returns cached tensor instantly without redownload.
   */
  async fetchTensorWithRevalidation(
    url: string,
    cacheKey: string,
    fallbackBadge: string = 'IRSA Live'
  ): Promise<{ entry: CachedTensorEntry; fromCache: boolean; notModified: boolean }> {
    const cached = await this.get(cacheKey);

    const headers: Record<string, string> = {};
    if (cached && cached.eTag) {
      headers['If-None-Match'] = cached.eTag;
    }

    const res = await fetch(url, { headers });

    // HTTP 304 Not Modified -> Cache is valid!
    if (res.status === 304 && cached) {
      cached.timestamp = Date.now();
      await this.set(cached);
      return { entry: cached, fromCache: true, notModified: true };
    }

    if (!res.ok) {
      // If network fails but we have stale cache, return cached entry as fallback
      if (cached) {
        return { entry: cached, fromCache: true, notModified: false };
      }
      throw new Error(`Failed to fetch tensor: HTTP ${res.status}`);
    }

    const buffer = await res.arrayBuffer();
    const serverEtag = res.headers.get('ETag') || undefined;

    // Parse shape from buffer if available
    let shape: [number, number, number, number] = [2, 6, 29, 29];
    let sourceBadge = fallbackBadge;
    if (buffer.byteLength >= 4) {
      try {
        const dv = new DataView(buffer);
        const hdrLen = dv.getUint32(0, true);
        if (buffer.byteLength >= 4 + hdrLen) {
          const hdrStr = new TextDecoder().decode(new Uint8Array(buffer, 4, hdrLen));
          const hdr = JSON.parse(hdrStr);
          if (Array.isArray(hdr.shape) && hdr.shape.length === 4) {
            shape = hdr.shape as [number, number, number, number];
          }
          if (hdr.source_badge) {
            sourceBadge = hdr.source_badge;
          }
        }
      } catch {
        // Fallback to defaults
      }
    }

    const newEntry: CachedTensorEntry = {
      cacheKey,
      timestamp: Date.now(),
      eTag: serverEtag,
      shape,
      buffer,
      sourceBadge,
    };

    await this.set(newEntry);
    return { entry: newEntry, fromCache: false, notModified: false };
  }

  /**
   * Clear both L1 and L2 caches
   */
  async clearAll(): Promise<void> {
    this.l1Cache.clear();
    this.currentL1Bytes = 0;
    await clearTensorCache();
  }
}

export const browserCacheManager = new BrowserCacheManager();
