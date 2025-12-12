/**
 * WaitConditions - Utilities for determining wait conditions for replay
 */

import type { WorkflowStep, WaitCondition } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';

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

    // Skip TAB_SWITCH steps - they handle their own waiting
    if (step.type === 'TAB_SWITCH' || !isWorkflowStepPayload(step.payload)) {
      return conditions;
    }

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
      if (step.type === 'NAVIGATION' && isWorkflowStepPayload(step.payload)) {
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
      else if ((step.type === 'CLICK' || step.type === 'INPUT') && isWorkflowStepPayload(step.payload)) {
        conditions.push({
          type: 'element',
          selector: step.payload.selector,
          timeout: this.DEFAULT_TIMEOUT,
        });
      }
    }

    // After an INPUT, wait for element to remain visible/enabled
    if (previousStep?.type === 'INPUT') {
      if ((step.type === 'CLICK' || step.type === 'INPUT') && isWorkflowStepPayload(step.payload)) {
        conditions.push({
          type: 'element',
          selector: step.payload.selector,
          timeout: this.DEFAULT_TIMEOUT,
        });
      }
    }

    // After NAVIGATION, wait for URL and then for element to appear
    if (previousStep?.type === 'NAVIGATION' && isWorkflowStepPayload(previousStep.payload)) {
      conditions.push({
        type: 'url',
        url: previousStep.payload.url,
        timeout: this.DEFAULT_TIMEOUT,
      });
      
      if ((step.type === 'CLICK' || step.type === 'INPUT') && isWorkflowStepPayload(step.payload)) {
        conditions.push({
          type: 'element',
          selector: step.payload.selector,
          timeout: this.DEFAULT_TIMEOUT,
        });
      }
    }

    // For the first step, wait for element to be visible
    if (!previousStep && (step.type === 'CLICK' || step.type === 'INPUT') && isWorkflowStepPayload(step.payload)) {
      conditions.push({
        type: 'element',
        selector: step.payload.selector,
        timeout: this.DEFAULT_TIMEOUT,
      });
    }

    // If element has text, we can also wait for that text to appear
    if (isWorkflowStepPayload(step.payload) && step.payload.elementText) {
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
   * Extract ARIA attribute value from selector pattern
   * Handles patterns like [aria-haspopup="menu"] or [aria-haspopup='true']
   */
  private static extractAriaFromSelector(selector: string, attrName: string): string | null {
    if (!selector) return null;
    
    // Match patterns like [aria-haspopup="menu"] or [aria-haspopup='true'] or [aria-haspopup=menu]
    const patterns = [
      new RegExp(`\\[${attrName}=["']([^"']+)["']\\]`, 'i'),
      new RegExp(`\\[${attrName}=([^\\]]+)\\]`, 'i'),
    ];
    
    for (const pattern of patterns) {
      const match = selector.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    return null;
  }

  /**
   * Check if a click is likely a dropdown/menu trigger
   * Dynamic detection that works across different websites
   */
  private static isDropdownClick(step: WorkflowStep): boolean {
    if (step.type !== 'CLICK' || !isWorkflowStepPayload(step.payload)) return false;

    const elementText = step.payload.elementText?.toLowerCase() || '';
    const selector = step.payload.selector || '';
    
    // PRIORITY 1: Check for ARIA attributes that indicate dropdown/menu (highest confidence, works everywhere)
    // Check element's own attributes (via selector), then parent
    const parentAttrs = step.payload.context?.parent?.attributes || {};
    
    // Extract from selector (element's own attributes)
    const ariaHaspopupFromSelector = this.extractAriaFromSelector(selector, 'aria-haspopup');
    const ariaExpandedFromSelector = this.extractAriaFromSelector(selector, 'aria-expanded');
    
    // Combine all attribute sources (element's own > parent)
    const ariaHaspopup = ariaHaspopupFromSelector ||
                         parentAttrs['aria-haspopup'];
    
    const ariaExpanded = ariaExpandedFromSelector ||
                         parentAttrs['aria-expanded'];
    
    if (ariaHaspopup === 'true' || ariaHaspopup === 'listbox' || ariaHaspopup === 'menu' || ariaHaspopup === 'dialog') {
      console.log('GhostWriter: Detected menu trigger via aria-haspopup:', ariaHaspopup);
      return true;
    }
    if (ariaExpanded === 'false') { // Closed dropdown that will expand
      console.log('GhostWriter: Detected menu trigger via aria-expanded=false');
      return true;
    }

    // PRIORITY 2: Check for role attributes (semantic, works across sites)
    const role = step.payload.elementRole || 
                 parentAttrs['role'] ||
                 step.payload.context?.ancestors?.find((a: { role?: string }) => a.role)?.role;
    
    if (role === 'combobox' || (role === 'button' && ariaHaspopup)) {
      console.log('GhostWriter: Detected menu trigger via role:', role);
      return true;
    }
    
    // PRIORITY 3: Check for button elements that likely open menus (dynamic detection)
    // Icon buttons (no text or very short text) that are likely menu triggers
    const isIconButton = step.payload.elementRole === 'button' && 
                         (!elementText || elementText.length <= 3);
    
    // Check if button has menu-related aria-label (works across sites)
    const ariaLabel = step.payload.context?.parent?.attributes?.['aria-label']?.toLowerCase();
    
    const hasMenuAriaLabel = ariaLabel && (
      ariaLabel.includes('menu') ||
      ariaLabel.includes('more') ||
      ariaLabel.includes('options') ||
      ariaLabel.includes('actions') ||
      ariaLabel.includes('settings')
    );
    
    if (isIconButton && hasMenuAriaLabel) {
      console.log('GhostWriter: Detected menu trigger - icon button with menu aria-label');
      return true;
    }
    
    // PRIORITY 4: Check for buttons in toolbar/action areas (common pattern)
    // These are often menu triggers even without explicit ARIA
    const isInToolbar = step.payload.context?.ancestors?.some((a: { role?: string; selector?: string }) => 
      a.role === 'toolbar' || 
      a.selector?.toLowerCase().includes('toolbar') ||
      a.selector?.toLowerCase().includes('action') ||
      a.selector?.toLowerCase().includes('menu')
    );
    
    if (isIconButton && isInToolbar) {
      console.log('GhostWriter: Detected menu trigger - icon button in toolbar/action area');
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
          if (afterSiblings.some((sibling: string) => 
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
      if (afterSiblings.some((sibling: string) => 
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
    if (!isWorkflowStepPayload(step.payload)) {
      return undefined;
    }
    // Look for common dropdown menu selectors in fallback selectors
    const menuSelectors = step.payload.fallbackSelectors.filter((sel: string) => 
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
