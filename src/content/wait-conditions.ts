/**
 * WaitConditions - Utilities for determining wait conditions for replay
 */

import type { WorkflowStep, WaitCondition } from '../types/workflow';

export class WaitConditionDeterminer {
  private static readonly DEFAULT_TIMEOUT = 5000; // 5 seconds

  /**
   * Determine wait conditions for a step based on the step type and previous step
   */
  static determineWaitConditions(
    step: WorkflowStep,
    previousStep?: WorkflowStep
  ): WaitCondition[] {
    const conditions: WaitCondition[] = [];

    // CRITICAL: If THIS step is a dropdown click, wait for menu to appear
    if (step.type === 'CLICK' && this.isDropdownClick(step)) {
      // Wait for common dropdown menu indicators
      const menuSelectors = [
        '[role="listbox"]',
        '[role="menu"]',
        '[role="option"]',
        'ul[role="listbox"]',
        'ul[role="menu"]',
        '.dropdown-menu',
        '.menu',
        '[aria-expanded="true"]',
      ];
      
      // Try to find a menu selector from context or fallbacks
      const dropdownSelector = this.getDropdownSelector(step);
      if (dropdownSelector) {
        conditions.push({
          type: 'element',
          selector: dropdownSelector,
          timeout: this.DEFAULT_TIMEOUT,
        });
      } else {
        // Fallback: wait for any menu/listbox to appear
        for (const menuSelector of menuSelectors) {
          conditions.push({
            type: 'element',
            selector: menuSelector,
            timeout: this.DEFAULT_TIMEOUT,
          });
          break; // Just wait for first one
        }
      }
      
      // Also wait a small delay for menu animation
      conditions.push({
        type: 'time',
        timeout: 300, // 300ms for menu to appear
      });
    }

    // After a CLICK, we might need to wait for various things
    if (previousStep?.type === 'CLICK') {
      // If current step is NAVIGATION, we already navigated, so wait for URL
      if (step.type === 'NAVIGATION') {
        conditions.push({
          type: 'url',
          url: step.payload.url,
          timeout: this.DEFAULT_TIMEOUT,
        });
      }
      // If previous step was a dropdown click, wait for dropdown menu to appear
      else if (this.isDropdownClick(previousStep)) {
        // Try to determine dropdown selector from context
        const dropdownSelector = this.getDropdownSelector(previousStep);
        if (dropdownSelector) {
          conditions.push({
            type: 'element',
            selector: dropdownSelector,
            timeout: this.DEFAULT_TIMEOUT,
          });
        }
      }
      // For other clicks, wait for element to be visible/enabled
      else if (step.type === 'CLICK' || step.type === 'INPUT') {
        conditions.push({
          type: 'element',
          selector: step.payload.selector,
          timeout: this.DEFAULT_TIMEOUT,
        });
      }
    }

    // After an INPUT, wait for element to remain visible/enabled
    if (previousStep?.type === 'INPUT') {
      if (step.type === 'CLICK' || step.type === 'INPUT') {
        conditions.push({
          type: 'element',
          selector: step.payload.selector,
          timeout: this.DEFAULT_TIMEOUT,
        });
      }
    }

    // After NAVIGATION, wait for URL and then for element to appear
    if (previousStep?.type === 'NAVIGATION') {
      conditions.push({
        type: 'url',
        url: previousStep.payload.url,
        timeout: this.DEFAULT_TIMEOUT,
      });
      
      if (step.type === 'CLICK' || step.type === 'INPUT') {
        conditions.push({
          type: 'element',
          selector: step.payload.selector,
          timeout: this.DEFAULT_TIMEOUT,
        });
      }
    }

    // For the first step, wait for element to be visible
    if (!previousStep && (step.type === 'CLICK' || step.type === 'INPUT')) {
      conditions.push({
        type: 'element',
        selector: step.payload.selector,
        timeout: this.DEFAULT_TIMEOUT,
      });
    }

    // If element has text, we can also wait for that text to appear
    if (step.payload.elementText) {
      conditions.push({
        type: 'text',
        text: step.payload.elementText,
        timeout: this.DEFAULT_TIMEOUT,
      });
    }

    // Deduplicate wait conditions (remove duplicates with same type and selector/text)
    const uniqueConditions: WaitCondition[] = [];
    const seenKeys = new Set<string>();
    
    for (const condition of conditions) {
      const key = condition.type === 'element' ? `element:${condition.selector}` :
                  condition.type === 'text' ? `text:${condition.text}` :
                  condition.type === 'url' ? `url:${condition.url}` :
                  `time:${condition.timeout}`;
      
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueConditions.push(condition);
      }
    }

    return uniqueConditions;
  }

  /**
   * Check if a click is likely a dropdown/menu trigger
   */
  private static isDropdownClick(step: WorkflowStep): boolean {
    if (step.type !== 'CLICK') return false;

    const elementText = step.payload.elementText?.toLowerCase() || '';
    
    // Check for ARIA attributes that indicate dropdown (highest confidence)
    const ariaHaspopup = step.payload.context?.parent?.attributes?.['aria-haspopup'];
    const ariaExpanded = step.payload.context?.parent?.attributes?.['aria-expanded'];
    if (ariaHaspopup === 'true' || ariaHaspopup === 'listbox' || ariaHaspopup === 'menu') {
      return true;
    }
    if (ariaExpanded === 'false') { // Closed dropdown that will expand
      return true;
    }

    // Check for role attributes
    const role = step.payload.elementRole || step.payload.context?.parent?.attributes?.['role'];
    if (role === 'combobox' || (role === 'button' && ariaHaspopup)) {
      return true;
    }

    // Check for common dropdown indicators in text (but be more specific)
    // Only if text is short (dropdown triggers are usually short labels)
    if (elementText.length < 50) {
      const dropdownIndicators = ['select', 'choose', 'dropdown'];
      if (dropdownIndicators.some(indicator => elementText.includes(indicator))) {
        // Also check if element has siblings that suggest dropdown (e.g., "open" after click)
        if (step.payload.context?.siblings?.after) {
          const afterSiblings = step.payload.context.siblings.after;
          if (afterSiblings.some(sibling => 
            sibling.toLowerCase().includes('open') || 
            sibling.toLowerCase().includes('menu')
          )) {
            return true;
          }
        }
      }
    }

    // Check if element has siblings that suggest it's a dropdown trigger
    // (e.g., "open" text after clicking a select field) - but only if text is short
    if (elementText.length < 50 && step.payload.context?.siblings?.after) {
      const afterSiblings = step.payload.context.siblings.after;
      if (afterSiblings.some(sibling => 
        sibling.toLowerCase().includes('open') || 
        sibling.toLowerCase().includes('menu')
      )) {
        return true;
      }
    }

    return false;
  }

  /**
   * Try to determine dropdown selector from step context
   */
  private static getDropdownSelector(step: WorkflowStep): string | undefined {
    // Look for common dropdown menu selectors in fallback selectors
    const menuSelectors = step.payload.fallbackSelectors.filter(sel => 
      sel.includes('menu') || 
      sel.includes('dropdown') || 
      sel.includes('listbox') ||
      sel.includes('ul') ||
      sel.includes('option')
    );

    if (menuSelectors.length > 0) {
      return menuSelectors[0];
    }

    // Could also look in context for menu-related elements
    if (step.payload.context?.ancestors) {
      const menuAncestor = step.payload.context.ancestors.find(anc => 
        anc.role === 'listbox' || 
        anc.role === 'menu' ||
        anc.selector?.includes('menu') ||
        anc.selector?.includes('listbox')
      );
      if (menuAncestor?.selector) {
        return menuAncestor.selector;
      }
    }

    return undefined;
  }
}
