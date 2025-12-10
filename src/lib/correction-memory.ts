/**
 * Correction Memory - Stores and applies user corrections for learning
 * Learns from user corrections to improve element finding accuracy
 */

import type { CorrectionEntry, LearnedPattern, PageType } from '../types/visual';
import type { WorkflowStep } from '../types/workflow';
import { VisualSnapshotService } from '../content/visual-snapshot';
import { aiConfig } from './ai-config';

const CORRECTION_STORAGE_KEY = 'ghostwriter_corrections';
const MAX_CORRECTIONS = 100; // Maximum corrections to store

export interface CorrectionContext {
  step: WorkflowStep;
  originalSelector: string;
  correctedSelector: string;
  correctedElement?: Element;
  pageType?: PageType;
}

export class CorrectionMemory {
  /**
   * Save a user correction
   */
  static async saveCorrection(context: CorrectionContext): Promise<void> {
    if (!aiConfig.isCorrectionLearningEnabled()) {
      return;
    }

    try {
      const corrections = await this.loadCorrections();

      // Capture visual context (for future use)
      if (context.correctedElement) {
        try {
          // Capture visual snapshot for future visual matching capabilities
          await VisualSnapshotService.capture(context.correctedElement);
        } catch (e) {
          // Continue without visual context
        }
      }

      // Create correction entry
      const entry: CorrectionEntry = {
        id: `correction_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        timestamp: Date.now(),
        originalSelector: context.originalSelector,
        originalVisualContext: context.step.payload.visualSnapshot?.elementSnippet,
        originalDescription: context.step.payload.elementText || context.step.payload.label,
        correctedSelector: context.correctedSelector,
        correctedElement: context.correctedElement ? {
          tag: context.correctedElement.tagName.toLowerCase(),
          text: (context.correctedElement as HTMLElement).textContent?.trim()?.substring(0, 100),
          attributes: this.extractAttributes(context.correctedElement),
        } : undefined,
        pageUrl: context.step.payload.url,
        pageType: context.pageType,
        learnedPattern: this.inferPattern(context),
        successCount: 0,
        failureCount: 0,
      };

      // Add to corrections
      corrections.unshift(entry);

      // Trim to max size
      if (corrections.length > MAX_CORRECTIONS) {
        corrections.splice(MAX_CORRECTIONS);
      }

      // Save
      await this.saveCorrections(corrections);
      console.log('🧠 GhostWriter: Correction saved and learned');
    } catch (error) {
      console.warn('🧠 GhostWriter: Failed to save correction:', error);
    }
  }

  /**
   * Find similar corrections for a step
   */
  static async findSimilarCorrections(
    step: WorkflowStep,
    maxResults: number = 3
  ): Promise<CorrectionEntry[]> {
    if (!aiConfig.isCorrectionLearningEnabled()) {
      return [];
    }

    try {
      const corrections = await this.loadCorrections();
      const matches: Array<{ entry: CorrectionEntry; score: number }> = [];

      for (const entry of corrections) {
        const score = this.calculateSimilarityScore(step, entry);
        if (score > 0.5) { // Minimum similarity threshold
          matches.push({ entry, score });
        }
      }

      // Sort by score (descending) and success rate
      matches.sort((a, b) => {
        const successRateA = a.entry.successCount / (a.entry.successCount + a.entry.failureCount + 1);
        const successRateB = b.entry.successCount / (b.entry.successCount + b.entry.failureCount + 1);
        return (b.score + successRateB * 0.3) - (a.score + successRateA * 0.3);
      });

      return matches.slice(0, maxResults).map(m => m.entry);
    } catch (error) {
      console.warn('🧠 GhostWriter: Failed to find similar corrections:', error);
      return [];
    }
  }

  /**
   * Apply learned pattern to generate selector
   */
  static applyLearnedPattern(
    step: WorkflowStep,
    pattern: LearnedPattern
  ): string | null {
    if (!pattern.rule) return null;

    // Selector transform
    if (pattern.rule.selectorTransform) {
      try {
        const regex = new RegExp(pattern.rule.selectorTransform.from);
        if (regex.test(step.payload.selector)) {
          return step.payload.selector.replace(
            regex,
            pattern.rule.selectorTransform.to
          );
        }
      } catch (e) {
        // Invalid regex
      }
    }

    // Preferred attributes
    if (pattern.rule.preferredAttributes && step.payload.context?.uniqueAttributes) {
      const attrs = step.payload.context.uniqueAttributes;
      for (const attrName of pattern.rule.preferredAttributes) {
        if (attrs[attrName]) {
          // Try to build selector from preferred attribute
          return `[${attrName}="${attrs[attrName]}"]`;
        }
      }
    }

    return null;
  }

  /**
   * Record successful use of a correction
   */
  static async recordSuccess(correctionId: string): Promise<void> {
    try {
      const corrections = await this.loadCorrections();
      const entry = corrections.find(c => c.id === correctionId);
      if (entry) {
        entry.successCount++;
        await this.saveCorrections(corrections);
        console.log(`🧠 GhostWriter: Correction ${correctionId} success recorded`);
      }
    } catch (error) {
      console.warn('🧠 GhostWriter: Failed to record success:', error);
    }
  }

  /**
   * Record failed use of a correction
   */
  static async recordFailure(correctionId: string): Promise<void> {
    try {
      const corrections = await this.loadCorrections();
      const entry = corrections.find(c => c.id === correctionId);
      if (entry) {
        entry.failureCount++;
        
        // Remove correction if it fails too often
        if (entry.failureCount > 3 && entry.successCount === 0) {
          const index = corrections.indexOf(entry);
          if (index > -1) {
            corrections.splice(index, 1);
            console.log(`🧠 GhostWriter: Correction ${correctionId} removed due to failures`);
          }
        }
        
        await this.saveCorrections(corrections);
      }
    } catch (error) {
      console.warn('🧠 GhostWriter: Failed to record failure:', error);
    }
  }

  /**
   * Get all corrections for review
   */
  static async getAllCorrections(): Promise<CorrectionEntry[]> {
    return this.loadCorrections();
  }

  /**
   * Delete a correction
   */
  static async deleteCorrection(correctionId: string): Promise<void> {
    try {
      const corrections = await this.loadCorrections();
      const index = corrections.findIndex(c => c.id === correctionId);
      if (index > -1) {
        corrections.splice(index, 1);
        await this.saveCorrections(corrections);
        console.log(`🧠 GhostWriter: Correction ${correctionId} deleted`);
      }
    } catch (error) {
      console.warn('🧠 GhostWriter: Failed to delete correction:', error);
    }
  }

  /**
   * Clear all corrections
   */
  static async clearAll(): Promise<void> {
    try {
      await chrome.storage.local.remove(CORRECTION_STORAGE_KEY);
      console.log('🧠 GhostWriter: All corrections cleared');
    } catch (error) {
      console.warn('🧠 GhostWriter: Failed to clear corrections:', error);
    }
  }

  // ============================================
  // Private methods
  // ============================================

  /**
   * Load corrections from storage
   */
  private static async loadCorrections(): Promise<CorrectionEntry[]> {
    try {
      const result = await chrome.storage.local.get(CORRECTION_STORAGE_KEY);
      const corrections = result[CORRECTION_STORAGE_KEY];
      return Array.isArray(corrections) ? corrections : [];
    } catch (error) {
      console.warn('🧠 GhostWriter: Failed to load corrections:', error);
      return [];
    }
  }

  /**
   * Save corrections to storage
   */
  private static async saveCorrections(corrections: CorrectionEntry[]): Promise<void> {
    await chrome.storage.local.set({ [CORRECTION_STORAGE_KEY]: corrections });
  }

  /**
   * Calculate similarity score between step and correction
   */
  private static calculateSimilarityScore(
    step: WorkflowStep,
    entry: CorrectionEntry
  ): number {
    let score = 0;
    let factors = 0;

    // URL match (same domain)
    try {
      const stepDomain = new URL(step.payload.url).hostname;
      const entryDomain = new URL(entry.pageUrl).hostname;
      if (stepDomain === entryDomain) {
        score += 0.3;
      } else if (stepDomain.endsWith(entryDomain) || entryDomain.endsWith(stepDomain)) {
        score += 0.15;
      }
      factors++;
    } catch (e) {
      // Invalid URL
    }

    // Page type match
    if (step.payload.pageType && entry.pageType) {
      if (step.payload.pageType.type === entry.pageType.type) {
        score += 0.2;
      }
      factors++;
    }

    // Element text match
    if (step.payload.elementText && entry.originalDescription) {
      const stepText = step.payload.elementText.toLowerCase();
      const entryText = entry.originalDescription.toLowerCase();
      if (stepText === entryText) {
        score += 0.3;
      } else if (stepText.includes(entryText) || entryText.includes(stepText)) {
        score += 0.15;
      }
      factors++;
    }

    // Selector pattern match
    if (step.payload.selector && entry.originalSelector) {
      // Check if selectors have similar patterns
      const stepPattern = this.extractSelectorPattern(step.payload.selector);
      const entryPattern = this.extractSelectorPattern(entry.originalSelector);
      if (stepPattern === entryPattern) {
        score += 0.2;
      }
      factors++;
    }

    return factors > 0 ? score : 0;
  }

  /**
   * Extract selector pattern (tag, class structure)
   */
  private static extractSelectorPattern(selector: string): string {
    // Simplify selector to pattern
    return selector
      .replace(/\[.*?\]/g, '[attr]') // Replace attribute selectors
      .replace(/#[\w-]+/g, '#id') // Replace IDs
      .replace(/\.[\w-]+/g, '.class') // Replace classes
      .replace(/:\w+/g, ':pseudo') // Replace pseudo-classes
      .replace(/\d+/g, 'N'); // Replace numbers
  }

  /**
   * Extract relevant attributes from element
   */
  private static extractAttributes(element: Element): Record<string, string> {
    const attrs: Record<string, string> = {};
    const relevantAttrs = ['id', 'class', 'role', 'aria-label', 'data-testid', 'name', 'type'];
    
    for (const attr of relevantAttrs) {
      const value = element.getAttribute(attr);
      if (value) {
        attrs[attr] = value.substring(0, 100); // Limit length
      }
    }
    
    return attrs;
  }

  /**
   * Infer pattern from correction
   */
  private static inferPattern(context: CorrectionContext): LearnedPattern {
    const pattern: LearnedPattern = {
      patternType: 'selector_transform',
      conditions: {
        urlPattern: this.extractUrlPattern(context.step.payload.url),
      },
      rule: {},
      confidence: 0.6,
    };

    // Add page type condition
    if (context.pageType) {
      pattern.conditions.pageTypeMatch = [context.pageType.type];
    }

    // Infer selector transform
    if (context.originalSelector && context.correctedSelector) {
      // Simple transform: if similar structure, note the differences
      const originalParts = context.originalSelector.split(/\s+/);
      const correctedParts = context.correctedSelector.split(/\s+/);
      
      if (originalParts.length === correctedParts.length) {
        // Same depth, might be attribute preference
        for (let i = 0; i < originalParts.length; i++) {
          if (originalParts[i] !== correctedParts[i]) {
            // Found difference, extract attribute preference
            const attrMatch = correctedParts[i].match(/\[(\w+)=/);
            if (attrMatch) {
              pattern.rule.preferredAttributes = [attrMatch[1]];
            }
            break;
          }
        }
      }
    }

    // Extract preferred attributes from corrected element
    if (context.correctedElement) {
      const attrs = this.extractAttributes(context.correctedElement);
      const stableAttrs = ['data-testid', 'aria-label', 'role', 'name'];
      const found = stableAttrs.filter(attr => attrs[attr]);
      if (found.length > 0) {
        pattern.rule.preferredAttributes = found;
      }
    }

    return pattern;
  }

  /**
   * Extract URL pattern (domain + path pattern)
   */
  private static extractUrlPattern(url: string): string {
    try {
      const parsed = new URL(url);
      // Create pattern: domain + path with wildcards
      const pathPattern = parsed.pathname
        .replace(/\/\d+/g, '/*') // Replace numeric IDs
        .replace(/\/[a-f0-9-]{20,}/g, '/*'); // Replace UUIDs
      return `${parsed.hostname}${pathPattern}`;
    } catch (e) {
      return '*';
    }
  }
}
