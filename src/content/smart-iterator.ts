/**
 * SmartIterator - The Looping Brain
 * 
 * Detects patterns in lists/tables and enables workflows to iterate
 * through multiple sibling elements. This is the core utility for
 * "Process the next N rows" functionality.
 */

import type { WorkflowStep } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';

// State classes to ignore when comparing elements
const STATE_CLASSES = [
  'active', 'selected', 'focused', 'hover', 'hovered',
  'current', 'highlighted', 'checked', 'disabled', 'enabled',
  'open', 'closed', 'expanded', 'collapsed',
  'even', 'odd', 'first', 'last',
  'ng-star-inserted', 'ng-animate', 'mat-focused', 'mat-selected',
  'cdk-focused', 'cdk-keyboard-focused', 'cdk-program-focused',
];

// Dynamic class patterns (indices, IDs, etc.)
const DYNAMIC_CLASS_PATTERNS = [
  /^row-\d+$/,           // row-0, row-1, etc.
  /^col-\d+$/,           // col-0, col-1, etc.
  /^index-\d+$/,         // index-0, index-1, etc.
  /^item-\d+$/,          // item-0, item-1, etc.
  /^data-row-\d+$/,      // data-row-0, etc.
  /^\d+$/,               // pure numbers
  /^[a-f0-9]{8,}$/i,     // hash-like IDs
];

export class SmartIterator {
  /**
   * Detect if a workflow step's element is part of a list/table pattern
   * 
   * Analyzes the step's visual snapshot and element structure
   * to determine if this element is likely one of many similar items.
   * 
   * @param step - The workflow step to analyze
   * @returns true if the element appears to be part of a list/table
   */
  static detectListPattern(step: WorkflowStep): boolean {
    // Skip non-element steps
    if (!isWorkflowStepPayload(step.payload)) {
      return false;
    }

    const payload = step.payload;

    // Check 1: Analyze selector for list-like patterns
    const selector = payload.selector?.toLowerCase() || '';
    
    // Table row patterns
    if (selector.includes('tr') || selector.includes('tbody')) {
      console.log('🔍 SmartIterator: Table row pattern detected in selector');
      return true;
    }

    // List item patterns
    if (selector.includes('li') || selector.includes('ul') || selector.includes('ol')) {
      console.log('🔍 SmartIterator: List item pattern detected in selector');
      return true;
    }

    // ARIA role patterns
    if (selector.includes('role="row"') || 
        selector.includes("role='row'") ||
        selector.includes('role="listitem"') ||
        selector.includes("role='listitem'") ||
        selector.includes('role="option"') ||
        selector.includes("role='option'")) {
      console.log('🔍 SmartIterator: ARIA role list pattern detected');
      return true;
    }

    // Check 2: Analyze grid coordinates (spreadsheet cells)
    if (payload.context?.gridCoordinates) {
      console.log('🔍 SmartIterator: Grid coordinates detected (spreadsheet pattern)');
      return true;
    }

    // Check 3: Analyze table coordinates
    if (payload.context?.tableCoordinates) {
      console.log('🔍 SmartIterator: Table coordinates detected');
      return true;
    }

    // No list pattern detected
    return false;
  }

  /**
   * Find the next logical sibling element that matches the current element's pattern
   * 
   * This method finds the next element sibling and validates that it looks
   * similar to the current element (same structure, similar classes).
   * 
   * @param currentElement - The current HTMLElement
   * @returns The next matching sibling, or null if no match found
   */
  static findNextSibling(currentElement: HTMLElement): HTMLElement | null {
    // Get the next element sibling
    const nextSibling = currentElement.nextElementSibling;

    // Check if sibling exists and is an HTMLElement
    if (!nextSibling || !(nextSibling instanceof HTMLElement)) {
      console.log('🔍 SmartIterator: No next sibling found');
      return null;
    }

    // Validate similarity
    if (!this.isSimilarElement(currentElement, nextSibling)) {
      console.log('🔍 SmartIterator: Next sibling does not match pattern (end of list)');
      return null;
    }

    console.log(`🔍 SmartIterator: Found matching next sibling <${nextSibling.tagName.toLowerCase()}>`);
    return nextSibling;
  }

  /**
   * Generate an iteration plan - array of the next N sibling elements
   * 
   * Useful for "Process the next 5 rows" functionality. Iterates through
   * siblings until the limit is reached or a non-matching element is found.
   * 
   * @param currentElement - Starting element (not included in result)
   * @param limit - Maximum number of siblings to find (default: 5)
   * @returns Array of matching sibling elements (may be shorter than limit)
   */
  static generateIterationPlan(
    currentElement: HTMLElement,
    limit: number = 5
  ): HTMLElement[] {
    const plan: HTMLElement[] = [];
    let current: HTMLElement = currentElement;

    console.log(`🔍 SmartIterator: Generating iteration plan (limit: ${limit})`);

    for (let i = 0; i < limit; i++) {
      const next = this.findNextSibling(current);
      
      if (!next) {
        // No more matching siblings
        break;
      }

      plan.push(next);
      current = next;
    }

    console.log(`🔍 SmartIterator: Generated plan with ${plan.length} elements`);
    return plan;
  }

  /**
   * Check if two elements are similar (likely the same type of list item)
   * 
   * Compares tag name, normalized class names, role attributes, and
   * parent structure to determine if elements are similar.
   * 
   * @param element1 - First element to compare
   * @param element2 - Second element to compare
   * @returns true if elements are similar
   */
  private static isSimilarElement(
    element1: HTMLElement,
    element2: HTMLElement
  ): boolean {
    // Check 1: Tag name must match exactly
    if (element1.tagName !== element2.tagName) {
      return false;
    }

    // Check 2: Role attribute must match (if present)
    const role1 = element1.getAttribute('role');
    const role2 = element2.getAttribute('role');
    if (role1 !== role2) {
      return false;
    }

    // Check 3: Compare normalized class names
    const classes1 = this.normalizeClassName(element1.className);
    const classes2 = this.normalizeClassName(element2.className);
    
    // Classes should be similar (allow for some variation)
    if (!this.classesMatch(classes1, classes2)) {
      return false;
    }

    // Check 4: Parent structure should match
    const parent1 = element1.parentElement;
    const parent2 = element2.parentElement;
    if (parent1 && parent2) {
      if (parent1 !== parent2 && parent1.tagName !== parent2.tagName) {
        return false;
      }
    }

    // All checks passed
    return true;
  }

  /**
   * Normalize a className string by removing state and dynamic classes
   * 
   * @param className - Raw className string
   * @returns Array of normalized class names (sorted for comparison)
   */
  private static normalizeClassName(className: string): string[] {
    if (!className || typeof className !== 'string') {
      return [];
    }

    return className
      .split(/\s+/)
      .filter(cls => {
        // Skip empty strings
        if (!cls) return false;

        // Skip state classes
        if (STATE_CLASSES.includes(cls.toLowerCase())) {
          return false;
        }

        // Skip dynamic class patterns
        for (const pattern of DYNAMIC_CLASS_PATTERNS) {
          if (pattern.test(cls)) {
            return false;
          }
        }

        return true;
      })
      .map(cls => cls.toLowerCase())
      .sort();
  }

  /**
   * Check if two normalized class arrays match
   * Uses Jaccard similarity - classes should have significant overlap
   * 
   * @param classes1 - First normalized class array
   * @param classes2 - Second normalized class array
   * @returns true if classes are similar enough
   */
  private static classesMatch(classes1: string[], classes2: string[]): boolean {
    // If both have no classes, they match
    if (classes1.length === 0 && classes2.length === 0) {
      return true;
    }

    // If one has classes and the other doesn't, they don't match
    if (classes1.length === 0 || classes2.length === 0) {
      return false;
    }

    // Calculate Jaccard similarity: intersection / union
    const set1 = new Set(classes1);
    const set2 = new Set(classes2);
    
    let intersection = 0;
    for (const cls of set1) {
      if (set2.has(cls)) {
        intersection++;
      }
    }

    const union = new Set([...classes1, ...classes2]).size;
    const similarity = intersection / union;

    // Require at least 60% similarity
    return similarity >= 0.6;
  }
}


