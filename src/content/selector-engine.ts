/**
 * SelectorEngine - Generates robust, stable selectors for DOM elements
 */

import { ShadowDOMUtils, type ShadowPath } from './shadow-dom-utils';
import { ElementSimilarity } from './element-similarity';

export interface SelectorResult {
  primary: string;
  fallbacks: string[];
  xpath: string;
  shadowPath?: ShadowPath[];
  anchorText?: string; // Widget title/header text used for anchor selector
}

export interface ContainerContext {
  text?: string;
  type?: string;
  selector?: string;
}

export class SelectorEngine {
  /**
   * Check if an ID is unsafe (dynamic/generated)
   * IDs matching patterns like /[0-9]{3,}/ or /-[a-z0-9]{5,}$/ are considered unsafe
   */
  static isUnsafeId(id: string): boolean {
    if (!id) return true;
    
    // Check for long numeric IDs (e.g., "12345", "987654")
    if (/^[0-9]{3,}$/.test(id)) {
      return true;
    }
    
    // Check for random hash suffixes (e.g., "button-abc123", "item-xyz789")
    if (/-[a-z0-9]{5,}$/i.test(id)) {
      return true;
    }
    
    // Check for single letter + number patterns (Gridster, etc.)
    // Matches: w5, w3, w10, i1, i2, etc. (common in grid layout libraries)
    if (/^[a-z][0-9]+$/i.test(id)) {
      return true;
    }
    
    return false;
  }

  /**
   * Generate XPath for an element
   */
  static generateXPath(element: Element): string {
    if (element.id && !this.isUnsafeId(element.id)) {
      return `//*[@id="${CSS.escape(element.id)}"]`;
    }

    const parts: string[] = [];
    let current: Element | null = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let tagName = current.tagName.toLowerCase();
      let index = 1;

      // Count preceding siblings with the same tag name
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName.toLowerCase() === tagName) {
          index++;
        }
        sibling = sibling.previousElementSibling;
      }

      // Build XPath segment
      const xpathSegment = index > 1 ? `${tagName}[${index}]` : tagName;
      parts.unshift(xpathSegment);

      current = current.parentElement;
      
      // Stop at document body to ensure we always have /html/body prefix
      if (current && current.tagName === 'BODY') {
        parts.unshift('body');
        parts.unshift('html');
        break;
      }
    }

    // Ensure XPath always starts from root
    if (parts.length > 0 && parts[0] !== 'html') {
      parts.unshift('body');
      parts.unshift('html');
    }

    return '/' + parts.join('/');
  }

  /**
   * Find similar elements on the page
   */
  static findSimilarElements(element: Element): Element[] {
    return ElementSimilarity.findSimilarElements(element);
  }

  /**
   * Generate disambiguation selectors when similar elements exist
   */
  static generateDisambiguationSelectors(
    element: Element,
    similarElements: Element[]
  ): string[] {
    const disambiguation: string[] = [];

    if (similarElements.length === 0) return disambiguation;

    // Get unique attributes
    const uniqueAttrs = ElementSimilarity.getDisambiguationAttributes(element, similarElements);
    for (const [attr, value] of Object.entries(uniqueAttrs)) {
      if (attr === 'id') {
        disambiguation.push(`#${CSS.escape(value)}`);
      } else {
        disambiguation.push(`[${attr}="${CSS.escape(value)}"]`);
      }
    }

    // Generate parent-scoped selectors (skip disambiguation to avoid infinite recursion)
    const parent = element.parentElement;
    if (parent) {
      // Use a simple selector generation that doesn't recurse into disambiguation
      const parentSelector = this.generateSelectorsSimple(parent);
      const elementSelector = this.generateSelectorsSimple(element);
      disambiguation.push(`${parentSelector} > ${elementSelector}`);
    }

    return disambiguation;
  }

  /**
   * Generate a simple selector without disambiguation (to avoid infinite recursion)
   */
  private static generateSelectorsSimple(element: Element): string {
    // Try ID first
    if (element.id && !this.isUnsafeId(element.id)) {
      return `#${CSS.escape(element.id)}`;
    }

    // Try data-testid
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-cy');
    if (testId) {
      const attr = element.hasAttribute('data-testid') ? 'data-testid' : 'data-cy';
      return `[${attr}="${CSS.escape(testId)}"]`;
    }

    // Try aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      return `[aria-label="${CSS.escape(ariaLabel)}"]`;
    }

    // Fallback to CSS path
    return this.generateCssPath(element) || this.generateXPath(element);
  }

  /**
   * Generate parent-scoped selector
   */
  static generateParentScopedSelector(element: Element, parentSelector: string): string {
    // Use simple selector to avoid recursion when generating parent-scoped selectors
    const elementSelector = this.generateSelectorsSimple(element);
    return `${parentSelector} > ${elementSelector}`;
  }

  /**
   * Find parent container matching patterns
   */
  static findParentContainer(element: Element, containerPatterns: string[]): Element | null {
    let current: Element | null = element.parentElement;

    while (current) {
      for (const pattern of containerPatterns) {
        if (this.matchesContainerPattern(current, pattern)) {
          return current;
        }
      }
      current = current.parentElement;
    }

    return null;
  }

  /**
   * Check if element matches container pattern
   */
  private static matchesContainerPattern(element: Element, pattern: string): boolean {
    // Exact tag match
    if (pattern === element.tagName.toLowerCase()) {
      return true;
    }

    // ID contains pattern
    if (element.id && element.id.includes(pattern)) {
      return true;
    }

    // Class contains pattern
    if (element.className && typeof element.className === 'string') {
      if (element.className.includes(pattern)) {
        return true;
      }
    }

    // Attribute selector pattern
    if (pattern.startsWith('[')) {
      const match = pattern.match(/\[([^\]]+)\]/)?.[1];
      if (match) {
        if (match.includes('*=')) {
          const [attr, value] = match.split('*=').map(s => s.replace(/["']/g, ''));
          const attrValue = element.getAttribute(attr);
          if (attrValue && attrValue.includes(value)) {
            return true;
          }
        } else {
          const attr = match.replace(/["']/g, '');
          if (element.hasAttribute(attr)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Find anchor container by checking the element itself, then traversing up the DOM tree
   * Looks for elements with classes: gridster-item, card, widget, or panel
   * Also looks for parent containers that have text content (broader search)
   * Maximum 15 levels up from the element
   */
  private static findAnchorContainer(element: Element): Element | null {
    const containerClasses = ['gridster-item', 'card', 'widget', 'panel'];
    
    // Helper function to check if an element is a container
    const isContainer = (el: Element): boolean => {
      // Check tag name first (faster)
      const tagName = el.tagName.toLowerCase();
      if (tagName === 'gridster-item' || tagName.includes('widget') || tagName.includes('card') || tagName.includes('panel')) {
        return true;
      }

      // Check classList
      if (el.classList && el.classList.length > 0) {
        for (const containerClass of containerClasses) {
          if (el.classList.contains(containerClass)) {
            return true;
          }
        }
      }

      // Also check className as string (for SVG elements or edge cases)
      const className = el.className;
      if (className) {
        const classNameStr = typeof className === 'string' ? className : (className as any)?.toString() || '';
        if (classNameStr) {
          const classNames = classNameStr.split(/\s+/);
          for (const containerClass of containerClasses) {
            if (classNames.includes(containerClass)) {
              return true;
            }
          }
          // Also check if any class contains the container class name
          for (const containerClass of containerClasses) {
            if (classNameStr.includes(containerClass)) {
              return true;
            }
          }
        }
      }
      
      return false;
    };

    // Helper function to check if element has meaningful text content
    const hasTextContent = (el: Element): boolean => {
      const text = el.textContent?.trim() || '';
      // Check if text is meaningful (not just whitespace, numbers, or very short)
      if (text.length < 3) return false;
      // Skip if it's just numbers
      if (/^\d+$/.test(text)) return false;
      // Skip if it's mostly special characters or whitespace
      const meaningfulChars = text.replace(/[\s\n\r\t]/g, '').length;
      return meaningfulChars >= 3;
    };

    // NEVER use the clicked element as its own container - always find a parent
    // This prevents selectors like //gs-report-widget-element[...]//gs-report-widget-element
    // We always want a parent container (gridster-item, div, etc.)
    // Always start from parent, never check the element itself

    // Traverse up the DOM tree (increased maxLevels to 15 for broader search)
    let current: Element | null = element.parentElement;
    let level = 0;
    const maxLevels = 15; // Increased to find higher-level containers with text
    let bestContainer: Element | null = null;
    let bestContainerHasText = false;
    let bestParentWithText: Element | null = null; // Parent div/section with text

    while (current && level < maxLevels && current !== document.body && current !== document.documentElement) {
      const isCurrentContainer = isContainer(current);
      const currentHasText = hasTextContent(current);
      
      // PRIORITY 1: Look for parent divs/sections that have text (broader container search)
      // This catches cases where text is in a parent div, not the gridster-item itself
      // This is the "smoking gun" - the div that contains "How To Guide"
      if (!isCurrentContainer && currentHasText) {
        const tagName = current.tagName.toLowerCase();
        // Look for common container-like tags that might have widget titles
        if (['div', 'section', 'article', 'main', 'aside'].includes(tagName)) {
          // Check if this element contains a gridster-item (it's a parent container)
          const hasGridsterChild = current.querySelector('gridster-item, [class*="gridster"], [class*="widget"]');
          if (hasGridsterChild) {
            // This is a parent container with text that contains widgets
            // This is what we want! Use it as the anchor container
            bestParentWithText = current;
          }
        }
      }
      
      // PRIORITY 2: If we find a container, check if it has text
      if (isCurrentContainer) {
        // Prefer containers with text content
        if (currentHasText) {
          // Found container with text - but check if we have a better parent with text
          if (bestParentWithText) {
            // Parent with text is better - use it instead
            return bestParentWithText;
          }
          return current; // Found container with text - use it immediately
        }
        // Remember this container but keep looking for one with text
        if (!bestContainer || !bestContainerHasText) {
          bestContainer = current;
          bestContainerHasText = false;
        }
      }

      current = current.parentElement;
      level++;
    }

    // Return priority: parent with text > container with text > container without text
    if (bestParentWithText) {
      return bestParentWithText;
    }
    
    // Return the best container we found (even if it doesn't have text, we'll try to extract from it)
    return bestContainer;
  }

  /**
   * Extract header text from a container element
   * Aggressively searches for widget title using multiple strategies
   * Also searches inside widget elements (gs-report-widget-element, etc.) and siblings
   * Also searches in parent containers that might have the title
   */
  private static extractHeaderText(container: Element): string | null {
    // First, try to find title in the container itself
    const containerTitle = this.extractHeaderTextFromElement(container);
    if (containerTitle) {
      return containerTitle;
    }

    // If container is gridster-item or doesn't have text, look in parent containers
    const tagName = container.tagName.toLowerCase();
    if (tagName === 'gridster-item' || tagName.includes('gridster') || !container.textContent?.trim()) {
      // Look in parent elements for text (broader search)
      let parent = container.parentElement;
      let parentLevel = 0;
      const maxParentLevels = 5;
      
      while (parent && parentLevel < maxParentLevels && parent !== document.body) {
        const parentTitle = this.extractHeaderTextFromElement(parent);
        if (parentTitle) {
          // Found text in parent - use it
          console.log('GhostWriter: Found title in parent container:', parentTitle);
          return parentTitle;
        }
        parent = parent.parentElement;
        parentLevel++;
      }
    }

    // If container is gridster-item, look inside widget elements
    if (tagName === 'gridster-item' || tagName.includes('gridster')) {
      // Look inside gs-report-widget-element, gs-widget-element, etc.
      const widgetSelectors = [
        'gs-report-widget-element',
        'gs-widget-element',
        'gs-widget',
        '[class*="widget"]',
        'ng-component',
      ];

      for (const selector of widgetSelectors) {
        try {
          const widgetEl = container.querySelector(selector);
          if (widgetEl) {
            const widgetTitle = this.extractHeaderTextFromElement(widgetEl);
            if (widgetTitle) {
              return widgetTitle;
            }
          }
        } catch (e) {
          // Invalid selector, skip
          continue;
        }
      }

      // Look at previous sibling (title might be before the widget)
      let sibling = container.previousElementSibling;
      let siblingCount = 0;
      while (sibling && siblingCount < 3) {
        const siblingTitle = this.extractHeaderTextFromElement(sibling);
        if (siblingTitle) {
          return siblingTitle;
        }
        sibling = sibling.previousElementSibling;
        siblingCount++;
      }

      // Look at parent's first child (title might be at parent level)
      const parent = container.parentElement;
      if (parent) {
        const firstChild = parent.firstElementChild;
        if (firstChild && firstChild !== container) {
          const firstChildTitle = this.extractHeaderTextFromElement(firstChild);
          if (firstChildTitle) {
            return firstChildTitle;
          }
        }
      }
    }

    // Try to extract from class name (e.g., "Report" from "widget_container.Report")
    const className = container.className?.toString() || '';
    if (className) {
      // Split by dots, spaces, underscores, hyphens
      const parts = className.split(/[.\s_-]+/);
      
      // Look for capitalized words that could be widget names
      // Accept words that start with capital letter and are meaningful
      const classWords = parts.filter(w => {
        if (w.length < 2) return false;
        // Accept words that start with capital letter
        if (/^[A-Z]/.test(w)) {
          // Exclude common Angular/UI words, but allow "Report" if it's standalone
          const excluded = ['Widget', 'Container', 'Item', 'Star', 'Inserted', 'Ng', 'Gs', 'App', 'Module', 'Viewer', 'Renderer'];
          return !excluded.includes(w);
        }
        return false;
      });
      
      if (classWords.length > 0) {
        // Use the first meaningful capitalized word (including "Report" if it's the only one)
        const potentialTitle = classWords[0];
        if (potentialTitle.length > 2 && potentialTitle.length < 50) {
          console.log('GhostWriter: Using class name as title fallback:', potentialTitle);
          return potentialTitle;
        }
      }
      
      // Special case: If we have "widget_container.Report", use "Report" as fallback
      if (className.includes('Report') && !className.includes('report-widget-element')) {
        // Check if "Report" appears as a standalone word (not part of "report-widget-element")
        const hasReport = parts.some(p => p === 'Report');
        if (hasReport) {
          console.log('GhostWriter: Using "Report" from class name as title fallback');
          return 'Report';
        }
      }
    }

    return null;
  }

  /**
   * Extract header text from a single element using multiple strategies
   */
  private static extractHeaderTextFromElement(element: Element): string | null {
    // Strategy 1: Standard header tags (h1-h6)
    for (let i = 1; i <= 6; i++) {
      const header = element.querySelector(`h${i}`);
      if (header) {
        const text = header.textContent?.trim();
        if (text && text.length > 0 && text.length < 200) {
          return text;
        }
      }
    }

    // Strategy 2: Common title class selectors
    const titleSelectors = [
      '.title',
      '.card-title',
      '.gs-widget-title',
      '.widget-title',
      '.header-title',
      '[class*="title"]',
      '[class*="header"]',
      '.gs-title',
      '.report-title',
    ];
    
    for (const selector of titleSelectors) {
      try {
        const titleEl = element.querySelector(selector);
        if (titleEl) {
          const text = titleEl.textContent?.trim();
          if (text && text.length > 0 && text.length < 200) {
            return text;
          }
        }
      } catch (e) {
        // Invalid selector, skip
        continue;
      }
    }

    // Strategy 3: Look for elements with role="heading"
    const headingEl = element.querySelector('[role="heading"]');
    if (headingEl) {
      const text = headingEl.textContent?.trim();
      if (text && text.length > 0 && text.length < 200) {
        return text;
      }
    }

    // Strategy 4: Check aria-label on element
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim().length > 0 && ariaLabel.trim().length < 200) {
      return ariaLabel.trim();
    }

    // Strategy 5: Check title attribute
    const titleAttr = element.getAttribute('title');
    if (titleAttr && titleAttr.trim().length > 0 && titleAttr.trim().length < 200) {
      return titleAttr.trim();
    }

    // Strategy 6: Look for first visible text node in element
    // This handles cases where title is in a span or div without specific classes
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip if parent is script, style, or hidden
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          
          const tagName = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript'].includes(tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          
          // Check if parent is visible
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return NodeFilter.FILTER_REJECT;
          }
          
          const text = node.textContent?.trim();
          if (text && text.length > 3 && text.length < 200) {
            // Skip if it's just numbers or very short
            if (!/^\d+$/.test(text) && text.length > 3) {
              return NodeFilter.FILTER_ACCEPT;
            }
          }
          
          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    let node: Node | null;
    const texts: string[] = [];
    while ((node = walker.nextNode()) && texts.length < 5) {
      const text = node.textContent?.trim();
      if (text && text.length > 3 && text.length < 200) {
        texts.push(text);
      }
    }

    // Return first meaningful text found
    if (texts.length > 0) {
      // Prefer longer text (likely to be title)
      const sorted = texts.sort((a, b) => b.length - a.length);
      return sorted[0];
    }

    // Strategy 7: Look at first few direct children for text
    const children = Array.from(element.children).slice(0, 10);
    for (const child of children) {
      // Skip interactive elements (buttons, inputs)
      const tagName = child.tagName.toLowerCase();
      if (['button', 'input', 'select', 'textarea', 'a'].includes(tagName)) {
        continue;
      }
      
      const text = child.textContent?.trim();
      if (text && text.length > 3 && text.length < 200) {
        // Skip if it's just numbers
        if (!/^\d+$/.test(text)) {
          // Take first line if multi-line
          const firstLine = text.split('\n')[0]?.trim();
          if (firstLine && firstLine.length > 3) {
            return firstLine.substring(0, 100);
          }
        }
      }
    }

    // Strategy 8: Use element's own textContent (first meaningful portion)
    const elementText = element.textContent?.trim();
    if (elementText && elementText.length > 3) {
      // Split by newlines and take first non-empty line
      const lines = elementText.split(/\n+/).map(l => l.trim()).filter(l => l.length > 3);
      if (lines.length > 0) {
        const firstLine = lines[0];
        if (firstLine.length < 200) {
          return firstLine.substring(0, 100);
        }
      }
    }

    return null;
  }

  /**
   * Generate anchor-based composite selector using container and header text
   * Uses normalize-space(.) for robust text matching (handles nested elements and whitespace)
   * Example: //gridster-item[descendant::*[contains(normalize-space(.), "Revenue Report")]]//gs-report-widget-element
   */
  private static generateAnchorSelector(
    element: Element,
    container: Element,
    headerText: string
  ): string {
    // Get the container tag name (e.g., gridster-item, div)
    const containerTag = container.tagName.toLowerCase();
    
    // Get the element tag name (e.g., gs-report-widget-element)
    const elementTag = element.tagName.toLowerCase();
    
    // Safety check: Container should never be the same as element
    // If it is, something went wrong - use a fallback
    if (containerTag === elementTag) {
      console.warn('GhostWriter: ⚠️ Container is same as element, using parent container instead');
      // Try to find a better container (parent of container)
      const parentContainer = container.parentElement;
      if (parentContainer && parentContainer !== document.body) {
        const parentTag = parentContainer.tagName.toLowerCase();
        // Use parent if it's a valid container type
        if (['div', 'section', 'article', 'main', 'gridster-item'].includes(parentTag)) {
          const escapedText = headerText
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');
          return `//${parentTag}[descendant::*[contains(normalize-space(.), "${escapedText}")]]//${elementTag}`;
        }
      }
      // Fallback: use div as container (most common)
      const escapedText = headerText
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
      return `//div[descendant::*[contains(normalize-space(.), "${escapedText}")]]//${elementTag}`;
    }
    
    // Escape the header text for XPath (handle quotes and backslashes)
    const escapedText = headerText
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    
    // Generate container-scoped XPath using normalize-space(.) for robust text matching
    // normalize-space(.) handles nested elements (e.g., <h3><span>Revenue</span></h3>)
    // and normalizes whitespace (newlines, multiple spaces, etc.)
    const anchorXPath = `//${containerTag}[descendant::*[contains(normalize-space(.), "${escapedText}")]]//${elementTag}`;
    
    return anchorXPath;
  }

  /**
   * Generate container-scoped text-based XPath selector
   * Example: //gridster-item[descendant::div[contains(text(), "Renewals Report")]]//gs-report-widget-element
   */
  private static generateContainerTextXPath(
    element: Element,
    containerText: string,
    containerType?: string
  ): string {
    // Find the container element that contains this text
    let container: Element | null = element.parentElement;
    let containerTag = 'div'; // Default container tag
    
    // Try to find the actual container element
    while (container && container !== document.body) {
      const text = container.textContent?.trim() || '';
      if (text.includes(containerText)) {
        containerTag = container.tagName.toLowerCase();
        break;
      }
      container = container.parentElement;
    }
    
    // If we have a container type hint, use it
    if (containerType === 'widget' && container) {
      // Look for widget container tags
      const widgetTags = ['gridster-item', 'widget', 'gs-widget', 'dashboard-widget'];
      let current: Element | null = element.parentElement;
      while (current && current !== document.body) {
        const tag = current.tagName.toLowerCase();
        if (widgetTags.some(wt => tag.includes(wt))) {
          containerTag = tag;
          container = current;
          break;
        }
        current = current.parentElement;
      }
    }
    
    // Get the element tag
    const elementTag = element.tagName.toLowerCase();
    
    // Escape the container text for XPath (escape quotes and backslashes)
    const escapedText = containerText
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    
    // Generate container-scoped XPath
    // Format: //container-tag[descendant::*[contains(text(), "text")]]//element-tag
    // This finds the container by its text content, then finds the element within it
    const containerXPath = `//${containerTag}[descendant::*[contains(text(), "${escapedText}")]]//${elementTag}`;
    
    return containerXPath;
  }

  /**
   * Generate prioritized selectors for an element
   * Priority: Safe ID > Test attributes > Semantic attributes > Text content > Container-scoped text > Anchor Strategy > CSS path
   */
  static generateSelectors(
    element: Element,
    containerContext?: ContainerContext
  ): SelectorResult {
    const selectors: string[] = [];
    const fallbacks: string[] = [];
    let xpath = this.generateXPath(element);

    // Check for Shadow DOM
    const shadowPath = ShadowDOMUtils.isInShadowDOM(element)
      ? ShadowDOMUtils.getShadowPath(element)
      : undefined;

    // Find similar elements
    const similarElements = this.findSimilarElements(element);
    
    // If similar elements exist, generate disambiguation selectors
    if (similarElements.length > 0) {
      const disambiguation = this.generateDisambiguationSelectors(element, similarElements);
      fallbacks.push(...disambiguation);
    }

    // Priority 1: Safe ID selector
    if (element.id && !this.isUnsafeId(element.id)) {
      selectors.push(`#${CSS.escape(element.id)}`);
    } else if (element.id) {
      // Unsafe ID goes to fallbacks
      fallbacks.push(`#${CSS.escape(element.id)}`);
    }

    // Priority 2: Test attributes (data-testid, data-cy)
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-cy');
    if (testId) {
      const attr = element.hasAttribute('data-testid') ? 'data-testid' : 'data-cy';
      const selector = `[${attr}="${CSS.escape(testId)}"]`;
      if (selectors.length === 0) {
        selectors.push(selector);
      } else {
        fallbacks.push(selector);
      }
    }

    // Priority 3: Semantic attributes (aria-label, name, placeholder)
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      const selector = `[aria-label="${CSS.escape(ariaLabel)}"]`;
      if (selectors.length === 0) {
        selectors.push(selector);
      } else {
        fallbacks.push(selector);
      }
    }

    const name = (element as HTMLInputElement).name;
    if (name) {
      const selector = `[name="${CSS.escape(name)}"]`;
      if (selectors.length === 0) {
        selectors.push(selector);
      } else {
        fallbacks.push(selector);
      }
    }

    const placeholder = (element as HTMLInputElement).placeholder;
    if (placeholder) {
      const selector = `[placeholder="${CSS.escape(placeholder)}"]`;
      if (selectors.length === 0) {
        selectors.push(selector);
      } else {
        fallbacks.push(selector);
      }
    }

    // Priority 4: Text content (for buttons and clickable elements)
    const textContent = element.textContent?.trim();
    if (textContent && textContent.length > 0 && textContent.length < 100) {
      // Only use text content for interactive elements
      const tagName = element.tagName.toLowerCase();
      if (['button', 'a', 'label', 'span', 'div'].includes(tagName)) {
        // Use XPath for text matching
        const textXpath = `${xpath}[contains(text(), "${textContent.substring(0, 50)}")]`;
        if (selectors.length === 0) {
          // For buttons, text content is very stable
          if (tagName === 'button') {
            selectors.push(textXpath);
          } else {
            fallbacks.push(textXpath);
          }
        } else {
          fallbacks.push(textXpath);
        }
      }
    }

    // Priority 4.5: Container-scoped text-based selector (high priority fallback)
    // This is more stable than position-based selectors like :nth-of-type()
    if (containerContext?.text && containerContext.text.length > 0 && containerContext.text.length < 200) {
      try {
        const containerTextXPath = this.generateContainerTextXPath(
          element,
          containerContext.text,
          containerContext.type
        );
        // Add as high-priority fallback (before CSS path)
        fallbacks.push(containerTextXPath);
      } catch (error) {
        console.warn('GhostWriter: Error generating container text XPath:', error);
      }
    }

    // Priority 4.6: Anchor Strategy (find container, extract header text, generate composite selector)
    // This should be PRIMARY if found, as it's more stable than position-based selectors
    // Run this BEFORE CSS path generation so we can prefer it over brittle selectors
    let anchorSelector: string | null = null;
    let anchorHeaderText: string | null = null;
    try {
      const anchorContainer = this.findAnchorContainer(element);
      if (anchorContainer) {
        const headerText = this.extractHeaderText(anchorContainer);
        if (headerText) {
          anchorHeaderText = headerText;
          anchorSelector = this.generateAnchorSelector(element, anchorContainer, headerText);
          console.log('GhostWriter: ✅ Anchor selector generated:', anchorSelector, 'Header text:', headerText);
        } else {
          // Only log for the actual clicked element (gs-report-widget-element) to reduce noise
          const elementTag = element.tagName.toLowerCase();
          const isClickableElement = elementTag === 'gs-report-widget-element' || 
                                     elementTag === 'gs-widget-element' ||
                                     elementTag.includes('widget-element');
          
          if (isClickableElement) {
            console.warn('GhostWriter: ⚠️ Anchor container found but no header text extracted. Container:', anchorContainer.tagName, 'Classes:', anchorContainer.className);
            // Debug: log container structure only for clicked elements
            console.log('GhostWriter: Container HTML (first 500 chars):', anchorContainer.innerHTML?.substring(0, 500));
          }
        }
      } else {
        // Only log for the actual clicked element (gs-report-widget-element) to reduce noise
        // Skip logging for intermediate elements in context generation
        const tagName = element.tagName.toLowerCase();
        const isClickableElement = tagName === 'gs-report-widget-element' || 
                                   tagName === 'gs-widget-element' ||
                                   tagName.includes('widget-element');
        
        if (isClickableElement) {
          console.warn('GhostWriter: ⚠️ No anchor container found for clicked element:', element.tagName, 'Classes:', element.className);
          // Debug: log parent chain
          let parent = element.parentElement;
          let depth = 0;
          console.log('GhostWriter: Parent chain:');
          while (parent && depth < 5) {
            console.log(`  ${depth}: ${parent.tagName}`, parent.className);
            parent = parent.parentElement;
            depth++;
          }
        }
      }
    } catch (error) {
      console.warn('GhostWriter: Error generating anchor selector:', error);
    }

    // Priority 5: Full CSS path (fallback)
    // Only use as primary if no stable selectors exist (including anchor)
    const cssPath = this.generateCssPath(element);
    if (cssPath) {
      // Check if CSS path contains nth-of-type (brittle position-based selector)
      const isBrittle = cssPath.includes(':nth-of-type(') || cssPath.includes(':nth-child(');
      
      if (selectors.length === 0) {
        // If we have an anchor selector, ALWAYS prefer it over brittle CSS path
        if (anchorSelector) {
          selectors.push(anchorSelector);
          // Add CSS path to fallbacks (even if brittle, as last resort)
          fallbacks.push(cssPath);
        } else if (!isBrittle) {
          // Only use non-brittle CSS path as primary
          selectors.push(cssPath);
        } else {
          // Brittle CSS path with no anchor - still use it but log warning
          console.warn('GhostWriter: Using brittle CSS path as primary (no anchor found):', cssPath);
          selectors.push(cssPath);
        }
      } else {
        // We already have selectors, add CSS path to fallbacks
        // But ensure anchor selector is in fallbacks with highest priority
        if (anchorSelector && !fallbacks.includes(anchorSelector)) {
          fallbacks.unshift(anchorSelector);
        }
        fallbacks.push(cssPath);
      }
    } else if (anchorSelector && selectors.length === 0) {
      // No CSS path generated, but we have anchor selector - use it as primary
      selectors.push(anchorSelector);
    }

    // Ensure we have at least one selector
    if (selectors.length === 0) {
      // Prefer anchor selector over XPath if available
      if (anchorSelector) {
        selectors.push(anchorSelector);
      } else {
        selectors.push(xpath);
      }
    }

    // Force fallbacks: Ensure fallbacks array is never empty
    // Always include anchor selector as highest priority fallback if available
    if (anchorSelector && !fallbacks.includes(anchorSelector) && selectors[0] !== anchorSelector) {
      fallbacks.unshift(anchorSelector);
    }

    // If fallbacks is still empty, add CSS path or XPath
    if (fallbacks.length === 0) {
      // Generate a generic fallback path
      const genericPath = cssPath || xpath;
      if (genericPath && genericPath !== selectors[0]) {
        fallbacks.push(genericPath);
      } else if (!genericPath) {
        // Absolute last resort: use element tag
        const elementTag = element.tagName.toLowerCase();
        fallbacks.push(elementTag);
      }
    }

    // Remove duplicates while preserving order (anchor selector should be first)
    const uniqueFallbacks = [...new Set(fallbacks)];

    return {
      primary: selectors[0],
      fallbacks: uniqueFallbacks,
      xpath,
      shadowPath,
      anchorText: anchorHeaderText || undefined,
    };
  }

  /**
   * Generate shadow-aware selector
   */
  static generateShadowSelector(element: Element): string {
    const shadowPath = ShadowDOMUtils.getShadowPath(element);
    if (shadowPath.length === 0) {
      return this.generateSelectors(element).primary;
    }

    // Build selector through shadow boundaries
    const parts: string[] = [];
    for (const path of shadowPath) {
      parts.push(path.hostSelector);
      parts.push(path.path);
    }

    return parts.join(' > ');
  }

  /**
   * Generate full CSS path from root to element
   */
  private static generateCssPath(element: Element): string {
    const parts: string[] = [];
    let current: Element | null = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.tagName.toLowerCase();

      // Add ID if safe
      if (current.id && !this.isUnsafeId(current.id)) {
        selector += `#${CSS.escape(current.id)}`;
        parts.unshift(selector);
        break; // ID is unique, we can stop here
      }

      // Add class if present
      if (current.className && typeof current.className === 'string') {
        const classes = current.className
          .split(/\s+/)
          .filter((c) => c.length > 0)
          .map((c) => `.${CSS.escape(c)}`)
          .join('');
        if (classes) {
          selector += classes;
        }
      }

      // Count preceding siblings with same selector
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.matches && sibling.matches(selector)) {
          index++;
        }
        sibling = sibling.previousElementSibling;
      }

      if (index > 1) {
        selector += `:nth-of-type(${index})`;
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    return parts.join(' > ');
  }
}

