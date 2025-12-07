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
      // If clicking a dropdown, wait for dropdown menu to appear
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

    return conditions;
  }

  /**
   * Check if a click is likely a dropdown/menu trigger
   */
  private static isDropdownClick(step: WorkflowStep): boolean {
    if (step.type !== 'CLICK') return false;

    const elementText = step.payload.elementText?.toLowerCase() || '';
    const selector = step.payload.selector.toLowerCase();
    
    // Check for common dropdown indicators
    const dropdownIndicators = ['open', 'menu', 'dropdown', 'select', 'options'];
    if (dropdownIndicators.some(indicator => elementText.includes(indicator) || selector.includes(indicator))) {
      return true;
    }

    // Check if next step is clicking something that appeared (like a menu item)
    // This would be determined by the caller based on context
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
