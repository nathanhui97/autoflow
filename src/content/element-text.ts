/**
 * ElementText - Utilities for capturing element text content
 */

export class ElementTextCapture {
  /**
   * Capture the exact text content of an element
   * Returns undefined if element has no meaningful text
   */
  static captureElementText(element: Element): string | undefined {
    const tagName = element.tagName.toLowerCase();
    
    // For buttons, links, labels, and interactive elements
    if (['button', 'a', 'label', 'span', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
      // Try textContent first (includes hidden text)
      let text = element.textContent?.trim();
      
      // If no textContent, try innerText (only visible text)
      if (!text || text.length === 0) {
        if (element instanceof HTMLElement) {
          text = element.innerText?.trim();
    }
      }
      
      // For links and buttons, also check aria-label as fallback
      if ((!text || text.length === 0) && (tagName === 'a' || tagName === 'button')) {
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) {
          text = ariaLabel.trim();
        }
      }
      
      // Normalize and limit text
      if (text && text.length > 0) {
        // Normalize whitespace (replace multiple spaces/tabs/newlines with single space)
        text = text.replace(/\s+/g, ' ').trim();
        
        // Limit to 200 characters
        if (text.length > 200) {
          text = text.substring(0, 200);
        }
        
        return text;
      }
    }
    
    // For input elements with value
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      // Don't capture input values as element text (that's in the value field)
      // But we can capture placeholder if no other text
      const placeholder = element.placeholder;
      if (placeholder) {
        return placeholder.trim();
      }
    }

    return undefined;
  }
}
