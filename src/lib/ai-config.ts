/**
 * AI Configuration - Supabase configuration for AI features
 * No API key storage (handled in Supabase Edge Function)
 */

export interface AIConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  edgeFunctionName: string;
  validateSelectorEdgeFunctionName: string;
  enabled: boolean;
  timeout: number; // Timeout for Edge Function calls (ms)
  validateSelectorTimeout: number; // Timeout for selector validation (ms)
  localCacheTTL: number; // Local cache TTL (ms)
}

class AIConfigManager {
  private config: AIConfig;

  constructor() {
    // Default configuration
    // Supabase project: autoflow (jfboagngbpzollcipewh)
    this.config = {
      supabaseUrl: 'https://jfboagngbpzollcipewh.supabase.co',
      supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmYm9hZ25nYnB6b2xsY2lwZXdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5OTIyMzMsImV4cCI6MjA4MDU2ODIzM30.CHHB1kvhiq4i063unS6_UdBLwLd8uXVi71id6hdelUI',
      edgeFunctionName: 'recover_element',
      validateSelectorEdgeFunctionName: 'validate_selector',
      enabled: true, // Feature flag
      timeout: 10000, // 10 seconds for Edge Function call
      validateSelectorTimeout: 15000, // 15 seconds for selector validation (increased for testing)
      localCacheTTL: 3600000, // 1 hour for local cache
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): AIConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<AIConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Check if AI features are enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get Supabase URL
   */
  getSupabaseUrl(): string {
    return this.config.supabaseUrl;
  }

  /**
   * Get Supabase anon key
   */
  getSupabaseAnonKey(): string {
    return this.config.supabaseAnonKey;
  }

  /**
   * Get Edge Function name
   */
  getEdgeFunctionName(): string {
    return this.config.edgeFunctionName;
  }

  /**
   * Get timeout for Edge Function calls
   */
  getTimeout(): number {
    return this.config.timeout;
  }

  /**
   * Get local cache TTL
   */
  getLocalCacheTTL(): number {
    return this.config.localCacheTTL;
  }
}

// Singleton instance
export const aiConfig = new AIConfigManager();
