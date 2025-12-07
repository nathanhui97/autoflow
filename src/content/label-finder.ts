/**
 * LabelFinder - Finds labels associated with input elements
 */

import { ShadowDOMUtils } from './shadow-dom-utils';

export class LabelFinder {
  /**
   * Find the label for an input element using multiple strategies
   * Now supports Shadow DOM
   */
  static findLabel(inputElement: HTMLElement): string | null {
    // Strategy 1: Check label[for="input-id"] association
    if (inputElement.id) {
      // Check in regular DOM
      let label = document.querySelector(`label[for="${CSS.escape(inputElement.id)}"]`);
      if (label) {
        const text = label.textContent?.trim();
        if (text && text.length > 0) {
          return text;
        }
      }

      // Check in Shadow DOM
      label = this.findLabelInShadowDOM(inputElement.id);
      if (label) {
        const text = label.textContent?.trim();
        if (text && text.length > 0) {
          return text;
        }
      }
    }

    // Strategy 2: Find closest parent <label> element (including Shadow DOM)
    let parent = inputElement.parentElement;
    let depth = 0;
    const maxDepth = 5; // Limit search depth

    while (parent && depth < maxDepth) {
      if (parent.tagName.toLowerCase() === 'label') {
        const text = parent.textContent?.trim();
        if (text && text.length > 0) {
          // Remove the input's own text content if it's included
          const inputText = inputElement.textContent?.trim() || '';
          const labelText = text.replace(inputText, '').trim();
          if (labelText.length > 0) {
            return labelText;
          }
          return text; // Fallback to full text if we can't separate
        }
      }
      parent = parent.parentElement;
      depth++;
    }

    // Check in Shadow DOM for parent label
    const shadowLabel = this.findParentLabelInShadowDOM(inputElement);
    if (shadowLabel) {
      return shadowLabel;
    }

    // Strategy 3: Search preceding siblings for text
    let sibling = inputElement.previousElementSibling;
    depth = 0;
    const maxSiblingDepth = 3; // Check up to 3 preceding siblings

    while (sibling && depth < maxSiblingDepth) {
      const text = sibling.textContent?.trim();
      if (text && text.length > 0 && text.length < 100) {
        // Check if it looks like a label (not too long, might have colon)
        if (text.match(/^[^:]+:?\s*$/)) {
          return text.replace(/:\s*$/, '').trim();
        }
      }
      sibling = sibling.previousElementSibling;
      depth++;
    }

    // Strategy 4: Check for aria-label on the input itself
    const ariaLabel = inputElement.getAttribute('aria-label');
    if (ariaLabel) {
      return ariaLabel.trim();
    }

    // Strategy 5: Check for placeholder (often descriptive)
    const placeholder = (inputElement as HTMLInputElement).placeholder;
    if (placeholder) {
      return placeholder.trim();
    }

    return null;
  }

  /**
   * Find label in Shadow DOM by for attribute
   */
  private static findLabelInShadowDOM(inputId: string): HTMLLabelElement | null {
    // Traverse all shadow roots
    const allElements = document.querySelectorAll('*');
    for (const element of allElements) {
      if (element.shadowRoot) {
        const label = element.shadowRoot.querySelector(`label[for="${CSS.escape(inputId)}"]`);
        if (label) {
          return label as HTMLLabelElement;
        }
      }
    }
    return null;
  }

  /**
   * Find parent label in Shadow DOM
   */
  private static findParentLabelInShadowDOM(element: HTMLElement): string | null {
    const shadowHost = ShadowDOMUtils.getShadowHost(element);
    if (!shadowHost || !shadowHost.shadowRoot) {
      return null;
    }

    // Check if element is in a label within shadow root
    let current: Element | null = element;
    const shadowRoot = shadowHost.shadowRoot;

    while (current && current.getRootNode() === shadowRoot) {
      if (current.tagName.toLowerCase() === 'label') {
        const text = current.textContent?.trim();
        if (text && text.length > 0) {
          return text;
        }
      }
      current = current.parentElement;
    }

    return null;
  }
}

