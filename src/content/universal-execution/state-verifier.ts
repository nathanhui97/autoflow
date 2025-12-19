/**
 * State Verifier
 * 
 * Verifies that actions produced expected outcomes.
 * Uses polling-based verification instead of arbitrary delays.
 */

import type {
  ExpectedOutcome,
  CapturedElementState,
} from '../../types/universal-types';

// ============================================================================
// Outcome Verification
// ============================================================================

/**
 * Verify that expected outcomes are met
 */
export async function verifyOutcome(
  outcomes: ExpectedOutcome[],
  timeout: number = 2000
): Promise<{ success: boolean; failedConditions: string[] }> {
  const startTime = Date.now();
  const failedConditions: string[] = [];
  
  while (Date.now() - startTime < timeout) {
    failedConditions.length = 0;
    let allPassed = true;
    
    for (const outcome of outcomes) {
      const passed = checkSingleOutcome(outcome);
      if (!passed) {
        allPassed = false;
        failedConditions.push(describeOutcome(outcome));
      }
    }
    
    if (allPassed) {
      return { success: true, failedConditions: [] };
    }
    
    // Wait before retry
    await sleep(50);
  }
  
  return { success: false, failedConditions };
}

/**
 * Check a single outcome condition
 */
function checkSingleOutcome(outcome: ExpectedOutcome): boolean {
  switch (outcome.type) {
    case 'element_visible': {
      const el = document.querySelector(outcome.selector);
      return el !== null && isVisible(el);
    }
    
    case 'element_gone': {
      const el = document.querySelector(outcome.selector);
      return el === null || !isVisible(el);
    }
    
    case 'element_has_text': {
      const el = document.querySelector(outcome.selector);
      return el !== null && el.textContent?.includes(outcome.text) === true;
    }
    
    case 'text_appears': {
      return document.body.textContent?.includes(outcome.text) === true;
    }
    
    case 'text_gone': {
      return document.body.textContent?.includes(outcome.text) === false;
    }
    
    case 'attribute_equals': {
      const el = document.querySelector(outcome.selector);
      return el !== null && el.getAttribute(outcome.attr) === outcome.value;
    }
    
    case 'attribute_contains': {
      const el = document.querySelector(outcome.selector);
      const attr = el?.getAttribute(outcome.attr);
      return attr !== null && attr !== undefined && attr.includes(outcome.value);
    }
    
    case 'url_contains': {
      return window.location.href.includes(outcome.value);
    }
    
    case 'url_changed': {
      // This needs to be checked against a baseline - handled separately
      return true;
    }
    
    case 'input_value': {
      const el = document.querySelector(outcome.selector);
      if (!el) return false;
      
      if (el instanceof HTMLInputElement || 
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement) {
        return el.value === outcome.value;
      }
      
      // Contenteditable
      return el.textContent?.trim() === outcome.value;
    }
    
    case 'dropdown_closed': {
      // Check for common dropdown menu patterns
      const openMenus = document.querySelectorAll(
        '[role="listbox"]:not([hidden]), ' +
        '[role="menu"]:not([hidden]), ' +
        '.MuiMenu-paper, ' +
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden), ' +
        '.dropdown-menu.show, ' +
        '[data-radix-select-content]'
      );
      
      for (const menu of openMenus) {
        if (isVisible(menu)) {
          return false;
        }
      }
      return true;
    }
    
    case 'dropdown_value': {
      const trigger = document.querySelector(outcome.triggerSelector);
      if (!trigger) return false;
      
      // Check various ways dropdown might show value
      const displayedValue = trigger.textContent?.trim();
      if (displayedValue?.includes(outcome.value)) return true;
      
      // Check aria-label
      const ariaLabel = trigger.getAttribute('aria-label');
      if (ariaLabel?.includes(outcome.value)) return true;
      
      // For native select
      if (trigger instanceof HTMLSelectElement) {
        const selectedOption = trigger.options[trigger.selectedIndex];
        if (selectedOption?.textContent?.includes(outcome.value)) return true;
      }
      
      return false;
    }
    
    case 'any_state_change': {
      // This is checked via captureElementState comparison
      return true;
    }
    
    default:
      return true;
  }
}

/**
 * Describe an outcome for error messages
 */
function describeOutcome(outcome: ExpectedOutcome): string {
  switch (outcome.type) {
    case 'element_visible':
      return `Element "${outcome.selector}" should be visible`;
    case 'element_gone':
      return `Element "${outcome.selector}" should be gone`;
    case 'element_has_text':
      return `Element "${outcome.selector}" should contain "${outcome.text}"`;
    case 'text_appears':
      return `Text "${outcome.text}" should appear`;
    case 'text_gone':
      return `Text "${outcome.text}" should disappear`;
    case 'attribute_equals':
      return `Element "${outcome.selector}" should have ${outcome.attr}="${outcome.value}"`;
    case 'attribute_contains':
      return `Element "${outcome.selector}" ${outcome.attr} should contain "${outcome.value}"`;
    case 'url_contains':
      return `URL should contain "${outcome.value}"`;
    case 'url_changed':
      return 'URL should change';
    case 'input_value':
      return `Input "${outcome.selector}" should have value "${outcome.value}"`;
    case 'dropdown_closed':
      return 'Dropdown should be closed';
    case 'dropdown_value':
      return `Dropdown should show value "${outcome.value}"`;
    case 'any_state_change':
      return 'Element state should change';
    default:
      return 'Unknown condition';
  }
}

// ============================================================================
// State Capture and Comparison
// ============================================================================

/**
 * Capture the current state of an element
 */
export function captureElementState(element: Element): CapturedElementState {
  return {
    className: element.className?.toString() || '',
    ariaExpanded: element.getAttribute('aria-expanded') || undefined,
    ariaChecked: element.getAttribute('aria-checked') || undefined,
    ariaPressed: element.getAttribute('aria-pressed') || undefined,
    ariaSelected: element.getAttribute('aria-selected') || undefined,
    ariaDisabled: element.getAttribute('aria-disabled') || undefined,
    disabled: (element as any).disabled === true,
    checked: (element as HTMLInputElement).checked,
    value: (element as HTMLInputElement).value,
    textContent: element.textContent?.slice(0, 100) || '',
    childCount: element.children.length,
    visible: isVisible(element),
  };
}

/**
 * Check if element state has changed
 */
export function hasStateChanged(
  before: CapturedElementState,
  after: CapturedElementState
): boolean {
  return (
    before.className !== after.className ||
    before.ariaExpanded !== after.ariaExpanded ||
    before.ariaChecked !== after.ariaChecked ||
    before.ariaPressed !== after.ariaPressed ||
    before.ariaSelected !== after.ariaSelected ||
    before.ariaDisabled !== after.ariaDisabled ||
    before.disabled !== after.disabled ||
    before.checked !== after.checked ||
    before.value !== after.value ||
    before.textContent !== after.textContent ||
    before.childCount !== after.childCount ||
    before.visible !== after.visible
  );
}

/**
 * Detect any state change on an element
 */
export async function detectAnyStateChange(
  element: Element,
  timeout: number = 1000
): Promise<boolean> {
  const initialState = captureElementState(element);
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const currentState = captureElementState(element);
    if (hasStateChanged(initialState, currentState)) {
      return true;
    }
    await sleep(50);
  }
  
  return false;
}

// ============================================================================
// Wait for Conditions
// ============================================================================

/**
 * Wait for a condition to be true
 */
export async function waitForCondition(
  predicate: () => boolean,
  timeout: number = 2000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (predicate()) {
      return true;
    }
    await sleep(50);
  }
  
  return false;
}

/**
 * Wait for DOM to stabilize (no mutations)
 */
export async function waitForDOMStable(
  timeout: number = 2000,
  stableTime: number = 150
): Promise<boolean> {
  return new Promise(resolve => {
    let lastMutation = Date.now();
    let resolved = false;
    
    const observer = new MutationObserver(() => {
      lastMutation = Date.now();
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    
    const checkStable = () => {
      if (resolved) return;
      
      const timeSinceLastMutation = Date.now() - lastMutation;
      
      if (timeSinceLastMutation >= stableTime) {
        resolved = true;
        observer.disconnect();
        resolve(true);
      } else if (Date.now() - lastMutation > timeout) {
        resolved = true;
        observer.disconnect();
        resolve(false);
      } else {
        setTimeout(checkStable, 50);
      }
    };
    
    // Start checking after a brief delay
    setTimeout(checkStable, 50);
    
    // Timeout fallback
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        resolve(false);
      }
    }, timeout);
  });
}

/**
 * Wait for an element to appear
 */
export async function waitForElement(
  selector: string,
  timeout: number = 2000
): Promise<Element | null> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const element = document.querySelector(selector);
    if (element && isVisible(element)) {
      return element;
    }
    await sleep(50);
  }
  
  return null;
}

/**
 * Wait for an element to disappear
 */
export async function waitForElementGone(
  selector: string,
  timeout: number = 2000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const element = document.querySelector(selector);
    if (!element || !isVisible(element)) {
      return true;
    }
    await sleep(50);
  }
  
  return false;
}

/**
 * Wait for dropdown menu to appear
 */
export async function waitForDropdownMenu(
  timeout: number = 2000
): Promise<Element | null> {
  const menuSelectors = [
    '[role="listbox"]',
    '[role="menu"]',
    '[data-radix-select-viewport]',
    '[data-radix-select-content]',
    '[data-radix-menu-content]',
    '.MuiMenu-paper',
    '.MuiPaper-root[role="listbox"]',
    '.MuiPopover-paper',
    '.ant-select-dropdown',
    '.chakra-menu__menu-list',
    '.dropdown-menu.show',
    '.dropdown-menu',
    '.select-menu',
    '[class*="__menu"]',
    '[class*="listbox"]',
  ];
  
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    for (const selector of menuSelectors) {
      const menu = document.querySelector(selector);
      if (menu && isVisible(menu) && hasOptions(menu)) {
        return menu;
      }
    }
    await sleep(50);
  }
  
  return null;
}

/**
 * Check if a menu element has options
 */
function hasOptions(menu: Element): boolean {
  const optionSelectors = [
    '[role="option"]',
    '[role="menuitem"]',
    'li',
    '[data-option]',
    '[data-value]',
    'option',
    '.MuiMenuItem-root',
    '.ant-select-item-option',
    '.dropdown-item',
  ];
  
  for (const selector of optionSelectors) {
    if (menu.querySelector(selector)) {
      return true;
    }
  }
  
  return false;
}

// ============================================================================
// Visibility Helpers
// ============================================================================

/**
 * Check if an element is visible
 */
function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return true;
  }
  
  const style = window.getComputedStyle(element);
  
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;
  
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  
  return true;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Dropdown-Specific Verification
// ============================================================================

/**
 * Verify that a dropdown selection was successful
 */
export async function verifyDropdownSelection(
  trigger: Element,
  expectedValue: string,
  timeout: number = 1000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    // Check trigger text content
    const triggerText = trigger.textContent?.trim();
    if (triggerText?.includes(expectedValue)) {
      return true;
    }
    
    // Check for native select
    if (trigger instanceof HTMLSelectElement) {
      const selectedOption = trigger.options[trigger.selectedIndex];
      if (selectedOption?.textContent?.includes(expectedValue)) {
        return true;
      }
      if (trigger.value === expectedValue) {
        return true;
      }
    }
    
    // Check value display elements inside trigger
    const valueDisplay = trigger.querySelector(
      '.MuiSelect-select, .ant-select-selection-item, ' +
      '[class*="value"], [class*="selected"]'
    );
    if (valueDisplay?.textContent?.includes(expectedValue)) {
      return true;
    }
    
    // Check aria-label
    const ariaLabel = trigger.getAttribute('aria-label');
    if (ariaLabel?.includes(expectedValue)) {
      return true;
    }
    
    await sleep(50);
  }
  
  return false;
}

/**
 * Verify that dropdown is closed
 */
export async function verifyDropdownClosed(
  timeout: number = 1000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const openMenus = document.querySelectorAll(
      '[role="listbox"], [role="menu"], ' +
      '.MuiMenu-paper, .ant-select-dropdown:not(.ant-select-dropdown-hidden), ' +
      '.dropdown-menu.show, [data-radix-select-content]'
    );
    
    let anyVisible = false;
    for (const menu of openMenus) {
      if (isVisible(menu)) {
        anyVisible = true;
        break;
      }
    }
    
    if (!anyVisible) {
      return true;
    }
    
    await sleep(50);
  }
  
  return false;
}

