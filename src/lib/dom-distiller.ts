/**
 * DOM Distiller - Extracts structured candidate elements instead of sending full HTML
 * Reduces cost from $0.50 to $0.001 per call by sending only relevant data
 * Includes geometric filtering to narrow candidates before AI
 */

import type { WorkflowStep, ElementBounds } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import { SelectorEngine } from '../content/selector-engine';
import { ElementStateCapture } from '../content/element-state';

export interface CandidateElement {
  tag: string;
  text: string;
  role?: string;
  selector: string;
  attributes: Record<string, string>;
  distance?: number; // Distance from original element (for geometric filtering)
}

export interface FailureSnapshot {
  targetDescription: string;
  targetText?: string;
  candidates: CandidateElement[];
  context: string; // Truncated relevant section
}

export class DOMDistiller {
  /**
   * Create a failure snapshot for AI element finding
   * Instead of sending 5MB HTML, send structured candidates
   */
  static createFailureSnapshot(
    step: WorkflowStep,
    currentDOM: Document
  ): FailureSnapshot {
    if (!isWorkflowStepPayload(step.payload)) {
      // TAB_SWITCH steps don't need failure snapshots
      return {
        targetDescription: 'tab switch',
        candidates: [],
        context: '',
      };
    }
    
    // 1. Extract target description
    const targetDescription = step.payload.elementText || 
                             step.payload.label || 
                             'target element';
    
    // 2. Find candidate elements (top 5-10 matches)
    const candidates = this.findCandidateElements(step, currentDOM);
    
    // 3. Extract relevant context (form/container) - truncated to ~500 tokens
    const context = this.extractRelevantContext(step, currentDOM);
    
    return {
      targetDescription,
      targetText: step.payload.elementText,
      candidates,
      context,
    };
  }
  
  /**
   * Find candidate elements (top 5-10 matches)
   * Applies geometric filtering if elementBounds are available
   */
  private static findCandidateElements(
    step: WorkflowStep,
    doc: Document,
    maxCandidates: number = 10
  ): CandidateElement[] {
    if (!isWorkflowStepPayload(step.payload)) {
      return [];
    }
    
    const stepType = step.type;
    const targetText = step.payload.elementText || step.payload.label;
    
    // Find elements matching criteria
    let candidates: Element[] = [];
    
    if (stepType === 'CLICK') {
      // Find buttons, links, clickable elements
      candidates = Array.from(doc.querySelectorAll('button, a, [role="button"], [role="link"], [role="menuitem"], [role="option"]'));
    } else if (stepType === 'INPUT') {
      // Find inputs, textareas
      candidates = Array.from(doc.querySelectorAll('input, textarea, select, [contenteditable="true"]'));
    } else if (stepType === 'KEYBOARD') {
      // Find focusable elements
      candidates = Array.from(doc.querySelectorAll('input, textarea, select, button, a, [tabindex], [contenteditable="true"]'));
    } else {
      // Fallback: all interactive elements
      candidates = Array.from(doc.querySelectorAll('button, a, input, textarea, select, [role="button"], [role="link"]'));
    }
    
    // Filter by visibility
    candidates = candidates.filter(el => ElementStateCapture.isElementVisible(el));
    
    // Apply geometric filtering if elementBounds are available
    if (step.payload.elementBounds) {
      candidates = this.applyGeometricFilter(
        candidates,
        step.payload.elementBounds,
        100 // 100px tolerance
      );
    }
    
    // Filter by similarity (text, role, type)
    // Sort by relevance
    const scoredCandidates = candidates.map(candidate => {
      let score = 0;
      
      // Text similarity
      const candidateText = candidate.textContent?.trim() || '';
      if (targetText && candidateText) {
        const normalizedTarget = targetText.toLowerCase();
        const normalizedCandidate = candidateText.toLowerCase();
        if (normalizedCandidate.includes(normalizedTarget) || normalizedTarget.includes(normalizedCandidate)) {
          score += 10;
        }
        // Exact match gets higher score
        if (normalizedCandidate === normalizedTarget) {
          score += 20;
        }
      }
      
      // Role match
      const role = candidate.getAttribute('role');
      if (isWorkflowStepPayload(step.payload) && step.payload.elementRole && role === step.payload.elementRole) {
        score += 5;
      }
      
      // Tag match
      const tagName = candidate.tagName.toLowerCase();
      if (stepType === 'CLICK' && ['button', 'a'].includes(tagName)) {
        score += 3;
      } else if (stepType === 'INPUT' && ['input', 'textarea', 'select'].includes(tagName)) {
        score += 3;
      }
      
      return { element: candidate, score };
    });
    
    // Sort by score (highest first)
    scoredCandidates.sort((a, b) => b.score - a.score);
    
    // Return top N as structured data
    return scoredCandidates.slice(0, maxCandidates).map(({ element }) => {
      const rect = element.getBoundingClientRect();
      const bounds = isWorkflowStepPayload(step.payload) ? step.payload.elementBounds : undefined;
      let distance: number | undefined;
      
      if (bounds) {
        const candidateCenterX = rect.left + rect.width / 2;
        const candidateCenterY = rect.top + rect.height / 2;
        const targetCenterX = bounds.x + bounds.width / 2;
        const targetCenterY = bounds.y + bounds.height / 2;
        
        distance = Math.sqrt(
          Math.pow(candidateCenterX - targetCenterX, 2) +
          Math.pow(candidateCenterY - targetCenterY, 2)
        );
      }
      
      const selectors = SelectorEngine.generateSelectors(element);
      
      return {
        tag: element.tagName.toLowerCase(),
        text: element.textContent?.trim() || '',
        role: element.getAttribute('role') || undefined,
        selector: selectors.primary,
        attributes: this.extractAttributes(element),
        distance,
      };
    });
  }
  
  /**
   * Apply geometric filter to narrow candidates by proximity
   */
  private static applyGeometricFilter(
    candidates: Element[],
    bounds: ElementBounds,
    tolerance: number = 100
  ): Element[] {
    const targetCenterX = bounds.x + bounds.width / 2;
    const targetCenterY = bounds.y + bounds.height / 2;
    
    return candidates.filter(candidate => {
      const rect = candidate.getBoundingClientRect();
      const candidateCenterX = rect.left + rect.width / 2;
      const candidateCenterY = rect.top + rect.height / 2;
      
      const distance = Math.sqrt(
        Math.pow(candidateCenterX - targetCenterX, 2) +
        Math.pow(candidateCenterY - targetCenterY, 2)
      );
      
      return distance <= tolerance;
    });
  }
  
  /**
   * Extract relevant context (form, container) - truncated
   */
  static extractRelevantContext(
    step: WorkflowStep,
    doc: Document
  ): string {
    if (!isWorkflowStepPayload(step.payload)) {
      return '';
    }
    // Find parent form/container from step context
    const containerSelector = step.payload.context?.container?.selector;
    if (containerSelector) {
      try {
        const container = doc.querySelector(containerSelector);
        if (container) {
          // Extract container HTML, clean it, truncate
          return this.cleanAndTruncate(container.outerHTML, 2000);
        }
      } catch (e) {
        // Invalid selector, continue
      }
    }
    
    // Fallback: extract form if input step
    if (step.type === 'INPUT') {
      const form = doc.querySelector('form');
      if (form) {
        return this.cleanAndTruncate(form.outerHTML, 2000);
      }
    }
    
    // Fallback: extract body (truncated heavily)
    return this.cleanAndTruncate(doc.body?.outerHTML || '', 1000);
  }
  
  /**
   * Extract element context (small snippet, not full HTML)
   */
  static extractElementContext(element: Element): string {
    // Get parent form/container
    let container: Element | null = element.closest('form') || 
                                     element.closest('[role="form"]') ||
                                     element.parentElement;
    
    if (!container) {
      container = element;
    }
    
    // Extract only that section
    const html = container.outerHTML;
    
    // Clean and truncate
    return this.cleanAndTruncate(html, 500);
  }
  
  /**
   * Clean HTML and truncate to token limit
   */
  private static cleanAndTruncate(html: string, maxTokens: number): string {
    if (!html) return '';
    
    // Remove scripts, styles, comments
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    html = html.replace(/<!--[\s\S]*?-->/g, '');
    
    // Remove excessive whitespace
    html = html.replace(/\s+/g, ' ');
    
    // Truncate to maxTokens (rough estimate: 1 token ≈ 4 chars)
    const maxChars = maxTokens * 4;
    if (html.length > maxChars) {
      html = html.substring(0, maxChars) + '...';
    }
    
    return html;
  }
  
  /**
   * Extract relevant attributes from element
   */
  private static extractAttributes(element: Element): Record<string, string> {
    const attrs: Record<string, string> = {};
    const relevantAttrs = ['id', 'class', 'name', 'type', 'aria-label', 'aria-labelledby', 'data-testid', 'data-id'];
    
    for (const attr of relevantAttrs) {
      const value = element.getAttribute(attr);
      if (value) {
        attrs[attr] = value;
      }
    }
    
    return attrs;
  }

  /**
   * Capture a cleaned snapshot of the DOM around an element for AI context
   * Returns simplified HTML with only essential attributes
   */
  static captureInteractionContext(targetElement: HTMLElement): string {
    try {
      // 1. Find closest semantic container
      const container = this.findSemanticContainer(targetElement);
      
      // 2. Mark target element temporarily
      const tempId = `ghostwriter-target-${Date.now()}`;
      targetElement.setAttribute('data-ghostwriter-id', tempId);
      
      // 3. Clone the container
      const clone = container.cloneNode(true) as HTMLElement;
      
      // 4. Clean up real element immediately
      targetElement.removeAttribute('data-ghostwriter-id');
      
      // 5. Find and mark the target in clone
      const targetInClone = clone.querySelector(`[data-ghostwriter-id="${tempId}"]`);
      if (targetInClone) {
        targetInClone.removeAttribute('data-ghostwriter-id');
        targetInClone.setAttribute('data-ai-target', 'true');
      }
      
      // 6. Distill the clone
      this.distillClone(clone);
      
      // 7. Get HTML and truncate if needed
      let html = clone.outerHTML;
      if (html.length > 15000) {
        html = html.substring(0, 15000);
      }
      
      return html;
    } catch (error) {
      console.warn('GhostWriter: Failed to capture interaction context:', error);
      return '';
    }
  }

  /**
   * Find the closest semantic parent container
   */
  private static findSemanticContainer(element: HTMLElement): HTMLElement {
    const semanticTags = ['form', 'table', 'ul', 'ol', 'article', '[role="grid"]', '[role="dialog"]', '[role="main"]'];
    
    for (const tag of semanticTags) {
      const container = element.closest(tag);
      if (container instanceof HTMLElement) {
        return container;
      }
    }
    
    // Fallback to body
    return document.body;
  }

  /**
   * Distill clone by removing unwanted tags and attributes
   */
  private static distillClone(clone: HTMLElement): void {
    // Remove unwanted tags
    const unwantedTags = ['script', 'style', 'svg', 'path', 'link', 'meta', 'noscript'];
    for (const tag of unwantedTags) {
      const elements = clone.querySelectorAll(tag);
      elements.forEach(el => el.remove());
    }
    
    // Strip attributes (keep only essential ones)
    const keepAttributes = ['id', 'class', 'role', 'name', 'type', 'placeholder', 'value', 'data-testid', 'data-ai-target'];
    const allElements = clone.querySelectorAll('*');
    
    allElements.forEach(el => {
      const attributes = Array.from(el.attributes);
      for (const attr of attributes) {
        // Keep aria-* attributes
        if (attr.name.startsWith('aria-')) {
          continue;
        }
        // Keep whitelisted attributes
        if (keepAttributes.includes(attr.name)) {
          continue;
        }
        // Remove everything else
        el.removeAttribute(attr.name);
      }
    });
  }
}


