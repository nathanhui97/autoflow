/**
 * ElementFinder - Robust element finding with 8+ fallback strategies
 * Performance-optimized for large React apps with tag scoping and container scoping
 */

import { TextMatcher } from './text-matcher';
import { ElementStateCapture } from './element-state';
import { AIService } from '../lib/ai-service';
import { aiConfig } from '../lib/ai-config';
import type { WorkflowStep } from '../types/workflow';

export class ElementFinder {
  /**
   * Find element using all fallback strategies
   * Returns the first element found, or null if all strategies fail
   */
  static async findElement(
    step: WorkflowStep,
    doc: Document = document
  ): Promise<Element | null> {
    // Strategy 1: Try all recorded selectors
    for (const selector of [step.payload.selector, ...(step.payload.fallbackSelectors || [])]) {
      try {
        const element = doc.querySelector(selector);
        if (element && this.isElementValid(element, step)) {
          return element;
        }
      } catch (e) {
        // Invalid selector, continue to next
      }
    }

    // Strategy 2: Fuzzy text matching (with tag scoping and container scoping)
    if (step.payload.elementText) {
      const element = this.findByFuzzyText(step.payload.elementText, step, doc);
      if (element) return element;
    }

    // Strategy 3: Partial text matching
    if (step.payload.elementText) {
      const element = this.findByPartialText(step.payload.elementText, step, doc);
      if (element) return element;
    }

    // Strategy 4: Container-based finding
    if (step.payload.context?.container) {
      const element = this.findByContainer(step, doc);
      if (element) return element;
    }

    // Strategy 5: Parent hierarchy traversal
    if (step.payload.context?.ancestors && step.payload.context.ancestors.length > 0) {
      const element = this.findByParentHierarchy(step, doc);
      if (element) return element;
    }

    // Strategy 6: Attribute-based matching
    const element = this.findByAttributes(step, doc);
    if (element) return element;

    // Strategy 7: Position-based fallback
    if (step.payload.elementBounds) {
      const element = this.findByPosition(step.payload.elementBounds, step, doc);
      if (element) return element;
    }

    // Strategy 8: Sibling-based finding
    if (step.payload.context?.siblings) {
      const element = this.findBySiblings(step, doc);
      if (element) return element;
    }

    // Strategy 9: AI Element Finder (single multimodal request via Supabase)
    if (this.shouldUseAI(step)) {
      try {
        // Call Supabase Edge Function for AI recovery (handles Gemini API call server-side)
        const element = await AIService.recoverTarget(step, doc);
        if (element && this.isElementValid(element, step)) {
          // Cache successful recovery locally
          this.cacheRecovery(step, element);
          return element;
        }
      } catch (error) {
        // Fail gracefully - AI is enhancement, not required
        console.warn('GhostWriter: AI element finding failed:', error);
      }
    }

    return null;
  }

  /**
   * Check if AI should be used for this step
   */
  private static shouldUseAI(step: WorkflowStep): boolean {
    // Check feature flag
    try {
      if (!aiConfig.isEnabled()) {
        return false;
      }
    } catch (e) {
      // Config not available, skip AI
      return false;
    }

    // Only use AI for CLICK and INPUT steps
    if (step.type !== 'CLICK' && step.type !== 'INPUT') {
      return false;
    }

    // Must have some identifying information
    if (!step.payload.elementText && !step.payload.label && !step.payload.selector) {
      return false;
    }

    return true;
  }

  /**
   * Cache successful AI recovery
   */
  private static cacheRecovery(_step: WorkflowStep, element: Element): void {
    // This is a placeholder - actual caching happens in AIService
    // We could add additional local caching here if needed
    console.log('GhostWriter: AI recovery successful, element found:', element.tagName);
  }

  /**
   * Get tag selectors based on step type (for tag scoping)
   * Performance optimization: Only search relevant element types
   */
  private static getTagSelectorsForStep(step: WorkflowStep): string[] {
    if (step.type === 'CLICK') {
      return ['button', 'a', 'input[type="button"]', '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="option"]'];
    } else if (step.type === 'INPUT') {
      return ['input', 'textarea', 'select'];
    } else if (step.type === 'KEYBOARD') {
      // Keyboard events can target any focusable element
      return ['input', 'textarea', 'select', 'button', 'a', '[tabindex]', '[contenteditable="true"]'];
    }
    return ['*']; // Fallback: search all elements (shouldn't happen)
  }

  /**
   * Get search scope (container or document)
   * Performance optimization: Search within container first
   */
  private static getSearchScope(step: WorkflowStep, doc: Document): Element {
    // If container context exists, try to find the container first
    if (step.payload.context?.container) {
      const container = step.payload.context.container;
      
      // Try container selector first
      if (container.selector) {
        try {
          const containerElement = doc.querySelector(container.selector);
          if (containerElement) {
            return containerElement;
          }
        } catch (e) {
          // Invalid selector, continue
        }
      }
      
      // Try finding container by text if available
      if (container.text) {
        const normalizedText = TextMatcher.normalize(container.text);
        // Search for containers with matching text
        const containers = doc.querySelectorAll('div, section, article, main, gridster-item, [class*="widget"], [class*="card"], [class*="panel"]');
        for (const candidate of Array.from(containers)) {
          const candidateText = TextMatcher.normalize(candidate.textContent || '');
          if (candidateText.includes(normalizedText) || normalizedText.includes(candidateText)) {
            return candidate;
          }
        }
      }
    }
    
    // Fallback to document body
    return doc.body;
  }

  /**
   * Strategy 2: Fuzzy text matching
   * Performance: Tag scoping + Container scoping
   */
  private static findByFuzzyText(
    targetText: string,
    step: WorkflowStep,
    doc: Document
  ): Element | null {
    const tagSelectors = this.getTagSelectorsForStep(step);
    const scope = this.getSearchScope(step, doc);
    
    // Search only within scope and only for relevant tag types
    const candidates = Array.from(scope.querySelectorAll(tagSelectors.join(', ')));
    
    let bestMatch: Element | null = null;
    let bestScore = 0;
    const threshold = 0.8; // Minimum similarity score
    
    for (const candidate of candidates) {
      // Skip if not visible or not valid
      if (!ElementStateCapture.isElementVisible(candidate)) continue;
      
      // Get candidate text from multiple sources
      const candidateText = 
        candidate.textContent?.trim() || 
        candidate.getAttribute('aria-label') || 
        candidate.getAttribute('title') ||
        '';
      
      if (!candidateText) continue;
      
      const score = TextMatcher.similarityScore(targetText, candidateText);
      if (score > bestScore && score >= threshold) {
        bestScore = score;
        bestMatch = candidate;
      }
    }
    
    return bestMatch;
  }

  /**
   * Strategy 3: Partial text matching
   * Performance: Tag scoping + Container scoping
   */
  private static findByPartialText(
    targetText: string,
    step: WorkflowStep,
    doc: Document
  ): Element | null {
    const tagSelectors = this.getTagSelectorsForStep(step);
    const scope = this.getSearchScope(step, doc);
    
    const candidates = Array.from(scope.querySelectorAll(tagSelectors.join(', ')));
    
    for (const candidate of candidates) {
      if (!ElementStateCapture.isElementVisible(candidate)) continue;
      
      const candidateText = 
        candidate.textContent?.trim() || 
        candidate.getAttribute('aria-label') || 
        '';
      
      if (!candidateText) continue;
      
      // Use partial matching (word-based)
      if (TextMatcher.partialMatch(candidateText, targetText, 2)) {
        return candidate;
      }
    }
    
    return null;
  }

  /**
   * Strategy 4: Container-based finding
   * Find element within the recorded container
   */
  private static findByContainer(step: WorkflowStep, doc: Document): Element | null {
    const container = step.payload.context?.container;
    if (!container) return null;
    
    // Find container
    let containerElement: Element | null = null;
    
    if (container.selector) {
      try {
        containerElement = doc.querySelector(container.selector);
      } catch (e) {
        // Invalid selector
      }
    }
    
    // If container not found by selector, try by text
    if (!containerElement && container.text) {
      const normalizedText = TextMatcher.normalize(container.text);
      const containers = doc.querySelectorAll('div, section, article, main, gridster-item');
      for (const candidate of Array.from(containers)) {
        const candidateText = TextMatcher.normalize(candidate.textContent || '');
        if (candidateText.includes(normalizedText) || normalizedText.includes(candidateText)) {
          containerElement = candidate;
          break;
        }
      }
    }
    
    if (!containerElement) return null;
    
    // Search within container using element text or other attributes
    if (step.payload.elementText) {
      const tagSelectors = this.getTagSelectorsForStep(step);
      const candidates = Array.from(containerElement.querySelectorAll(tagSelectors.join(', ')));
      
      for (const candidate of candidates) {
        if (!ElementStateCapture.isElementVisible(candidate)) continue;
        
        const text = candidate.textContent?.trim() || candidate.getAttribute('aria-label') || '';
        if (text && TextMatcher.normalize(text) === TextMatcher.normalize(step.payload.elementText)) {
          return candidate;
        }
      }
    }
    
    // Try by role if available
    if (step.payload.elementRole) {
      const candidates = containerElement.querySelectorAll(`[role="${step.payload.elementRole}"]`);
      for (const candidate of Array.from(candidates)) {
        if (ElementStateCapture.isElementVisible(candidate)) {
          return candidate;
        }
      }
    }
    
    return null;
  }

  /**
   * Strategy 5: Parent hierarchy traversal
   * Build path from ancestors, then find element within
   */
  private static findByParentHierarchy(step: WorkflowStep, doc: Document): Element | null {
    const ancestors = step.payload.context?.ancestors;
    if (!ancestors || ancestors.length === 0) return null;
    
    // Try to find the deepest ancestor first
    let currentContainer: Element | null = null;
    
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancestor = ancestors[i];
      if (ancestor.selector) {
        try {
          const found = doc.querySelector(ancestor.selector);
          if (found) {
            currentContainer = found;
            break;
          }
        } catch (e) {
          // Invalid selector
        }
      }
    }
    
    if (!currentContainer) return null;
    
    // Search within the found container
    if (step.payload.elementText) {
      const tagSelectors = this.getTagSelectorsForStep(step);
      const candidates = Array.from(currentContainer.querySelectorAll(tagSelectors.join(', ')));
      
      for (const candidate of candidates) {
        if (!ElementStateCapture.isElementVisible(candidate)) continue;
        
        const text = candidate.textContent?.trim() || '';
        if (text && TextMatcher.fuzzyMatch(text, step.payload.elementText, 0.8)) {
          return candidate;
        }
      }
    }
    
    return null;
  }

  /**
   * Strategy 6: Attribute-based matching
   * Try matching by role, aria-label, name even if not exact
   */
  private static findByAttributes(step: WorkflowStep, doc: Document): Element | null {
    const scope = this.getSearchScope(step, doc);
    const tagSelectors = this.getTagSelectorsForStep(step);
    
    // Try by role
    if (step.payload.elementRole) {
      const candidates = scope.querySelectorAll(`[role="${step.payload.elementRole}"]`);
      for (const candidate of Array.from(candidates)) {
        if (ElementStateCapture.isElementVisible(candidate)) {
          // If we have element text, verify it matches
          if (step.payload.elementText) {
            const text = candidate.textContent?.trim() || candidate.getAttribute('aria-label') || '';
            if (text && TextMatcher.fuzzyMatch(text, step.payload.elementText, 0.7)) {
              return candidate;
            }
          } else {
            return candidate;
          }
        }
      }
    }
    
    // Try by aria-label (fuzzy)
    if (step.payload.elementText) {
      const candidates = scope.querySelectorAll(tagSelectors.join(', '));
      for (const candidate of Array.from(candidates)) {
        if (!ElementStateCapture.isElementVisible(candidate)) continue;
        
        const ariaLabel = candidate.getAttribute('aria-label');
        if (ariaLabel && TextMatcher.fuzzyMatch(ariaLabel, step.payload.elementText, 0.8)) {
          return candidate;
        }
      }
    }
    
    // Try by name attribute (for inputs)
    if (step.type === 'INPUT' && step.payload.label) {
      const candidates = scope.querySelectorAll('input, textarea, select');
      for (const candidate of Array.from(candidates)) {
        if (!ElementStateCapture.isElementVisible(candidate)) continue;
        
        const name = (candidate as HTMLInputElement).name;
        if (name && TextMatcher.fuzzyMatch(name, step.payload.label || '', 0.7)) {
          return candidate;
        }
      }
    }
    
    return null;
  }

  /**
   * Strategy 7: Position-based fallback
   * Find element at similar position (if bounds recorded)
   */
  private static findByPosition(
    bounds: { x: number; y: number; width: number; height: number },
    step: WorkflowStep,
    doc: Document
  ): Element | null {
    const scope = this.getSearchScope(step, doc);
    const tagSelectors = this.getTagSelectorsForStep(step);
    
    // Find elements at similar position
    const candidates = Array.from(scope.querySelectorAll(tagSelectors.join(', ')));
    
    let bestMatch: Element | null = null;
    let minDistance = Infinity;
    
    for (const candidate of candidates) {
      if (!ElementStateCapture.isElementVisible(candidate)) continue;
      
      const rect = candidate.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      // Calculate distance from recorded position
      const targetX = bounds.x + bounds.width / 2;
      const targetY = bounds.y + bounds.height / 2;
      
      const distance = Math.sqrt(
        Math.pow(centerX - targetX, 2) + Math.pow(centerY - targetY, 2)
      );
      
      // Accept if within 50px (reasonable tolerance for UI changes)
      if (distance < 50 && distance < minDistance) {
        minDistance = distance;
        bestMatch = candidate;
      }
    }
    
    return bestMatch;
  }

  /**
   * Strategy 8: Sibling-based finding
   * Use sibling context to find element
   */
  private static findBySiblings(step: WorkflowStep, doc: Document): Element | null {
    const siblings = step.payload.context?.siblings;
    if (!siblings) return null;
    
    const scope = this.getSearchScope(step, doc);
    const tagSelectors = this.getTagSelectorsForStep(step);
    const candidates = Array.from(scope.querySelectorAll(tagSelectors.join(', ')));
    
    for (const candidate of candidates) {
      if (!ElementStateCapture.isElementVisible(candidate)) continue;
      
      // Check if siblings match
      let matches = true;
      
      // Check preceding siblings
      if (siblings.before && siblings.before.length > 0) {
        let current: Element | null = candidate.previousElementSibling;
        let siblingIndex = siblings.before.length - 1;
        
        while (current && siblingIndex >= 0) {
          const siblingText = TextMatcher.normalize((current as HTMLElement).textContent || '');
          const expectedText = TextMatcher.normalize(siblings.before[siblingIndex]);
          
          if (!siblingText.includes(expectedText) && !expectedText.includes(siblingText)) {
            matches = false;
            break;
          }
          
          current = current.previousElementSibling;
          siblingIndex--;
        }
        
        if (siblingIndex >= 0) matches = false; // Not enough siblings
      }
      
      // Check following siblings
      if (matches && siblings.after && siblings.after.length > 0) {
        let current: Element | null = candidate.nextElementSibling;
        let siblingIndex = 0;
        
        while (current && siblingIndex < siblings.after.length) {
          const siblingText = TextMatcher.normalize((current as HTMLElement).textContent || '');
          const expectedText = TextMatcher.normalize(siblings.after[siblingIndex]);
          
          if (!siblingText.includes(expectedText) && !expectedText.includes(siblingText)) {
            matches = false;
            break;
          }
          
          current = current.nextElementSibling;
          siblingIndex++;
        }
        
        if (siblingIndex < siblings.after.length) matches = false; // Not enough siblings
      }
      
      if (matches) {
        return candidate;
      }
    }
    
    return null;
  }

  /**
   * Validate that element matches step requirements
   */
  private static isElementValid(element: Element, step: WorkflowStep): boolean {
    // Check visibility
    if (!ElementStateCapture.isElementVisible(element)) return false;
    
    // Check enabled state (for inputs and buttons)
    if (step.type === 'INPUT' || step.type === 'CLICK') {
      if (element instanceof HTMLElement && !ElementStateCapture.isElementEnabled(element)) {
        return false;
      }
    }
    
    // Check readonly state (for inputs)
    if (step.type === 'INPUT') {
      if (element instanceof HTMLElement && ElementStateCapture.isElementReadonly(element)) {
        // Readonly is OK if the step expects it
        return true;
      }
    }
    
    return true;
  }
}

