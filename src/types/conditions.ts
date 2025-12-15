/**
 * Success Condition Types - Compound conditions for verification
 * 
 * Supports AND/OR/NOT combinations for real-world verification.
 * All conditions are required by default - no optional flag to prevent silent drift.
 */

import type { Scope } from './scope';

/**
 * Compound success condition with AND/OR/NOT support
 */
export type SuccessCondition =
  | AllCondition
  | AnyCondition
  | NotCondition
  | ElementCondition
  | StateCondition;

/**
 * All conditions must pass (AND)
 */
export interface AllCondition {
  all: SuccessCondition[];
}

/**
 * At least one condition must pass (OR)
 */
export interface AnyCondition {
  any: SuccessCondition[];
}

/**
 * Condition must NOT pass (negation)
 */
export interface NotCondition {
  not: SuccessCondition;
}

/**
 * Element-based conditions
 */
export interface ElementCondition {
  type: 'element_visible' | 'element_gone' | 'element_enabled' | 'element_disabled' | 
        'element_checked' | 'element_unchecked' | 'element_focused' | 'element_has_text' |
        'element_has_value' | 'element_has_attribute';
  /** Selector or text to match */
  target: string;
  /** Optional scope to search within */
  scope?: Scope;
  /** Maximum time to wait in ms */
  timeout: number;
  /** Expected value for has_text, has_value, has_attribute */
  expectedValue?: string;
  /** Attribute name for has_attribute */
  attributeName?: string;
}

/**
 * State-based conditions (page/network level)
 */
export interface StateCondition {
  type: 'url_changed' | 'url_contains' | 'url_matches' | 
        'text_appeared' | 'text_gone' |
        'title_contains' | 'title_matches' |
        'dom_stable' | 'network_idle' | 'no_loaders' |
        'cookie_set' | 'storage_set';
  /** Value for matching (URL pattern, text, etc.) */
  value?: string;
  /** Maximum time to wait in ms */
  timeout: number;
  /** Scope for text conditions */
  scope?: Scope;
}

/**
 * Type guards
 */
export function isAllCondition(cond: SuccessCondition): cond is AllCondition {
  return 'all' in cond && Array.isArray((cond as AllCondition).all);
}

export function isAnyCondition(cond: SuccessCondition): cond is AnyCondition {
  return 'any' in cond && Array.isArray((cond as AnyCondition).any);
}

export function isNotCondition(cond: SuccessCondition): cond is NotCondition {
  return 'not' in cond && typeof (cond as NotCondition).not === 'object';
}

export function isElementCondition(cond: SuccessCondition): cond is ElementCondition {
  return 'type' in cond && 'target' in cond && typeof (cond as ElementCondition).target === 'string';
}

export function isStateCondition(cond: SuccessCondition): cond is StateCondition {
  return 'type' in cond && !('target' in cond);
}

/**
 * Create an "all" (AND) condition
 */
export function all(...conditions: SuccessCondition[]): AllCondition {
  return { all: conditions };
}

/**
 * Create an "any" (OR) condition
 */
export function any(...conditions: SuccessCondition[]): AnyCondition {
  return { any: conditions };
}

/**
 * Create a "not" (negation) condition
 */
export function not(condition: SuccessCondition): NotCondition {
  return { not: condition };
}

/**
 * Create an element visible condition
 */
export function elementVisible(
  target: string, 
  timeout: number = 5000, 
  scope?: Scope
): ElementCondition {
  return { type: 'element_visible', target, timeout, scope };
}

/**
 * Create an element gone condition
 */
export function elementGone(
  target: string, 
  timeout: number = 5000, 
  scope?: Scope
): ElementCondition {
  return { type: 'element_gone', target, timeout, scope };
}

/**
 * Create an element enabled condition
 */
export function elementEnabled(
  target: string, 
  timeout: number = 5000, 
  scope?: Scope
): ElementCondition {
  return { type: 'element_enabled', target, timeout, scope };
}

/**
 * Create an element disabled condition
 */
export function elementDisabled(
  target: string, 
  timeout: number = 5000, 
  scope?: Scope
): ElementCondition {
  return { type: 'element_disabled', target, timeout, scope };
}

/**
 * Create an element has text condition
 */
export function elementHasText(
  target: string,
  expectedValue: string,
  timeout: number = 5000,
  scope?: Scope
): ElementCondition {
  return { type: 'element_has_text', target, timeout, scope, expectedValue };
}

/**
 * Create a URL changed condition
 */
export function urlChanged(timeout: number = 5000): StateCondition {
  return { type: 'url_changed', timeout };
}

/**
 * Create a URL contains condition
 */
export function urlContains(value: string, timeout: number = 5000): StateCondition {
  return { type: 'url_contains', value, timeout };
}

/**
 * Create a text appeared condition
 */
export function textAppeared(
  value: string, 
  timeout: number = 5000,
  scope?: Scope
): StateCondition {
  return { type: 'text_appeared', value, timeout, scope };
}

/**
 * Create a text gone condition
 */
export function textGone(
  value: string, 
  timeout: number = 5000,
  scope?: Scope
): StateCondition {
  return { type: 'text_gone', value, timeout, scope };
}

/**
 * Create a DOM stable condition
 */
export function domStable(timeout: number = 3000): StateCondition {
  return { type: 'dom_stable', timeout };
}

/**
 * Create a network idle condition
 */
export function networkIdle(timeout: number = 5000): StateCondition {
  return { type: 'network_idle', timeout };
}

/**
 * Create a no loaders condition
 */
export function noLoaders(timeout: number = 5000): StateCondition {
  return { type: 'no_loaders', timeout };
}

/**
 * Get human-readable description of a condition
 */
export function describeCondition(cond: SuccessCondition, indent: number = 0): string {
  const pad = '  '.repeat(indent);
  
  if (isAllCondition(cond)) {
    const children = cond.all.map(c => describeCondition(c, indent + 1)).join('\n');
    return `${pad}ALL of:\n${children}`;
  }
  
  if (isAnyCondition(cond)) {
    const children = cond.any.map(c => describeCondition(c, indent + 1)).join('\n');
    return `${pad}ANY of:\n${children}`;
  }
  
  if (isNotCondition(cond)) {
    return `${pad}NOT ${describeCondition(cond.not, 0)}`;
  }
  
  if (isElementCondition(cond)) {
    switch (cond.type) {
      case 'element_visible':
        return `${pad}Element "${cond.target}" is visible`;
      case 'element_gone':
        return `${pad}Element "${cond.target}" is gone`;
      case 'element_enabled':
        return `${pad}Element "${cond.target}" is enabled`;
      case 'element_disabled':
        return `${pad}Element "${cond.target}" is disabled`;
      case 'element_checked':
        return `${pad}Element "${cond.target}" is checked`;
      case 'element_unchecked':
        return `${pad}Element "${cond.target}" is unchecked`;
      case 'element_focused':
        return `${pad}Element "${cond.target}" is focused`;
      case 'element_has_text':
        return `${pad}Element "${cond.target}" has text "${cond.expectedValue}"`;
      case 'element_has_value':
        return `${pad}Element "${cond.target}" has value "${cond.expectedValue}"`;
      case 'element_has_attribute':
        return `${pad}Element "${cond.target}" has ${cond.attributeName}="${cond.expectedValue}"`;
    }
  }
  
  if (isStateCondition(cond)) {
    switch (cond.type) {
      case 'url_changed':
        return `${pad}URL changed`;
      case 'url_contains':
        return `${pad}URL contains "${cond.value}"`;
      case 'url_matches':
        return `${pad}URL matches "${cond.value}"`;
      case 'text_appeared':
        return `${pad}Text "${cond.value}" appeared`;
      case 'text_gone':
        return `${pad}Text "${cond.value}" is gone`;
      case 'title_contains':
        return `${pad}Title contains "${cond.value}"`;
      case 'title_matches':
        return `${pad}Title matches "${cond.value}"`;
      case 'dom_stable':
        return `${pad}DOM is stable`;
      case 'network_idle':
        return `${pad}Network is idle`;
      case 'no_loaders':
        return `${pad}No loaders visible`;
      case 'cookie_set':
        return `${pad}Cookie "${cond.value}" is set`;
      case 'storage_set':
        return `${pad}Storage "${cond.value}" is set`;
    }
  }
  
  return `${pad}Unknown condition`;
}

/**
 * Suggested condition with confidence and reason
 */
export interface SuggestedCondition {
  condition: SuccessCondition;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Common condition templates for different action types
 */
export const conditionTemplates = {
  // Click on dropdown trigger -> menu visible
  dropdownOpened: (menuSelector: string = '[role="menu"], [role="listbox"]') => 
    elementVisible(menuSelector, 3000),
  
  // Click submit -> success toast OR URL changed
  formSubmitted: (successSelector?: string) => 
    successSelector 
      ? any(elementVisible(successSelector, 5000), urlChanged(5000))
      : any(elementVisible('[role="alert"]', 5000), urlChanged(5000)),
  
  // Modal opened
  modalOpened: (modalSelector: string = '[role="dialog"]') =>
    elementVisible(modalSelector, 3000),
  
  // Modal closed
  modalClosed: (modalSelector: string = '[role="dialog"]') =>
    elementGone(modalSelector, 3000),
  
  // Page navigation
  pageNavigated: (urlPattern?: string) =>
    urlPattern ? urlContains(urlPattern, 10000) : urlChanged(10000),
  
  // Loader finished
  loadingComplete: () =>
    all(noLoaders(5000), domStable(1000)),
  
  // Delete confirmation
  deleteConfirmed: (confirmSelector?: string) =>
    confirmSelector
      ? elementVisible(confirmSelector, 3000)
      : elementVisible('[role="dialog"]', 3000),
};

