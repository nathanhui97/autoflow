/**
 * AI Cache - Local caching layer for fast repeated lookups
 * Server-side caching handled in Supabase Edge Function
 * 
 * Enhanced with viewport similarity matching for visual click caching
 */

import { aiConfig } from './ai-config';

export interface CacheEntry {
  data: any;
  timestamp: number;
  expiresAt: number;
}

export interface VisualClickCacheEntry extends CacheEntry {
  /** Hash of the viewport screenshot for similarity matching */
  viewportHash: string;
  /** Page URL path for context matching */
  urlPath: string;
  /** Target description for matching */
  targetDescription: string;
}

export class AICache {
  // Visual click cache - stored separately for fuzzy matching
  private static visualClickCache: Map<string, VisualClickCacheEntry> = new Map();
  private static readonly VISUAL_CACHE_MAX_SIZE = 50;
  private static readonly VISUAL_CACHE_TTL = 60 * 60 * 1000; // 1 hour

  /**
   * Generate cache key from data
   */
  static generateKey(data: any): string {
    // Create a stable hash from the data
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `ai_cache_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Generate a perceptual hash of a screenshot for similarity comparison
   * Uses a simple approach: downsample to 8x8 and create binary hash based on luminance
   */
  static generateViewportHash(screenshot: string): string {
    // For base64 screenshots, use a portion of the data as a hash
    // This is a simplified approach - a proper implementation would use
    // actual image processing to create a perceptual hash
    
    // Extract the actual image data (after the base64 header)
    const base64Data = screenshot.replace(/^data:image\/[^;]+;base64,/, '');
    
    // Sample from different parts of the image data
    const sampleSize = 100;
    const samples: string[] = [];
    
    const len = base64Data.length;
    if (len < sampleSize * 5) {
      // Small image, use all of it
      samples.push(base64Data);
    } else {
      // Sample from 5 different positions
      samples.push(base64Data.substring(0, sampleSize));
      samples.push(base64Data.substring(Math.floor(len * 0.25), Math.floor(len * 0.25) + sampleSize));
      samples.push(base64Data.substring(Math.floor(len * 0.5), Math.floor(len * 0.5) + sampleSize));
      samples.push(base64Data.substring(Math.floor(len * 0.75), Math.floor(len * 0.75) + sampleSize));
      samples.push(base64Data.substring(len - sampleSize));
    }
    
    // Hash the combined samples
    const combined = samples.join('');
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    return Math.abs(hash).toString(36);
  }

  /**
   * Compare two viewport hashes for similarity
   * Returns true if hashes are similar enough (indicating similar page state)
   */
  static areViewportsSimilar(hash1: string, hash2: string): boolean {
    // For our simple hash, we just check for exact match
    // A more sophisticated implementation could use hamming distance
    // on actual perceptual hashes
    return hash1 === hash2;
  }

  /**
   * Get visual click result from cache with fuzzy matching
   * Matches based on: URL path + target description + viewport similarity
   */
  static getVisualClickFromCache(
    urlPath: string,
    targetDescription: string,
    viewportHash: string
  ): any | null {
    // First, clean up expired entries
    this.cleanupVisualClickCache();
    
    // Look for matching entry
    for (const [_key, entry] of this.visualClickCache) {
      // Check if expired
      if (Date.now() > entry.expiresAt) {
        continue;
      }
      
      // Match URL path (exact or similar)
      const urlMatch = entry.urlPath === urlPath || 
                       this.areUrlPathsSimilar(entry.urlPath, urlPath);
      
      // Match target description (exact)
      const targetMatch = entry.targetDescription === targetDescription;
      
      // Match viewport (using hash similarity)
      const viewportMatch = this.areViewportsSimilar(entry.viewportHash, viewportHash);
      
      if (urlMatch && targetMatch && viewportMatch) {
        console.log('[AICache] Visual click cache hit!');
        return entry.data;
      }
    }
    
    return null;
  }

  /**
   * Save visual click result to cache
   */
  static saveVisualClickToCache(
    urlPath: string,
    targetDescription: string,
    viewportHash: string,
    data: any
  ): void {
    // Clean up if at capacity
    if (this.visualClickCache.size >= this.VISUAL_CACHE_MAX_SIZE) {
      // Remove oldest entry
      const oldestKey = this.visualClickCache.keys().next().value;
      if (oldestKey) {
        this.visualClickCache.delete(oldestKey);
      }
    }
    
    const key = `${urlPath}:${targetDescription}:${viewportHash}`;
    const entry: VisualClickCacheEntry = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.VISUAL_CACHE_TTL,
      viewportHash,
      urlPath,
      targetDescription,
    };
    
    this.visualClickCache.set(key, entry);
  }

  /**
   * Check if two URL paths are similar enough for caching
   */
  private static areUrlPathsSimilar(path1: string, path2: string): boolean {
    // Extract base paths (remove query strings and fragments)
    const base1 = path1.split('?')[0].split('#')[0];
    const base2 = path2.split('?')[0].split('#')[0];
    
    // Exact match
    if (base1 === base2) return true;
    
    // Check if they're the same page with different IDs
    // e.g., /accounts/123 and /accounts/456 should match
    const parts1 = base1.split('/').filter(Boolean);
    const parts2 = base2.split('/').filter(Boolean);
    
    if (parts1.length !== parts2.length) return false;
    
    let matchCount = 0;
    for (let i = 0; i < parts1.length; i++) {
      if (parts1[i] === parts2[i]) {
        matchCount++;
      } else if (this.looksLikeId(parts1[i]) && this.looksLikeId(parts2[i])) {
        // Both look like IDs, treat as match
        matchCount++;
      }
    }
    
    // At least 80% of parts should match
    return matchCount / parts1.length >= 0.8;
  }

  /**
   * Check if a URL segment looks like an ID (numeric or UUID-like)
   */
  private static looksLikeId(segment: string): boolean {
    // Numeric ID
    if (/^\d+$/.test(segment)) return true;
    // UUID-like
    if (/^[a-f0-9-]{8,}$/i.test(segment)) return true;
    // Base64-like ID
    if (/^[a-zA-Z0-9_-]{10,}$/.test(segment)) return true;
    return false;
  }

  /**
   * Clean up expired entries from visual click cache
   */
  private static cleanupVisualClickCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.visualClickCache) {
      if (now > entry.expiresAt) {
        this.visualClickCache.delete(key);
      }
    }
  }

  /**
   * Clear visual click cache
   */
  static clearVisualClickCache(): void {
    this.visualClickCache.clear();
  }

  /**
   * Get from local cache
   */
  static async getFromLocal(key: string): Promise<any | null> {
    try {
      const result = await chrome.storage.local.get(key);
      const entry = result[key] as CacheEntry | undefined;
      
      if (!entry) {
        return null;
      }
      
      // Check if expired
      if (Date.now() > entry.expiresAt) {
        // Remove expired entry
        await chrome.storage.local.remove(key);
        return null;
      }
      
      return entry.data;
    } catch (error) {
      console.warn('GhostWriter: Error reading from local cache:', error);
      return null;
    }
  }

  /**
   * Save to local cache
   */
  static async saveToLocal(key: string, data: any, ttl?: number): Promise<void> {
    try {
      const cacheTTL = ttl || aiConfig.getLocalCacheTTL();
      const entry: CacheEntry = {
        data,
        timestamp: Date.now(),
        expiresAt: Date.now() + cacheTTL,
      };
      
      await chrome.storage.local.set({ [key]: entry });
    } catch (error) {
      console.warn('GhostWriter: Error saving to local cache:', error);
      // Don't throw - caching is best effort
    }
  }

  /**
   * Get or compute (check local cache first, then compute)
   */
  static async getOrCompute<T>(
    key: string,
    computeFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    // Try local cache first
    const cached = await this.getFromLocal(key);
    if (cached !== null) {
      return cached as T;
    }
    
    // Compute if cache miss
    const result = await computeFn();
    
    // Save to cache (async, don't wait)
    this.saveToLocal(key, result, ttl).catch(() => {
      // Ignore cache save errors
    });
    
    return result;
  }

  /**
   * Clear cache entry
   */
  static async clear(key: string): Promise<void> {
    try {
      await chrome.storage.local.remove(key);
    } catch (error) {
      console.warn('GhostWriter: Error clearing cache:', error);
    }
  }

  /**
   * Clear all AI cache entries
   */
  static async clearAll(): Promise<void> {
    try {
      const all = await chrome.storage.local.get(null);
      const keysToRemove = Object.keys(all).filter(key => key.startsWith('ai_cache_'));
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }
    } catch (error) {
      console.warn('GhostWriter: Error clearing all cache:', error);
    }
  }
}




