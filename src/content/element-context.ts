/**
 * ElementContext - Captures contextual information about elements for better identification
 */

import { SelectorEngine } from './selector-engine';
import { ElementSimilarity } from './element-similarity';

export interface ElementContextData {
  siblings: {
    before: string[];
    after: string[];
  };
  parent: {
    selector: string;
    text?: string;
    attributes?: Record<string, string>;
    index?: number;
  } | null;
  ancestors: Array<{
    selector: string;
    text?: string;
    role?: string;
  }>;
  container: {
    selector: string;
    text?: string;
    type?: string;
    index?: number;
  } | null;
  position: {
    index: number;
    total: number;
    type: string;
  };
  surroundingText?: string;
  uniqueAttributes: Record<string, string>;
  formContext?: {
    formId?: string;
    fieldset?: string;
    section?: string;
  };
}

export interface ContainerContext {
  selector: string;
  text?: string;
  type?: string;
  index?: number;
}

export class ElementContext {
  /**
   * Capture full context for an element
   */
  static captureContext(element: Element): ElementContextData {
    const similarElements = ElementSimilarity.findSimilarElements(element);
    const uniqueAttributes = ElementSimilarity.getDisambiguationAttributes(element, similarElements);

    return {
      siblings: this.captureSiblingContext(element),
      parent: this.captureParentContext(element),
      ancestors: this.captureAncestorHierarchy(element, 3),
      container: this.captureContainerContext(element),
      position: this.capturePosition(element, similarElements),
      surroundingText: this.captureSurroundingText(element),
      uniqueAttributes,
      formContext: this.captureFormContext(element),
    };
  }

  /**
   * Capture sibling context (before and after)
   */
  private static captureSiblingContext(element: Element): {
    before: string[];
    after: string[];
  } {
    const before: string[] = [];
    const after: string[] = [];

    // Get preceding siblings (up to 3)
    let sibling = element.previousElementSibling;
    let count = 0;
    while (sibling && count < 3) {
      const text = sibling.textContent?.trim();
      if (text && text.length > 0 && text.length < 100) {
        before.unshift(text);
      }
      sibling = sibling.previousElementSibling;
      count++;
    }

    // Get following siblings (up to 3)
    sibling = element.nextElementSibling;
    count = 0;
    while (sibling && count < 3) {
      const text = sibling.textContent?.trim();
      if (text && text.length > 0 && text.length < 100) {
        after.push(text);
      }
      sibling = sibling.nextElementSibling;
      count++;
    }

    return { before, after };
  }

  /**
   * Capture parent context
   */
  private static captureParentContext(element: Element): {
    selector: string;
    text?: string;
    attributes?: Record<string, string>;
    index?: number;
  } | null {
    const parent = element.parentElement;
    if (!parent) return null;

    const selector = SelectorEngine.generateSelectors(parent).primary;
    const text = parent.textContent?.trim();
    const attributes: Record<string, string> = {};

    // Capture important attributes
    if (parent.id) attributes.id = parent.id;
    const className = parent.className;
    if (className && typeof className === 'string' && className.length < 100) {
      attributes.class = className;
    }

    // Find index among similar parents
    const similarParents = this.findSimilarParents(parent);
    const index = similarParents.indexOf(parent) + 1;

    return {
      selector,
      text: text && text.length < 200 ? text : undefined,
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
      index: similarParents.length > 1 ? index : undefined,
    };
  }

  /**
   * Find similar parent elements
   */
  private static findSimilarParents(parent: Element): Element[] {
    const similar: Element[] = [];
    const parentTag = parent.tagName.toLowerCase();
    const parentClasses = parent.className && typeof parent.className === 'string'
      ? parent.className.split(/\s+/)
      : [];

    const allParents = document.querySelectorAll(parentTag);
    for (const p of allParents) {
      if (p === parent) {
        similar.push(p);
        continue;
      }

      const pClasses = p.className && typeof p.className === 'string'
        ? p.className.split(/\s+/)
        : [];

      // Check if classes overlap
      const commonClasses = parentClasses.filter(c => pClasses.includes(c));
      if (commonClasses.length > 0) {
        similar.push(p);
      }
    }

    return similar;
  }

  /**
   * Capture ancestor hierarchy
   */
  private static captureAncestorHierarchy(
    element: Element,
    maxDepth: number
  ): Array<{ selector: string; text?: string; role?: string }> {
    const ancestors: Array<{ selector: string; text?: string; role?: string }> = [];
    let current: Element | null = element.parentElement;
    let depth = 0;

    while (current && depth < maxDepth) {
      const selector = SelectorEngine.generateSelectors(current).primary;
      const text = current.textContent?.trim();
      const role = current.getAttribute('role');

      ancestors.push({
        selector,
        text: text && text.length < 200 ? text : undefined,
        role: role || undefined,
      });

      current = current.parentElement;
      depth++;
    }

    return ancestors;
  }

  /**
   * Capture container context (dashboard, widget, etc.)
   */
  static captureContainerContext(element: Element): ContainerContext | null {
    const container = this.findParentContainer(element, [
      'gridster-item',
      'dashboard',
      'widget',
      'gs-report-widget-element',
      'gs-dashboard-viewer',
      '[class*="dashboard"]',
      '[class*="widget"]',
      '[id*="dashboard"]',
      '[id*="widget"]',
    ]);

    if (!container) return null;

    const selector = SelectorEngine.generateSelectors(container).primary;
    const text = this.getContainerText(container);
    const type = this.getContainerType(container);
    const index = this.getContainerIndex(container);

    return {
      selector,
      text,
      type,
      index,
    };
  }

  /**
   * Find parent container matching patterns
   */
  static findParentContainer(
    element: Element,
    containerPatterns: string[]
  ): Element | null {
    let current: Element | null = element;

    while (current) {
      // Check if current element matches any pattern
      for (const pattern of containerPatterns) {
        if (this.matchesPattern(current, pattern)) {
          return current;
        }
      }

      current = current.parentElement;
    }

    return null;
  }

  /**
   * Check if element matches a pattern
   */
  private static matchesPattern(element: Element, pattern: string): boolean {
    // Exact tag match
    if (pattern === element.tagName.toLowerCase()) {
      return true;
    }

    // ID contains pattern
    if (pattern.startsWith('[id*=') && element.id) {
      const idPattern = pattern.match(/\[id\*="([^"]+)"/)?.[1];
      if (idPattern && element.id.includes(idPattern)) {
        return true;
      }
    }

    // Class contains pattern
    if (pattern.startsWith('[class*=') && element.className) {
      const classPattern = pattern.match(/\[class\*="([^"]+)"/)?.[1];
      if (classPattern && typeof element.className === 'string') {
        if (element.className.includes(classPattern)) {
          return true;
        }
      }
    }

    // Check class name directly
    if (typeof element.className === 'string') {
      const classes = element.className.split(/\s+/);
      if (classes.some(c => c.includes(pattern))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get container text (title, label, etc.)
   */
  private static getContainerText(container: Element): string | undefined {
    // Look for common title/label selectors
    const titleSelectors = [
      'h1', 'h2', 'h3', 'h4',
      '[class*="title"]',
      '[class*="header"]',
      '[class*="label"]',
      'title',
      'aria-label',
    ];

    for (const selector of titleSelectors) {
      if (selector.startsWith('[')) {
        const attr = selector.match(/\[([^\]]+)\]/)?.[1];
        if (attr && container.hasAttribute(attr)) {
          return container.getAttribute(attr) || undefined;
        }
      } else {
        const titleEl = container.querySelector(selector);
        if (titleEl) {
          const text = titleEl.textContent?.trim();
          if (text && text.length < 200) {
            return text;
          }
        }
      }
    }

    // Fallback to container's own text (first 200 chars)
    const text = container.textContent?.trim();
    return text && text.length < 200 ? text : undefined;
  }

  /**
   * Get container type
   */
  private static getContainerType(container: Element): string | undefined {
    const tagName = container.tagName.toLowerCase();
    const className = container.className;
    const id = container.id;

    if (tagName.includes('dashboard') || className?.toString().includes('dashboard')) {
      return 'dashboard';
    }
    if (tagName.includes('widget') || className?.toString().includes('widget')) {
      return 'widget';
    }
    if (tagName.includes('table') || className?.toString().includes('table')) {
      return 'table';
    }
    if (id?.includes('dashboard')) return 'dashboard';
    if (id?.includes('widget')) return 'widget';

    return undefined;
  }

  /**
   * Get container index (which dashboard/widget on page)
   */
  private static getContainerIndex(container: Element): number | undefined {
    const tagName = container.tagName.toLowerCase();
    const similarContainers = Array.from(document.querySelectorAll(tagName)).filter(
      el => {
        // Check if similar (same tag and similar classes)
        const elClasses = el.className?.toString() || '';
        const containerClasses = container.className?.toString() || '';
        return elClasses && containerClasses && 
               elClasses.split(/\s+/).some(c => containerClasses.includes(c));
      }
    );

    if (similarContainers.length <= 1) return undefined;

    return similarContainers.indexOf(container) + 1;
  }

  /**
   * Capture position among similar elements
   */
  private static capturePosition(
    element: Element,
    similarElements: Element[]
  ): { index: number; total: number; type: string } {
    const total = similarElements.length + 1; // +1 for the element itself
    const allSimilar = [element, ...similarElements];
    
    // Sort by DOM position
    allSimilar.sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    const index = allSimilar.indexOf(element) + 1;
    const type = this.getElementType(element);

    return { index, total, type };
  }

  /**
   * Get element type for position
   */
  private static getElementType(element: Element): string {
    const tagName = element.tagName.toLowerCase();
    const role = element.getAttribute('role');
    
    if (role) return role;
    if (tagName === 'button') return 'button';
    if (tagName === 'a') return 'link';
    if (tagName === 'input') return 'input';
    if (tagName.includes('menu')) return 'menu';
    
    return tagName;
  }

  /**
   * Capture surrounding text (within 50px radius)
   */
  private static captureSurroundingText(element: Element): string | undefined {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = 50;

    // Find all text nodes within radius
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    const nearbyTexts: string[] = [];
    let node: Node | null;

    while ((node = walker.nextNode())) {
      if (node.parentElement) {
        const nodeRect = node.parentElement.getBoundingClientRect();
        const nodeX = nodeRect.left + nodeRect.width / 2;
        const nodeY = nodeRect.top + nodeRect.height / 2;

        const distance = Math.sqrt(
          Math.pow(nodeX - centerX, 2) + Math.pow(nodeY - centerY, 2)
        );

        if (distance <= radius && node.textContent) {
          const text = node.textContent.trim();
          if (text.length > 0 && text.length < 100) {
            nearbyTexts.push(text);
          }
        }
      }
    }

    return nearbyTexts.length > 0 ? nearbyTexts.join(' | ') : undefined;
  }

  /**
   * Capture form context
   */
  private static captureFormContext(element: Element): {
    formId?: string;
    fieldset?: string;
    section?: string;
  } | undefined {
    const form = element.closest('form');
    if (!form) return undefined;

    const formId = form.id || undefined;
    const fieldset = element.closest('fieldset');
    const fieldsetId = fieldset?.id || fieldset?.getAttribute('name') || undefined;
    
    // Look for section/div with role="region" or aria-label
    const section = element.closest('[role="region"], section, [class*="section"]');
    const sectionLabel = section?.getAttribute('aria-label') || 
                        section?.querySelector('h1, h2, h3, h4, h5, h6')?.textContent?.trim() ||
                        undefined;

    if (!formId && !fieldsetId && !sectionLabel) return undefined;

    return {
      formId,
      fieldset: fieldsetId,
      section: sectionLabel,
    };
  }
}

