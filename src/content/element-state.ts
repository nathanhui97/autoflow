/**
 * ElementState - Utilities for capturing element state information
 */

import type { ElementState } from '../types/workflow';

export class ElementStateCapture {
  /**
   * Capture the current state of an element
   */
  static captureElementState(element: Element): ElementState {
    const htmlElement = element as HTMLElement;
    
    return {
      visible: this.isElementVisible(element),
      enabled: this.isElementEnabled(htmlElement),
      readonly: this.isElementReadonly(htmlElement),
      checked: this.isElementChecked(htmlElement),
    };
  }

  /**
   * Check if element is visible in viewport
   */
  static isElementVisible(element: Element): boolean {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    // Check if element has display: none or visibility: hidden
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    // Check if element has offsetParent (means it's in the layout)
    if (element.offsetParent === null && element.tagName !== 'BODY') {
      return false;
    }

    // Check bounding box
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }

    // Check if element is in viewport (at least partially)
    const isInViewport = 
      rect.top < window.innerHeight &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.right > 0;

    return isInViewport;
  }

  /**
   * Check if element is enabled (not disabled)
   */
  static isElementEnabled(element: HTMLElement): boolean {
    // Check disabled attribute
    if ('disabled' in element && (element as HTMLInputElement | HTMLButtonElement).disabled) {
      return false;
    }

    // Check pointer-events CSS
    const style = window.getComputedStyle(element);
    if (style.pointerEvents === 'none') {
      return false;
    }

    // Check if parent has disabled attribute (for form elements)
    let parent = element.parentElement;
    while (parent) {
      if (parent.hasAttribute('disabled')) {
        return false;
      }
      parent = parent.parentElement;
    }

    return true;
  }

  /**
   * Check if element is readonly (for inputs)
   */
  static isElementReadonly(element: HTMLElement): boolean | undefined {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.readOnly;
    }
    return undefined;
  }

  /**
   * Check if element is checked (for checkboxes/radios)
   */
  static isElementChecked(element: HTMLElement): boolean | undefined {
    if (element instanceof HTMLInputElement) {
      const inputType = element.type.toLowerCase();
      if (inputType === 'checkbox' || inputType === 'radio') {
        return element.checked;
      }
    }
    return undefined;
  }
}
