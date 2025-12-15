/**
 * Element Signature Builder
 * 
 * Builds rich element signatures at record time that capture multiple
 * identification signals. Handles wrapper divs by climbing to semantic targets.
 */

import type {
  ElementSignature,
  IdentitySignals,
  TextSignals,
  StructuralSignals,
  VisualSignals,
  SelectorSignals,
  ClickTargetInfo,
  DOMPath,
  DOMPathStep,
} from '../../types/universal-types';

// ============================================================================
// Semantic Target Finding (Handles Wrapper Divs)
// ============================================================================

/**
 * Interactive ARIA roles that indicate an element is semantically interactive
 */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'tab', 'checkbox', 'radio', 'switch', 'combobox', 'listbox',
  'textbox', 'slider', 'spinbutton', 'searchbox', 'treeitem',
]);

/**
 * Native interactive element tags
 */
const INTERACTIVE_TAGS = new Set([
  'BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'DETAILS',
]);

/**
 * Check if an element is semantically interactive
 */
export function isSemanticInteractive(element: Element): boolean {
  // Native interactive elements
  if (INTERACTIVE_TAGS.has(element.tagName)) {
    return true;
  }

  // ARIA roles that indicate interactivity
  const role = element.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) {
    return true;
  }

  // Elements with tabindex (focusable)
  const tabIndex = element.getAttribute('tabindex');
  if (tabIndex !== null && parseInt(tabIndex, 10) >= 0) {
    return true;
  }

  // Elements with explicit click handlers (data attributes)
  if (element.hasAttribute('onclick') ||
      element.hasAttribute('data-clickable') ||
      element.hasAttribute('data-action') ||
      element.hasAttribute('data-testid')) {
    return true;
  }

  // Check for React event handlers (stored in element properties)
  if (hasReactClickHandler(element)) {
    return true;
  }

  return false;
}

/**
 * Check if element has React click handler
 */
function hasReactClickHandler(element: Element): boolean {
  // React 16+ stores handlers in fiber nodes
  const keys = Object.keys(element);
  for (const key of keys) {
    if (key.startsWith('__reactFiber') || key.startsWith('__reactProps')) {
      try {
        const props = (element as any)[key];
        if (props?.onClick || props?.onMouseDown || props?.onPointerDown) {
          return true;
        }
        // Check memoizedProps for handlers
        if (props?.memoizedProps?.onClick) {
          return true;
        }
      } catch {
        // Ignore errors accessing React internals
      }
    }
  }
  return false;
}

/**
 * Find the semantic target by climbing from clicked element to nearest
 * interactive ancestor. Handles wrapper divs.
 */
export function findSemanticTarget(clickedElement: Element): {
  semanticTarget: Element;
  clickedDescendant: Element;
  depth: number;
} {
  let current: Element | null = clickedElement;
  let depth = 0;

  while (current && current !== document.body) {
    if (isSemanticInteractive(current)) {
      return {
        semanticTarget: current,
        clickedDescendant: clickedElement,
        depth,
      };
    }
    current = current.parentElement;
    depth++;
  }

  // No semantic parent found - use clicked element itself
  return {
    semanticTarget: clickedElement,
    clickedDescendant: clickedElement,
    depth: 0,
  };
}

// ============================================================================
// Signal Extraction
// ============================================================================

/**
 * Extract identity signals from an element
 */
function extractIdentitySignals(element: Element): IdentitySignals {
  const signals: IdentitySignals = {};

  // data-testid (most stable)
  const testId = element.getAttribute('data-testid') ||
                 element.getAttribute('data-test-id') ||
                 element.getAttribute('data-cy') ||
                 element.getAttribute('data-test');
  if (testId) {
    signals.testId = testId;
  }

  // aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    signals.ariaLabel = ariaLabel;
  }

  // role
  const role = element.getAttribute('role');
  if (role) {
    signals.role = role;
  }

  // Accessible name (simplified computation)
  const accessibleName = computeAccessibleName(element);
  if (accessibleName) {
    signals.accessibleName = accessibleName;
  }

  // id (only if it looks stable, not generated)
  const id = element.id;
  if (id && !isGeneratedId(id)) {
    signals.id = id;
  }

  // name attribute (for form elements)
  const name = element.getAttribute('name');
  if (name) {
    signals.name = name;
  }

  return signals;
}

/**
 * Check if an ID looks like it was auto-generated
 */
function isGeneratedId(id: string): boolean {
  // React generated IDs like :r0:, :r1:
  if (/^:r[a-z0-9]+:$/.test(id)) return true;
  
  // Long hex strings
  if (/^[a-f0-9]{8,}$/i.test(id)) return true;
  
  // UUID-like
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return true;
  
  // Angular generated IDs
  if (/^ng-\d+$/.test(id)) return true;
  
  // Common generated patterns
  if (/^(el|element|node|item|widget)[-_]?\d+$/i.test(id)) return true;
  
  return false;
}

/**
 * Compute accessible name (simplified)
 */
function computeAccessibleName(element: Element): string | undefined {
  // aria-label takes precedence
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labels = labelledBy.split(' ')
      .map(id => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    if (labels.length > 0) return labels.join(' ');
  }

  // For inputs, check associated label
  if (element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement) {
    const id = element.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) return label.textContent?.trim();
    }
    // Check if wrapped in label
    const parentLabel = element.closest('label');
    if (parentLabel) {
      return parentLabel.textContent?.trim();
    }
  }

  // For buttons, use text content
  if (element.tagName === 'BUTTON' || element.getAttribute('role') === 'button') {
    return element.textContent?.trim();
  }

  return undefined;
}

/**
 * Extract text signals from an element
 */
function extractTextSignals(element: Element): TextSignals {
  const signals: TextSignals = {};

  // Get direct text content (not including deeply nested text)
  const exactText = getDirectTextContent(element).trim();
  if (exactText) {
    signals.exact = exactText;
    signals.normalized = exactText.toLowerCase();
    
    // Extract key words (2+ chars, no stopwords)
    const words = exactText.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length >= 2)
      .filter(w => !['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for'].includes(w));
    if (words.length > 0) {
      signals.contains = words;
    }
  }

  // Placeholder (for inputs)
  if (element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement) {
    const placeholder = element.placeholder;
    if (placeholder) {
      signals.placeholder = placeholder;
    }
  }

  return signals;
}

/**
 * Get direct text content (excluding deeply nested children)
 */
function getDirectTextContent(element: Element): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      // Include text from inline elements like span, strong, em
      if (['SPAN', 'STRONG', 'EM', 'B', 'I', 'SMALL', 'MARK'].includes(el.tagName)) {
        text += el.textContent || '';
      }
    }
  }
  return text;
}

/**
 * Extract structural signals from an element
 */
function extractStructuralSignals(element: Element): StructuralSignals {
  const signals: StructuralSignals = {
    tagName: element.tagName,
  };

  // Tag path (up to 4 levels)
  const pathParts: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  while (current && current !== document.body && depth < 4) {
    pathParts.unshift(current.tagName);
    current = current.parentElement;
    depth++;
  }
  signals.tagPath = pathParts.join(' > ');

  // nth-of-type calculation
  const parent = element.parentElement;
  if (parent) {
    const sameTypeSiblings = Array.from(parent.children)
      .filter(child => child.tagName === element.tagName);
    signals.nthOfType = sameTypeSiblings.indexOf(element) + 1;
    signals.totalOfType = sameTypeSiblings.length;
  }

  // Sibling context
  const prevSibling = element.previousElementSibling;
  const nextSibling = element.nextElementSibling;
  const siblingContext: { previousText?: string; nextText?: string } = {};
  
  if (prevSibling) {
    const prevText = prevSibling.textContent?.trim().slice(0, 50);
    if (prevText) siblingContext.previousText = prevText;
  }
  if (nextSibling) {
    const nextText = nextSibling.textContent?.trim().slice(0, 50);
    if (nextText) siblingContext.nextText = nextText;
  }
  
  if (Object.keys(siblingContext).length > 0) {
    signals.siblingContext = siblingContext;
  }

  return signals;
}

/**
 * Extract visual/spatial signals from an element
 */
function extractVisualSignals(element: Element): VisualSignals {
  const signals: VisualSignals = {};

  // Find section heading
  const sectionHeading = findNearestSectionHeading(element);
  if (sectionHeading) {
    signals.sectionHeading = sectionHeading;
    signals.landmark = `Inside '${sectionHeading}' section`;
  }

  // Form context
  const form = element.closest('form');
  if (form) {
    const formId = form.id || form.getAttribute('name') || form.getAttribute('aria-label');
    if (formId) {
      signals.formContext = formId;
    }
  }

  // Nearby labels
  const nearbyLabels = findNearbyLabels(element);
  if (nearbyLabels.length > 0) {
    signals.nearbyLabels = nearbyLabels;
  }

  // Position in viewport
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (centerX < viewportWidth / 3) {
    signals.position = centerY < viewportHeight / 2 ? 'top-left' : 'bottom-left';
  } else if (centerX > viewportWidth * 2 / 3) {
    signals.position = centerY < viewportHeight / 2 ? 'top-right' : 'bottom-right';
  } else {
    signals.position = 'center';
  }

  return signals;
}

/**
 * Find nearest section heading above the element
 */
function findNearestSectionHeading(element: Element): string | undefined {
  // Look for heading elements in ancestors
  let current: Element | null = element;
  while (current && current !== document.body) {
    // Check for section/article with aria-label or heading
    const section = current.closest('section, article, [role="region"], [role="group"]');
    if (section) {
      const ariaLabel = section.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel;
      
      const heading = section.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
      if (heading) return heading.textContent?.trim().slice(0, 50);
    }
    current = current.parentElement;
  }

  // Look for preceding headings
  let sibling: Element | null = element.previousElementSibling;
  let depth = 0;
  while (sibling && depth < 10) {
    if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(sibling.tagName) ||
        sibling.getAttribute('role') === 'heading') {
      return sibling.textContent?.trim().slice(0, 50);
    }
    sibling = sibling.previousElementSibling;
    depth++;
  }

  return undefined;
}

/**
 * Find nearby label elements
 */
function findNearbyLabels(element: Element): string[] {
  const labels: string[] = [];
  
  // Associated label for form elements
  if (element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement) {
    const id = element.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) {
        const text = label.textContent?.trim();
        if (text) labels.push(text);
      }
    }
  }

  // Parent label
  const parentLabel = element.closest('label');
  if (parentLabel) {
    const text = parentLabel.textContent?.trim();
    if (text && !labels.includes(text)) labels.push(text);
  }

  // Look for labels in nearby siblings (common in form layouts)
  const parent = element.parentElement;
  if (parent) {
    for (const sibling of parent.children) {
      if (sibling === element) continue;
      if (sibling.tagName === 'LABEL' ||
          sibling.classList.contains('label') ||
          sibling.classList.contains('form-label')) {
        const text = sibling.textContent?.trim();
        if (text && !labels.includes(text)) labels.push(text);
      }
    }
  }

  return labels.slice(0, 3); // Limit to 3 labels
}

/**
 * Extract CSS selector signals from an element
 */
function extractSelectorSignals(element: Element): SelectorSignals {
  const signals: SelectorSignals = {};

  // Ideal selector (data-testid, aria-label)
  const testId = element.getAttribute('data-testid') ||
                 element.getAttribute('data-test-id') ||
                 element.getAttribute('data-cy');
  if (testId) {
    signals.ideal = `[data-testid="${testId}"]`;
  } else {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      signals.ideal = `[aria-label="${ariaLabel}"]`;
    }
  }

  // Stable selector (uses tag, role, stable attributes)
  signals.stable = buildStableSelector(element);

  // Specific selector (may include classes, but not generated ones)
  signals.specific = buildSpecificSelector(element);

  // XPath
  signals.xpath = buildXPath(element);

  return signals;
}

/**
 * Build a stable selector using semantic attributes
 */
function buildStableSelector(element: Element): string {
  const parts: string[] = [element.tagName.toLowerCase()];

  // Add role if present
  const role = element.getAttribute('role');
  if (role) {
    parts[0] += `[role="${role}"]`;
  }

  // Add stable ID if present
  const id = element.id;
  if (id && !isGeneratedId(id)) {
    return `#${id}`;
  }

  // Add name attribute for form elements
  const name = element.getAttribute('name');
  if (name) {
    parts.push(`[name="${name}"]`);
    return parts.join('');
  }

  // Add type for inputs
  if (element instanceof HTMLInputElement) {
    const type = element.type;
    if (type && type !== 'text') {
      parts.push(`[type="${type}"]`);
    }
  }

  return parts.join('');
}

/**
 * Build a specific selector (may include non-generated classes)
 */
function buildSpecificSelector(element: Element): string {
  const parts: string[] = [];
  
  // Walk up to find a container with stable identifier
  let current: Element | null = element;
  let depth = 0;
  
  while (current && current !== document.body && depth < 3) {
    const part = buildElementSelectorPart(current);
    parts.unshift(part);
    
    // If we hit a stable identifier, stop
    if (current.id && !isGeneratedId(current.id)) {
      break;
    }
    if (current.getAttribute('data-testid')) {
      break;
    }
    
    current = current.parentElement;
    depth++;
  }
  
  return parts.join(' > ');
}

/**
 * Build selector part for a single element
 */
function buildElementSelectorPart(element: Element): string {
  // Prefer stable ID
  if (element.id && !isGeneratedId(element.id)) {
    return `#${element.id}`;
  }

  // Start with tag
  let selector = element.tagName.toLowerCase();

  // Add data-testid if present
  const testId = element.getAttribute('data-testid');
  if (testId) {
    return `[data-testid="${testId}"]`;
  }

  // Add non-generated classes
  const classes = Array.from(element.classList)
    .filter(cls => !isGeneratedClassName(cls))
    .slice(0, 2);
  
  if (classes.length > 0) {
    selector += '.' + classes.join('.');
  }

  return selector;
}

/**
 * Check if a class name looks auto-generated
 */
function isGeneratedClassName(className: string): boolean {
  // CSS-in-JS patterns (css-abc123, sc-abc123, emotion-abc)
  if (/^(css|sc|emotion|styled|jss|makeStyles)-[a-z0-9]+$/i.test(className)) return true;
  
  // Tailwind utilities are fine, but hash classes are not
  if (/^[a-z]+-[a-f0-9]{4,}$/i.test(className)) return true;
  
  // Random hash classes
  if (/^[a-f0-9]{8,}$/i.test(className)) return true;
  
  return false;
}

/**
 * Build XPath for an element
 */
function buildXPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  
  while (current && current !== document.body) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    
    if (parent) {
      const sameTagSiblings = Array.from(parent.children)
        .filter(child => child.tagName === current!.tagName);
      
      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(current) + 1;
        parts.unshift(`${tag}[${index}]`);
      } else {
        parts.unshift(tag);
      }
    } else {
      parts.unshift(tag);
    }
    
    current = parent;
  }
  
  return '//' + parts.join('/');
}

// ============================================================================
// Click Target Capture (for wrapper divs)
// ============================================================================

/**
 * Capture information about the original click target
 */
function captureClickTarget(
  semanticTarget: Element,
  clickedElement: Element,
  event?: MouseEvent
): ClickTargetInfo {
  const wasDescendant = semanticTarget !== clickedElement;
  
  const info: ClickTargetInfo = {
    wasDescendant,
  };

  if (wasDescendant) {
    info.descendantTag = clickedElement.tagName;
    info.descendantText = clickedElement.textContent?.trim().slice(0, 50);
    
    // Build a simple selector for the descendant
    const selector = buildElementSelectorPart(clickedElement);
    if (selector !== clickedElement.tagName.toLowerCase()) {
      info.descendantSelector = selector;
    }
  }

  // Capture click offset from center
  if (event) {
    const rect = semanticTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    info.offsetFromCenter = {
      x: Math.round(event.clientX - centerX),
      y: Math.round(event.clientY - centerY),
    };
  }

  return info;
}

// ============================================================================
// DOM Path Capture (Shadow DOM, Iframes)
// ============================================================================

/**
 * Capture the path through shadow roots and iframes to reach an element
 */
export function captureDOMPath(element: Element): DOMPath {
  const steps: DOMPathStep[] = [];
  let current: Element | null = element;
  let boundaryType: 'none' | 'shadow' | 'iframe' | 'mixed' = 'none';
  
  // Build path from element up to document
  const pathElements: Array<{ element: Element; isShadowHost: boolean; isIframe: boolean }> = [];
  
  while (current) {
    // Check if we're in shadow DOM
    const rootNode = current.getRootNode();
    
    if (rootNode instanceof ShadowRoot) {
      // We're inside a shadow DOM
      boundaryType = boundaryType === 'iframe' ? 'mixed' : 'shadow';
      
      pathElements.unshift({ element: current, isShadowHost: false, isIframe: false });
      pathElements.unshift({ element: rootNode.host, isShadowHost: true, isIframe: false });
      
      current = rootNode.host;
    } else if (rootNode instanceof Document) {
      // Check if this document is in an iframe
      const win = rootNode.defaultView;
      if (win && win !== win.parent && win.frameElement) {
        boundaryType = boundaryType === 'shadow' ? 'mixed' : 'iframe';
        
        pathElements.unshift({ element: current, isShadowHost: false, isIframe: false });
        pathElements.unshift({ element: win.frameElement as Element, isShadowHost: false, isIframe: true });
        
        current = win.frameElement as Element;
      } else {
        // We've reached the top document
        pathElements.unshift({ element: current, isShadowHost: false, isIframe: false });
        break;
      }
    } else {
      break;
    }
  }
  
  // Convert path elements to steps
  steps.push({ type: 'document' });
  
  for (const item of pathElements) {
    if (item.isIframe) {
      const iframe = item.element as HTMLIFrameElement;
      steps.push({
        type: 'iframe',
        selector: buildStableSelector(iframe),
        src: iframe.src,
      });
      steps.push({ type: 'document' });
    } else if (item.isShadowHost) {
      steps.push({
        type: 'shadow-host',
        selector: buildStableSelector(item.element),
      });
      steps.push({ type: 'shadow-root' });
    }
  }
  
  // Final element step (only if we crossed boundaries)
  if (boundaryType !== 'none') {
    // Build signature for the target element
    steps.push({
      type: 'element',
      signature: buildElementSignatureInternal(element),
    });
  }
  
  return {
    boundaryType,
    steps: boundaryType === 'none' ? [] : steps,
  };
}

// ============================================================================
// Main Signature Builder
// ============================================================================

/**
 * Internal signature builder (without click target info)
 */
function buildElementSignatureInternal(element: Element): ElementSignature {
  const rect = element.getBoundingClientRect();
  
  return {
    identity: extractIdentitySignals(element),
    text: extractTextSignals(element),
    structure: extractStructuralSignals(element),
    visual: extractVisualSignals(element),
    selectors: extractSelectorSignals(element),
    bounds: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

/**
 * Build a complete element signature
 * 
 * @param clickedElement - The element that was actually clicked
 * @param event - The mouse event (optional, for capturing click position)
 * @returns Complete element signature with all signals
 */
export function buildElementSignature(
  clickedElement: Element,
  event?: MouseEvent
): ElementSignature {
  // Find semantic target (handles wrapper divs)
  const { semanticTarget, clickedDescendant } = findSemanticTarget(clickedElement);
  
  // Build base signature for semantic target
  const signature = buildElementSignatureInternal(semanticTarget);
  
  // Add click target info if we climbed from a descendant
  signature.clickTarget = captureClickTarget(semanticTarget, clickedDescendant, event);
  
  return signature;
}

/**
 * Build signature for a specific element (no semantic target climbing)
 */
export function buildElementSignatureExact(element: Element): ElementSignature {
  return buildElementSignatureInternal(element);
}

