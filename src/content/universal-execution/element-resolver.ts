/**
 * Element Resolver
 * 
 * Multi-signal resolution with confidence scoring.
 * Tries multiple strategies and picks the best match.
 * Handles shadow DOM and iframes.
 */

import type {
  ElementSignature,
  DOMPath,
  ResolutionResult,
  ResolutionCandidate,
  ResolutionOptions,
} from '../../types/universal-types';

// ============================================================================
// Signal Weights for Scoring
// ============================================================================

const SIGNAL_WEIGHTS = {
  testId: 50,        // data-testid is most stable
  ariaLabel: 25,     // ARIA label is reliable
  role: 15,          // Role is stable
  accessibleName: 20,// Accessible name
  id: 30,            // Stable ID
  name: 25,          // Form element name
  exactText: 40,     // Exact text match
  normalizedText: 30,// Normalized text match
  containsText: 20,  // Contains key words
  tagName: 10,       // Same tag
  tagPath: 15,       // Same structural path
  nthOfType: 10,     // Same position among siblings
  landmark: 15,      // Same section/landmark
  formContext: 10,   // Same form
  nearbyLabel: 15,   // Has same nearby label
  cssSelector: 20,   // CSS selector match
  xpath: 15,         // XPath match
};

const MIN_CONFIDENCE_THRESHOLD = 0.3;
const AMBIGUITY_THRESHOLD = 0.15; // Difference needed to be "clear winner"

// ============================================================================
// Resolution Across DOM Boundaries
// ============================================================================

/**
 * Resolve element across shadow DOM and iframe boundaries
 */
export function resolveAcrossBoundaries(
  domPath: DOMPath,
  signature: ElementSignature,
  options: ResolutionOptions = {}
): ResolutionResult {
  // If no boundaries, resolve directly
  if (domPath.boundaryType === 'none' || domPath.steps.length === 0) {
    return resolveElement(signature, options);
  }

  // Navigate through boundaries
  let context: Document | ShadowRoot | Element = document;
  
  for (let i = 0; i < domPath.steps.length; i++) {
    const step = domPath.steps[i];
    
    switch (step.type) {
      case 'document':
        // Stay in current context
        break;
        
      case 'shadow-host': {
        const hostEl: Element | null = (context as Document | Element).querySelector(step.selector);
        if (!hostEl) {
          return {
            status: 'not_found',
            triedMethods: ['shadow-host-lookup'],
            lastError: `Shadow host not found: ${step.selector}`,
          };
        }
        // Don't enter shadow root yet, just mark we found the host
        context = hostEl;
        break;
      }
        
      case 'shadow-root': {
        // Context should be an Element for shadow root access
        const contextElement = context as Element;
        if (!contextElement || typeof contextElement.shadowRoot === 'undefined') {
          return {
            status: 'not_found',
            triedMethods: ['shadow-root-access'],
            lastError: 'Expected element context for shadow root',
          };
        }
        const sr = contextElement.shadowRoot;
        if (!sr) {
          return {
            status: 'not_found',
            triedMethods: ['shadow-root-access'],
            lastError: 'Shadow root not accessible (closed mode?)',
          };
        }
        context = sr;
        break;
      }
        
      case 'iframe': {
        const iframe = (context as Document | Element).querySelector(step.selector) as HTMLIFrameElement;
        if (!iframe) {
          return {
            status: 'not_found',
            triedMethods: ['iframe-lookup'],
            lastError: `Iframe not found: ${step.selector}`,
          };
        }
        try {
          const iframeDoc = iframe.contentDocument;
          if (!iframeDoc) {
            return {
              status: 'not_found',
              triedMethods: ['iframe-access'],
              lastError: 'Cannot access iframe content (cross-origin?)',
            };
          }
          context = iframeDoc;
        } catch (e) {
          return {
            status: 'not_found',
            triedMethods: ['iframe-access'],
            lastError: 'Cross-origin iframe access denied',
          };
        }
        break;
      }
        
      case 'element': {
        // Final step - resolve the element in current context
        const searchContext = context instanceof Document || context instanceof ShadowRoot
          ? context
          : context.ownerDocument || document;
        
        return resolveElement(step.signature, {
          ...options,
          searchContext: searchContext as Document,
        });
      }
    }
  }
  
  // If we got here without an 'element' step, resolve using the signature
  const finalContext = context instanceof Document || context instanceof ShadowRoot
    ? context as unknown as Document
    : document;
  
  return resolveElement(signature, {
    ...options,
    searchContext: finalContext,
  });
}

// ============================================================================
// Main Resolution
// ============================================================================

/**
 * Resolve an element using multi-signal matching
 */
export function resolveElement(
  signature: ElementSignature,
  options: ResolutionOptions = {}
): ResolutionResult {
  const {
    timeout = 5000,
    minConfidence = MIN_CONFIDENCE_THRESHOLD,
    autoPickBest = true,
    searchContext = document,
  } = options;

  const startTime = Date.now();
  const triedMethods: string[] = [];
  
  // Retry loop with timeout
  while (Date.now() - startTime < timeout) {
    const candidates: ResolutionCandidate[] = [];

    // Stage 1: Identity selectors (fastest, most reliable)
    const identityResult = tryIdentitySelectors(signature, searchContext);
    triedMethods.push(...identityResult.triedMethods);
    candidates.push(...identityResult.candidates);

    // If we found a high-confidence match, return immediately
    const highConfidence = candidates.find(c => c.confidence >= 0.9);
    if (highConfidence) {
      return {
        status: 'found',
        element: highConfidence.element,
        confidence: highConfidence.confidence,
        method: highConfidence.method,
      };
    }

    // Stage 2: Role + text combination
    const roleTextResult = tryRoleAndText(signature, searchContext);
    triedMethods.push(...roleTextResult.triedMethods);
    candidates.push(...roleTextResult.candidates);

    // Stage 3: Text matching on all interactive elements
    const textResult = tryTextMatching(signature, searchContext);
    triedMethods.push(...textResult.triedMethods);
    candidates.push(...textResult.candidates);

    // Stage 4: Structural matching
    const structuralResult = tryStructuralMatching(signature, searchContext);
    triedMethods.push(...structuralResult.triedMethods);
    candidates.push(...structuralResult.candidates);

    // Stage 5: CSS selector fallback
    const selectorResult = trySelectorFallback(signature, searchContext);
    triedMethods.push(...selectorResult.triedMethods);
    candidates.push(...selectorResult.candidates);

    // Deduplicate candidates (same element might be found multiple ways)
    const uniqueCandidates = deduplicateCandidates(candidates);

    // Score and rank candidates
    const scoredCandidates = uniqueCandidates
      .map(c => ({
        ...c,
        confidence: calculateConfidence(c, signature),
      }))
      .filter(c => c.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence);

    // No candidates found
    if (scoredCandidates.length === 0) {
      // Wait a bit and retry
      if (Date.now() - startTime < timeout - 100) {
        // Synchronous wait (we're in a tight loop)
        const waitEnd = Date.now() + 100;
        while (Date.now() < waitEnd) {
          // Busy wait - in practice, use requestAnimationFrame
        }
        continue;
      }
      
      return {
        status: 'not_found',
        triedMethods: [...new Set(triedMethods)],
        lastError: 'No matching elements found',
      };
    }

    // Single candidate - clear winner
    if (scoredCandidates.length === 1) {
      return {
        status: 'found',
        element: scoredCandidates[0].element,
        confidence: scoredCandidates[0].confidence,
        method: scoredCandidates[0].method,
      };
    }

    // Check if top candidate is clear winner
    const topScore = scoredCandidates[0].confidence;
    const secondScore = scoredCandidates[1].confidence;
    
    if (topScore - secondScore >= AMBIGUITY_THRESHOLD) {
      return {
        status: 'found',
        element: scoredCandidates[0].element,
        confidence: scoredCandidates[0].confidence,
        method: scoredCandidates[0].method,
      };
    }

    // Ambiguous - try disambiguation
    const disambiguated = disambiguateCandidates(scoredCandidates, signature);
    if (disambiguated) {
      return {
        status: 'found',
        element: disambiguated.element,
        confidence: disambiguated.confidence,
        method: disambiguated.method + '+disambiguation',
      };
    }

    // Still ambiguous
    if (autoPickBest) {
      // Auto-pick the best one
      return {
        status: 'found',
        element: scoredCandidates[0].element,
        confidence: scoredCandidates[0].confidence,
        method: scoredCandidates[0].method + '+auto-pick',
      };
    }

    return {
      status: 'ambiguous',
      candidates: scoredCandidates.slice(0, 5),
      topScore,
    };
  }

  return {
    status: 'not_found',
    triedMethods: [...new Set(triedMethods)],
    lastError: 'Timeout waiting for element',
  };
}

// ============================================================================
// Resolution Strategies
// ============================================================================

interface StrategyResult {
  candidates: ResolutionCandidate[];
  triedMethods: string[];
}

/**
 * Stage 1: Try identity selectors (data-testid, aria-label, id)
 */
function tryIdentitySelectors(
  signature: ElementSignature,
  context: Document | Element
): StrategyResult {
  const candidates: ResolutionCandidate[] = [];
  const triedMethods: string[] = [];

  const { identity } = signature;

  // data-testid (highest priority)
  if (identity.testId) {
    triedMethods.push('testId');
    const selector = `[data-testid="${identity.testId}"], [data-test-id="${identity.testId}"], [data-cy="${identity.testId}"]`;
    const elements = context.querySelectorAll(selector);
    for (const el of elements) {
      if (isVisible(el)) {
        candidates.push({
          element: el,
          confidence: 0.95,
          method: 'testId',
          signalScores: { testId: SIGNAL_WEIGHTS.testId },
        });
      }
    }
  }

  // Stable ID
  if (identity.id) {
    triedMethods.push('id');
    const el = context.querySelector(`#${CSS.escape(identity.id)}`);
    if (el && isVisible(el)) {
      candidates.push({
        element: el,
        confidence: 0.9,
        method: 'id',
        signalScores: { id: SIGNAL_WEIGHTS.id },
      });
    }
  }

  // aria-label
  if (identity.ariaLabel) {
    triedMethods.push('ariaLabel');
    const selector = `[aria-label="${identity.ariaLabel}"]`;
    const elements = context.querySelectorAll(selector);
    for (const el of elements) {
      if (isVisible(el)) {
        candidates.push({
          element: el,
          confidence: 0.85,
          method: 'ariaLabel',
          signalScores: { ariaLabel: SIGNAL_WEIGHTS.ariaLabel },
        });
      }
    }
  }

  // name attribute
  if (identity.name) {
    triedMethods.push('name');
    const selector = `[name="${identity.name}"]`;
    const elements = context.querySelectorAll(selector);
    for (const el of elements) {
      if (isVisible(el)) {
        candidates.push({
          element: el,
          confidence: 0.8,
          method: 'name',
          signalScores: { name: SIGNAL_WEIGHTS.name },
        });
      }
    }
  }

  return { candidates, triedMethods };
}

/**
 * Stage 2: Try role + text combination
 */
function tryRoleAndText(
  signature: ElementSignature,
  context: Document | Element
): StrategyResult {
  const candidates: ResolutionCandidate[] = [];
  const triedMethods: string[] = [];

  const { identity, text, structure } = signature;
  const role = identity.role;
  const exactText = text.exact;

  if (role && exactText) {
    triedMethods.push('role+text');
    const elements = context.querySelectorAll(`[role="${role}"]`);
    for (const el of elements) {
      if (isVisible(el) && el.textContent?.trim() === exactText) {
        candidates.push({
          element: el,
          confidence: 0.85,
          method: 'role+text',
          signalScores: { 
            role: SIGNAL_WEIGHTS.role, 
            exactText: SIGNAL_WEIGHTS.exactText 
          },
        });
      }
    }
  }

  // Also try tag + text
  if (structure.tagName && exactText) {
    triedMethods.push('tag+text');
    const elements = context.querySelectorAll(structure.tagName.toLowerCase());
    for (const el of elements) {
      if (isVisible(el) && el.textContent?.trim() === exactText) {
        candidates.push({
          element: el,
          confidence: 0.75,
          method: 'tag+text',
          signalScores: { 
            tagName: SIGNAL_WEIGHTS.tagName, 
            exactText: SIGNAL_WEIGHTS.exactText 
          },
        });
      }
    }
  }

  return { candidates, triedMethods };
}

/**
 * Stage 3: Text matching on interactive elements
 */
function tryTextMatching(
  signature: ElementSignature,
  context: Document | Element
): StrategyResult {
  const candidates: ResolutionCandidate[] = [];
  const triedMethods: string[] = [];

  const { text } = signature;
  
  if (!text.exact && !text.normalized) {
    return { candidates, triedMethods };
  }

  triedMethods.push('textMatching');

  // Get all interactive elements
  const interactiveSelectors = [
    'button', 'a', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="menuitem"]',
    '[role="option"]', '[role="tab"]', '[role="checkbox"]',
    '[role="radio"]', '[role="switch"]', '[role="combobox"]',
    '[tabindex]',
  ];

  const elements = context.querySelectorAll(interactiveSelectors.join(', '));
  
  for (const el of elements) {
    if (!isVisible(el)) continue;
    
    const elText = el.textContent?.trim() || '';
    const elTextNorm = elText.toLowerCase();
    
    // Exact match
    if (text.exact && elText === text.exact) {
      candidates.push({
        element: el,
        confidence: 0.8,
        method: 'text-exact',
        signalScores: { exactText: SIGNAL_WEIGHTS.exactText },
      });
      continue;
    }
    
    // Normalized match
    if (text.normalized && elTextNorm === text.normalized) {
      candidates.push({
        element: el,
        confidence: 0.7,
        method: 'text-normalized',
        signalScores: { normalizedText: SIGNAL_WEIGHTS.normalizedText },
      });
      continue;
    }
    
    // Contains match
    if (text.contains && text.contains.length > 0) {
      const matchedWords = text.contains.filter(word => elTextNorm.includes(word));
      if (matchedWords.length >= text.contains.length * 0.7) {
        candidates.push({
          element: el,
          confidence: 0.5 + (matchedWords.length / text.contains.length) * 0.2,
          method: 'text-contains',
          signalScores: { containsText: SIGNAL_WEIGHTS.containsText },
        });
      }
    }
  }

  return { candidates, triedMethods };
}

/**
 * Stage 4: Structural matching
 */
function tryStructuralMatching(
  signature: ElementSignature,
  context: Document | Element
): StrategyResult {
  const candidates: ResolutionCandidate[] = [];
  const triedMethods: string[] = [];

  const { structure } = signature;

  // Tag path matching
  if (structure.tagPath) {
    triedMethods.push('tagPath');
    try {
      const pathSelector = structure.tagPath.toLowerCase().replace(/ > /g, ' > ');
      const elements = context.querySelectorAll(pathSelector);
      
      // If we have nth-of-type info, use it
      if (structure.nthOfType && elements.length >= structure.nthOfType) {
        const el = elements[structure.nthOfType - 1];
        if (isVisible(el)) {
          candidates.push({
            element: el,
            confidence: 0.6,
            method: 'tagPath+nth',
            signalScores: { 
              tagPath: SIGNAL_WEIGHTS.tagPath, 
              nthOfType: SIGNAL_WEIGHTS.nthOfType 
            },
          });
        }
      } else {
        // Just use first match
        for (const el of elements) {
          if (isVisible(el)) {
            candidates.push({
              element: el,
              confidence: 0.5,
              method: 'tagPath',
              signalScores: { tagPath: SIGNAL_WEIGHTS.tagPath },
            });
            break; // Only take first
          }
        }
      }
    } catch {
      // Invalid selector
    }
  }

  return { candidates, triedMethods };
}

/**
 * Stage 5: CSS selector fallback
 */
function trySelectorFallback(
  signature: ElementSignature,
  context: Document | Element
): StrategyResult {
  const candidates: ResolutionCandidate[] = [];
  const triedMethods: string[] = [];

  const { selectors } = signature;

  // Try selectors in order of stability
  const selectorPriority: Array<{ key: keyof typeof selectors; confidence: number }> = [
    { key: 'ideal', confidence: 0.7 },
    { key: 'stable', confidence: 0.6 },
    { key: 'specific', confidence: 0.5 },
  ];

  for (const { key, confidence } of selectorPriority) {
    const selector = selectors[key];
    if (!selector) continue;

    triedMethods.push(`selector-${key}`);
    try {
      const elements = context.querySelectorAll(selector);
      for (const el of elements) {
        if (isVisible(el)) {
          candidates.push({
            element: el,
            confidence,
            method: `selector-${key}`,
            signalScores: { cssSelector: SIGNAL_WEIGHTS.cssSelector },
          });
        }
      }
    } catch {
      // Invalid selector
    }
  }

  // XPath fallback
  if (selectors.xpath) {
    triedMethods.push('xpath');
    try {
      const doc = context instanceof Document ? context : context.ownerDocument;
      if (doc) {
        const result = doc.evaluate(
          selectors.xpath,
          context,
          null,
          XPathResult.ORDERED_NODE_ITERATOR_TYPE,
          null
        );
        
        let node = result.iterateNext();
        while (node) {
          if (node instanceof Element && isVisible(node)) {
            candidates.push({
              element: node,
              confidence: 0.45,
              method: 'xpath',
              signalScores: { xpath: SIGNAL_WEIGHTS.xpath },
            });
          }
          node = result.iterateNext();
        }
      }
    } catch {
      // Invalid XPath
    }
  }

  return { candidates, triedMethods };
}

// ============================================================================
// Scoring and Disambiguation
// ============================================================================

/**
 * Calculate overall confidence score for a candidate
 */
function calculateConfidence(
  candidate: ResolutionCandidate,
  signature: ElementSignature
): number {
  let score = candidate.confidence;
  
  // Bonus for matching additional signals
  const element = candidate.element;
  
  // Check visual signals
  if (signature.visual.landmark) {
    const section = element.closest('section, article, [role="region"], [role="group"]');
    if (section) {
      const sectionLabel = section.getAttribute('aria-label') ||
                          section.querySelector('h1, h2, h3, h4')?.textContent?.trim();
      if (sectionLabel && signature.visual.landmark.includes(sectionLabel)) {
        score += 0.05;
      }
    }
  }
  
  // Check form context
  if (signature.visual.formContext) {
    const form = element.closest('form');
    if (form) {
      const formId = form.id || form.getAttribute('name') || form.getAttribute('aria-label');
      if (formId === signature.visual.formContext) {
        score += 0.05;
      }
    }
  }
  
  // Check nearby labels
  if (signature.visual.nearbyLabels && signature.visual.nearbyLabels.length > 0) {
    const parent = element.parentElement;
    if (parent) {
      const siblingText = Array.from(parent.children)
        .map(el => el.textContent?.trim())
        .filter(Boolean);
      
      const matchedLabels = signature.visual.nearbyLabels.filter(label =>
        siblingText.some(text => text?.includes(label))
      );
      
      if (matchedLabels.length > 0) {
        score += 0.03 * matchedLabels.length;
      }
    }
  }
  
  return Math.min(score, 1.0);
}

/**
 * Try to disambiguate between similar candidates using context
 */
function disambiguateCandidates(
  candidates: ResolutionCandidate[],
  signature: ElementSignature
): ResolutionCandidate | null {
  if (candidates.length < 2) return null;

  // Try sibling context
  if (signature.structure.siblingContext) {
    const { previousText, nextText } = signature.structure.siblingContext;
    
    for (const candidate of candidates) {
      const prev = candidate.element.previousElementSibling;
      const next = candidate.element.nextElementSibling;
      
      let matches = 0;
      if (previousText && prev?.textContent?.includes(previousText)) matches++;
      if (nextText && next?.textContent?.includes(nextText)) matches++;
      
      if (matches > 0) {
        return {
          ...candidate,
          confidence: candidate.confidence + 0.1,
          method: candidate.method + '+sibling',
        };
      }
    }
  }

  // Try position matching
  if (signature.visual.position) {
    for (const candidate of candidates) {
      const rect = candidate.element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      let position: string;
      if (centerX < viewportWidth / 3) {
        position = centerY < viewportHeight / 2 ? 'top-left' : 'bottom-left';
      } else if (centerX > viewportWidth * 2 / 3) {
        position = centerY < viewportHeight / 2 ? 'top-right' : 'bottom-right';
      } else {
        position = 'center';
      }
      
      if (position === signature.visual.position) {
        return {
          ...candidate,
          confidence: candidate.confidence + 0.05,
          method: candidate.method + '+position',
        };
      }
    }
  }

  return null;
}

/**
 * Remove duplicate candidates (same element found via different methods)
 */
function deduplicateCandidates(candidates: ResolutionCandidate[]): ResolutionCandidate[] {
  const seen = new Map<Element, ResolutionCandidate>();
  
  for (const candidate of candidates) {
    const existing = seen.get(candidate.element);
    if (!existing || candidate.confidence > existing.confidence) {
      seen.set(candidate.element, candidate);
    }
  }
  
  return Array.from(seen.values());
}

// ============================================================================
// Visibility Helpers
// ============================================================================

/**
 * Check if an element is visible
 */
function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return true; // SVG elements etc. - assume visible
  }
  
  const style = window.getComputedStyle(element);
  
  // Check display
  if (style.display === 'none') return false;
  
  // Check visibility
  if (style.visibility === 'hidden') return false;
  
  // Check opacity
  if (style.opacity === '0') return false;
  
  // Check dimensions
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  
  return true;
}

/**
 * Wait for an element to appear (async version)
 */
export async function waitForElement(
  signature: ElementSignature,
  options: ResolutionOptions = {}
): Promise<ResolutionResult> {
  const { timeout = 5000 } = options;
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const result = resolveElement(signature, { ...options, timeout: 100 });
    
    if (result.status === 'found') {
      return result;
    }
    
    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return {
    status: 'not_found',
    triedMethods: ['waitForElement'],
    lastError: `Element not found within ${timeout}ms`,
  };
}

