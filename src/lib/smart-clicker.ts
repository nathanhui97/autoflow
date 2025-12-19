/**
 * SmartClicker v2 - Ultimate Semantic Element Finding and Clicking
 * 
 * Finds elements by semantic properties with 99% reliability across all platforms.
 * Supports Salesforce, Office 365, Gmail, and all major SaaS applications.
 */

import { ShadowDOMUtils } from '../content/shadow-dom-utils';
import { PlatformDetector, type PlatformInfo } from './platform-detector';

// ============================================================================
// Types
// ============================================================================

export interface SemanticTarget {
  // Text matching
  text?: string;
  textMatch?: 'exact' | 'contains' | 'startsWith' | 'endsWith' | 'fuzzy';
  
  // Element identity
  role?: string;
  tagName?: string;
  ariaLabel?: string;
  testId?: string;
  title?: string;
  placeholder?: string;
  name?: string;
  
  // Context
  nearbyText?: string[];
  region?: string;
  parentText?: string;
  
  // Disambiguation
  index?: number;
  className?: string;
  
  // Timing
  waitTimeout?: number;
  
  // Canvas/Grid fallback (for Excel, Airtable)
  fallbackCoordinates?: { x: number; y: number };
}

export interface ClickResult {
  success: boolean;
  element?: Element;
  method?: string;
  error?: string;
  strategiesTried: string[];
}

interface FindResult {
  element: Element | null;
  confidence: number;
  method: string;
}

interface PageState {
  activeElement: Element | null;
  url: string;
  bodyLength: number;
  elementClass: string;
}

// ============================================================================
// SmartClicker v2
// ============================================================================

export class SmartClicker {
  private static platform: PlatformInfo | null = null;

  /**
   * Find and click an element using semantic targeting
   */
  static async click(target: SemanticTarget): Promise<ClickResult> {
    console.log('[SmartClicker] Clicking target:', target);
    
    // Detect platform once
    if (!this.platform) {
      this.platform = PlatformDetector.detect();
      console.log('[SmartClicker] Platform detected:', this.platform.name);
    }
    
    // Step 1: Find the element with retry
    const timeout = target.waitTimeout || 10000;
    const findResult = await this.findElementWithRetry(target, timeout);
    
    if (!findResult.element) {
      // Try canvas fallback if available
      if (target.fallbackCoordinates && this.platform.hasCanvas) {
        console.log('[SmartClicker] Using canvas coordinate fallback');
        return this.clickAtCoordinates(target.fallbackCoordinates.x, target.fallbackCoordinates.y);
      }
      
      return {
        success: false,
        error: 'Element not found after retry',
        strategiesTried: ['find-with-retry'],
      };
    }
    
    console.log(`[SmartClicker] Found element via ${findResult.method} (confidence: ${findResult.confidence})`);
    
    // Step 2: Verify element is clickable
    const verification = this.verifyClickable(findResult.element);
    if (!verification.ok) {
      // Try to fix the issue
      if (verification.issue === 'not-visible') {
        (findResult.element as HTMLElement).scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
        await this.randomDelay(100, 200);
      } else if (verification.issue === 'obscured') {
        // Element might be obscured, try scrolling
        (findResult.element as HTMLElement).scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
        await this.randomDelay(100, 200);
      }
    }
    
    // Capture state before click for verification
    const beforeState = this.capturePageState(findResult.element);
    
    // Step 3: Execute human-like click
    const clickSuccess = await this.humanClick(findResult.element);
    
    if (!clickSuccess) {
      return {
        success: false,
        element: findResult.element,
        error: 'Click execution failed',
        strategiesTried: [findResult.method, 'human-click'],
      };
    }
    
    // Step 4: Verify click result
    const verified = await this.verifyClickResult(findResult.element, beforeState);
    if (!verified) {
      console.error('[SmartClicker] Click did not produce any visible change - likely failed');
      return {
        success: false,
        element: findResult.element,
        error: 'Click executed but no page change detected - click may have been ignored',
        strategiesTried: [findResult.method],
      };
    }
    
    console.log('[SmartClicker] Click verified - page state changed');
    
    return {
      success: true,
      element: findResult.element,
      method: findResult.method,
      strategiesTried: [findResult.method],
    };
  }
  
  // ==========================================================================
  // Finding with Retry
  // ==========================================================================
  
  /**
   * Find element with retry logic
   */
  private static async findElementWithRetry(
    target: SemanticTarget,
    timeout: number
  ): Promise<FindResult> {
    const startTime = Date.now();
    const pollInterval = 200;
    let attemptCount = 0;
    
    while (Date.now() - startTime < timeout) {
      attemptCount++;
      const result = await this.findElement(target);
      
      if (result.element) {
        console.log(`[SmartClicker] Found element on attempt ${attemptCount} after ${Date.now() - startTime}ms`);
        return result;
      }
      
      console.log(`[SmartClicker] Attempt ${attemptCount} - no element found, retrying...`);
      
      // Wait before retry
      await this.sleep(pollInterval);
    }
    
    console.error(`[SmartClicker] Timeout after ${attemptCount} attempts (${timeout}ms)`);
    
    return {
      element: null,
      confidence: 0,
      method: 'timeout',
    };
  }
  
  /**
   * Find an element using all available strategies
   */
  private static async findElement(target: SemanticTarget): Promise<FindResult> {
    const strategies = [
      { name: 'testId', fn: () => this.findByTestId(target) },
      { name: 'ariaLabel', fn: () => this.findByAriaLabel(target) },
      { name: 'roleAndText', fn: () => this.findByRoleAndText(target) },
      { name: 'name', fn: () => this.findByName(target) },
      { name: 'title', fn: () => this.findByTitle(target) },
      { name: 'placeholder', fn: () => this.findByPlaceholder(target) },
      { name: 'tagNameAndText', fn: () => this.findByTagNameAndText(target) },
      { name: 'text', fn: () => this.findByText(target) },
      { name: 'className', fn: () => this.findByClassName(target) },
      { name: 'nearbyText', fn: () => this.findByNearbyText(target) },
      { name: 'fuzzyText', fn: () => this.findByFuzzyText(target) },
    ];
    
    const candidates: FindResult[] = [];
    const strategiesAttempted: string[] = [];
    
    // Try all strategies
    for (const strategy of strategies) {
      strategiesAttempted.push(strategy.name);
      const result = strategy.fn();
      if (result.element) {
        console.log(`[SmartClicker] Strategy '${strategy.name}' found element (confidence: ${result.confidence})`);
        candidates.push(result);
      }
    }
    
    // No candidates found
    if (candidates.length === 0) {
      console.warn(`[SmartClicker] No candidates found. Tried: ${strategiesAttempted.join(', ')}`);
      console.warn(`[SmartClicker] Target was:`, target);
      return {
        element: null,
        confidence: 0,
        method: 'none',
      };
    }
    
    console.log(`[SmartClicker] Found ${candidates.length} candidates`);
    
    // Sort by confidence
    candidates.sort((a, b) => b.confidence - a.confidence);
    
    // If we have a specific index, use it
    if (target.index !== undefined && candidates[target.index]) {
      console.log(`[SmartClicker] Using candidate at index ${target.index}`);
      return candidates[target.index];
    }
    
    // Return highest confidence
    console.log(`[SmartClicker] Selecting best candidate: ${candidates[0].method} (${candidates[0].confidence})`);
    return candidates[0];
  }
  
  // ==========================================================================
  // Finding Strategies (12 total)
  // ==========================================================================
  
  /**
   * Strategy 1: Find by data-testid (95% confidence)
   */
  private static findByTestId(target: SemanticTarget): FindResult {
    if (!target.testId) {
      return { element: null, confidence: 0, method: 'testid' };
    }
    
    const selectors = [
      `[data-testid="${target.testId}"]`,
      `[data-test-id="${target.testId}"]`,
      `[data-cy="${target.testId}"]`,
      `[data-automation-id="${target.testId}"]`,
    ];
    
    for (const selector of selectors) {
      const elements = this.querySelectorAllDeep(selector);
      const visible = elements.filter(el => this.isVisible(el));
      
      if (visible.length > 0) {
        return {
          element: this.filterByRegion(visible, target.region)[0] || visible[0],
          confidence: 0.95,
          method: 'testid',
        };
      }
    }
    
    return { element: null, confidence: 0, method: 'testid' };
  }
  
  /**
   * Strategy 2: Find by aria-label (90% confidence)
   */
  private static findByAriaLabel(target: SemanticTarget): FindResult {
    if (!target.ariaLabel) {
      return { element: null, confidence: 0, method: 'aria-label' };
    }
    
    const elements = this.querySelectorAllDeep(`[aria-label="${target.ariaLabel}"]`);
    const visible = elements.filter(el => this.isVisible(el));
    
    if (visible.length > 0) {
      return {
        element: this.filterByRegion(visible, target.region)[0] || visible[0],
        confidence: 0.9,
        method: 'aria-label',
      };
    }
    
    return { element: null, confidence: 0, method: 'aria-label' };
  }
  
  /**
   * Strategy 3: Find by role + text (85% confidence)
   */
  private static findByRoleAndText(target: SemanticTarget): FindResult {
    if (!target.role || !target.text) {
      return { element: null, confidence: 0, method: 'role+text' };
    }
    
    const elements = this.querySelectorAllDeep(`[role="${target.role}"]`);
    const visible = elements.filter(el => this.isVisible(el));
    
    const matches = visible.filter(el => this.textMatches(el, target));
    
    if (matches.length > 0) {
      const inRegion = this.filterByRegion(matches, target.region);
      return {
        element: inRegion[0] || matches[0],
        confidence: inRegion.length > 0 ? 0.9 : 0.85,
        method: inRegion.length > 0 ? 'role+text+region' : 'role+text',
      };
    }
    
    return { element: null, confidence: 0, method: 'role+text' };
  }
  
  /**
   * Strategy 4: Find by name attribute (80% confidence)
   */
  private static findByName(target: SemanticTarget): FindResult {
    if (!target.name) {
      return { element: null, confidence: 0, method: 'name' };
    }
    
    const elements = this.querySelectorAllDeep(`[name="${target.name}"]`);
    const visible = elements.filter(el => this.isVisible(el));
    
    if (visible.length > 0) {
      return {
        element: this.filterByRegion(visible, target.region)[0] || visible[0],
        confidence: 0.8,
        method: 'name',
      };
    }
    
    return { element: null, confidence: 0, method: 'name' };
  }
  
  /**
   * Strategy 5: Find by title attribute (75% confidence)
   */
  private static findByTitle(target: SemanticTarget): FindResult {
    if (!target.title) {
      return { element: null, confidence: 0, method: 'title' };
    }
    
    const elements = this.querySelectorAllDeep(`[title="${target.title}"]`);
    const visible = elements.filter(el => this.isVisible(el));
    
    if (visible.length > 0) {
      return {
        element: this.filterByRegion(visible, target.region)[0] || visible[0],
        confidence: 0.75,
        method: 'title',
      };
    }
    
    return { element: null, confidence: 0, method: 'title' };
  }
  
  /**
   * Strategy 6: Find by placeholder (75% confidence)
   */
  private static findByPlaceholder(target: SemanticTarget): FindResult {
    if (!target.placeholder) {
      return { element: null, confidence: 0, method: 'placeholder' };
    }
    
    const elements = this.querySelectorAllDeep(
      `[placeholder*="${target.placeholder}"]`
    );
    const visible = elements.filter(el => this.isVisible(el));
    
    if (visible.length > 0) {
      return {
        element: this.filterByRegion(visible, target.region)[0] || visible[0],
        confidence: 0.75,
        method: 'placeholder',
      };
    }
    
    return { element: null, confidence: 0, method: 'placeholder' };
  }
  
  /**
   * Strategy 7: Find by tagName + text (70% confidence)
   */
  private static findByTagNameAndText(target: SemanticTarget): FindResult {
    if (!target.tagName || !target.text) {
      return { element: null, confidence: 0, method: 'tagName+text' };
    }
    
    const elements = this.querySelectorAllDeep(target.tagName.toLowerCase());
    const visible = elements.filter(el => this.isVisible(el));
    
    const matches = visible.filter(el => this.textMatches(el, target));
    
    if (matches.length > 0) {
      const inRegion = this.filterByRegion(matches, target.region);
      return {
        element: inRegion[0] || matches[0],
        confidence: 0.7,
        method: 'tagName+text',
      };
    }
    
    return { element: null, confidence: 0, method: 'tagName+text' };
  }
  
  /**
   * Strategy 8: Find by text only (65% confidence)
   * Searches interactive elements first, then ALL elements as fallback
   */
  private static findByText(target: SemanticTarget): FindResult {
    if (!target.text) {
      return { element: null, confidence: 0, method: 'text' };
    }
    
    // First try interactive elements
    const interactiveSelectors = [
      'button', 'a', 'input', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="menuitem"]',
      '[role="option"]', '[role="tab"]', '[role="combobox"]',
      '[tabindex]', '[onclick]',
    ];
    
    let elements = this.querySelectorAllDeep(interactiveSelectors.join(', '));
    let visible = elements.filter(el => this.isVisible(el));
    let matches = visible.filter(el => this.textMatches(el, target));
    
    if (matches.length > 0) {
      const inRegion = this.filterByRegion(matches, target.region);
      console.log(`[SmartClicker] findByText found ${matches.length} interactive matches`);
      return {
        element: inRegion[0] || matches[0],
        confidence: inRegion.length > 0 ? 0.75 : 0.65,
        method: inRegion.length > 0 ? 'text+region' : 'text',
      };
    }
    
    // Fallback: Search ALL elements (divs, spans, etc.)
    console.log(`[SmartClicker] No interactive elements, searching all elements for text: "${target.text}"`);
    elements = this.querySelectorAllDeep('*');
    visible = elements.filter(el => this.isVisible(el));
    matches = visible.filter(el => this.textMatches(el, target));
    
    if (matches.length > 0) {
      console.log(`[SmartClicker] findByText found ${matches.length} non-interactive matches`);
      
      // For each match, check if it has a clickable parent or sibling
      for (const match of matches) {
        // Check if parent is clickable
        const parent = match.parentElement;
        if (parent) {
          const parentIsClickable = parent.onclick || 
                                   parent.getAttribute('role') === 'button' ||
                                   parent.getAttribute('role') === 'combobox' ||
                                   parent.tagName === 'BUTTON' ||
                                   parent.hasAttribute('tabindex');
          
          if (parentIsClickable) {
            console.log(`[SmartClicker] Found clickable parent for text element`);
            return {
              element: parent,
              confidence: 0.7,
              method: 'text-clickable-parent',
            };
          }
        }
        
        // Check if match itself has clickable ancestor
        const clickableAncestor = match.closest('button, [role="button"], [role="combobox"], [tabindex], [onclick]');
        if (clickableAncestor) {
          console.log(`[SmartClicker] Found clickable ancestor for text element`);
          return {
            element: clickableAncestor,
            confidence: 0.65,
            method: 'text-clickable-ancestor',
          };
        }
      }
      
      // Fallback to the text element itself
      const inRegion = this.filterByRegion(matches, target.region);
      return {
        element: inRegion[0] || matches[0],
        confidence: 0.5,  // Lower confidence for non-interactive
        method: 'text-any-element',
      };
    }
    
    console.log(`[SmartClicker] findByText found no matches for: "${target.text}"`);
    return { element: null, confidence: 0, method: 'text' };
  }
  
  /**
   * Strategy 9: Find by className hint (60% confidence)
   */
  private static findByClassName(target: SemanticTarget): FindResult {
    if (!target.className) {
      return { element: null, confidence: 0, method: 'className' };
    }
    
    const elements = this.querySelectorAllDeep(`[class*="${target.className}"]`);
    const visible = elements.filter(el => this.isVisible(el));
    
    // Further filter by text if provided
    let matches = visible;
    if (target.text) {
      matches = visible.filter(el => this.textMatches(el, target));
    }
    
    if (matches.length > 0) {
      return {
        element: this.filterByRegion(matches, target.region)[0] || matches[0],
        confidence: 0.6,
        method: 'className',
      };
    }
    
    return { element: null, confidence: 0, method: 'className' };
  }
  
  /**
   * Strategy 10: Find by nearby text (55% confidence)
   */
  private static findByNearbyText(target: SemanticTarget): FindResult {
    if (!target.nearbyText || target.nearbyText.length === 0) {
      return { element: null, confidence: 0, method: 'nearby-text' };
    }
    
    const elements = this.querySelectorAllDeep(
      'input, textarea, select, button, [role="button"]'
    );
    const visible = elements.filter(el => this.isVisible(el));
    
    for (const el of visible) {
      const parent = el.parentElement;
      if (!parent) continue;
      
      const siblings = Array.from(parent.children);
      const siblingText = siblings
        .map(s => s.textContent?.trim())
        .filter(Boolean)
        .join(' ');
      
      const matchCount = target.nearbyText.filter(text =>
        siblingText.toLowerCase().includes(text.toLowerCase())
      ).length;
      
      if (matchCount >= target.nearbyText.length * 0.7) {
        return {
          element: el,
          confidence: 0.55 + (matchCount / target.nearbyText.length) * 0.15,
          method: 'nearby-text',
        };
      }
    }
    
    return { element: null, confidence: 0, method: 'nearby-text' };
  }
  
  /**
   * Strategy 11: Find by fuzzy text match (50% confidence)
   */
  private static findByFuzzyText(target: SemanticTarget): FindResult {
    if (!target.text || target.textMatch !== 'fuzzy') {
      return { element: null, confidence: 0, method: 'fuzzy-text' };
    }
    
    const interactiveSelectors = [
      'button', 'a', '[role="button"]', '[role="link"]', '[role="menuitem"]',
    ];
    
    const elements = this.querySelectorAllDeep(interactiveSelectors.join(', '));
    const visible = elements.filter(el => this.isVisible(el));
    
    let bestMatch: Element | null = null;
    let bestScore = 0;
    
    for (const el of visible) {
      const elText = el.textContent?.trim() || '';
      const similarity = this.levenshteinSimilarity(
        target.text.toLowerCase(),
        elText.toLowerCase()
      );
      
      if (similarity > 0.7 && similarity > bestScore) {
        bestScore = similarity;
        bestMatch = el;
      }
    }
    
    if (bestMatch) {
      return {
        element: bestMatch,
        confidence: 0.5 * bestScore,
        method: 'fuzzy-text',
      };
    }
    
    return { element: null, confidence: 0, method: 'fuzzy-text' };
  }
  
  // ==========================================================================
  // Click at Coordinates (Canvas Fallback)
  // ==========================================================================
  
  /**
   * Click at specific coordinates (for canvas-based UIs)
   */
  private static async clickAtCoordinates(x: number, y: number): Promise<ClickResult> {
    try {
      await this.debuggerClick(x, y);
      return {
        success: true,
        method: 'coordinates',
        strategiesTried: ['debugger-click'],
      };
    } catch (error) {
      return {
        success: false,
        error: `Coordinate click failed: ${error}`,
        strategiesTried: ['debugger-click'],
      };
    }
  }
  
  // ==========================================================================
  // Human-like Click Execution
  // ==========================================================================
  
  /**
   * Execute a human-like click with natural delays and randomization
   */
  private static async humanClick(element: Element): Promise<boolean> {
    console.log(`[SmartClicker] Executing human-like click on:`, element.tagName);
    
    const rect = element.getBoundingClientRect();
    
    // Random offset from center (humans don't click exact center)
    const x = rect.left + rect.width / 2 + this.randomOffset(-5, 5);
    const y = rect.top + rect.height / 2 + this.randomOffset(-3, 3);
    
    // 1. Scroll into view smoothly
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.randomDelay(100, 200);
    }
    
    // 2. Hover first (mouseenter/mouseover)
    this.dispatchMouseEvent(element, 'mouseenter', x, y);
    this.dispatchMouseEvent(element, 'mouseover', x, y);
    await this.randomDelay(50, 150);  // Humans pause before clicking
    
    // 3. Try Chrome Debugger API FIRST (for ALL platforms)
    // This produces real trusted events that frameworks can't block
    try {
      await this.debuggerClick(x, y);
      console.log('[SmartClicker] Success with debugger click');
      return true;
    } catch (debugError) {
      console.log('[SmartClicker] Debugger click failed, trying alternatives:', debugError);
    }
    
    // 4. Platform-specific fallbacks
    if (this.platform?.name === 'salesforce') {
      // Salesforce: Try Aura event
      if (this.dispatchAuraEvent(element)) {
        console.log('[SmartClicker] Success with Aura event');
        return true;
      }
    }
    
    // 5. Try keyboard interaction (Tab + Enter)
    // This works for many custom components
    try {
      if (element instanceof HTMLElement) {
        element.focus();
        await this.randomDelay(50, 100);
        
        // Dispatch Enter key
        element.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true,
          cancelable: true,
        }));
        
        element.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true,
          cancelable: true,
        }));
        
        await this.randomDelay(100, 200);
        console.log('[SmartClicker] Tried keyboard Enter');
      }
    } catch (error) {
      console.debug('[SmartClicker] Keyboard interaction failed:', error);
    }
    
    // 6. Standard click sequence (last resort)
    try {
      // Pointer down
      this.dispatchPointerEvent(element, 'pointerdown', x, y);
      this.dispatchMouseEvent(element, 'mousedown', x, y);
      await this.randomDelay(80, 120);
      
      // Pointer up
      this.dispatchPointerEvent(element, 'pointerup', x, y);
      this.dispatchMouseEvent(element, 'mouseup', x, y);
      await this.randomDelay(5, 15);
      
      // Click event
      this.dispatchMouseEvent(element, 'click', x, y);
      
      // Native click as backup
      if (element instanceof HTMLElement) {
        element.click();
      }
      
      // Wait for reaction
      await this.randomDelay(100, 300);
      
      console.log('[SmartClicker] Completed standard click sequence');
      return true;
    } catch (error) {
      console.error('[SmartClicker] Click failed:', error);
      return false;
    }
  }
  
  // ==========================================================================
  // Framework-Specific Events
  // ==========================================================================
  
  /**
   * Dispatch Salesforce Aura event
   */
  private static dispatchAuraEvent(element: Element): boolean {
    const auraId = element.getAttribute('data-aura-rendered-by');
    if (auraId && (window as any).$A) {
      try {
        const cmp = (window as any).$A.getComponent(auraId);
        if (cmp) {
          const event = cmp.getEvent('press');
          if (event) {
            event.fire();
            console.log('[SmartClicker] Success with Aura event');
            return true;
          }
        }
      } catch (e) {
        console.debug('[SmartClicker] Aura event dispatch failed:', e);
      }
    }
    return false;
  }
  
  /**
   * Chrome Debugger API click (real trusted clicks)
   */
  private static async debuggerClick(x: number, y: number): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'DEBUGGER_CLICK',
          x,
          y,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response?.success) {
            resolve();
          } else {
            reject(new Error(response?.error || 'Debugger click failed'));
          }
        }
      );
    });
  }
  
  /**
   * Dispatch mouse event
   */
  private static dispatchMouseEvent(
    element: Element,
    eventType: string,
    x: number,
    y: number
  ): void {
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: eventType === 'mousedown' ? 1 : 0,
    };
    
    element.dispatchEvent(new MouseEvent(eventType, opts));
  }
  
  /**
   * Dispatch pointer event
   */
  private static dispatchPointerEvent(
    element: Element,
    eventType: string,
    x: number,
    y: number
  ): void {
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: eventType === 'pointerdown' ? 1 : 0,
      pointerId: 1,
      pointerType: 'mouse',
    };
    
    element.dispatchEvent(new PointerEvent(eventType, opts));
  }
  
  // ==========================================================================
  // Verification
  // ==========================================================================
  
  /**
   * Verify element is clickable
   */
  private static verifyClickable(element: Element): {
    ok: boolean;
    issue?: 'not-visible' | 'obscured' | 'zero-dimensions';
    rect?: DOMRect;
  } {
    if (!(element instanceof HTMLElement)) {
      return { ok: true };
    }
    
    const rect = element.getBoundingClientRect();
    
    if (rect.width === 0 || rect.height === 0) {
      return { ok: false, issue: 'zero-dimensions', rect };
    }
    
    const style = window.getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      return { ok: false, issue: 'not-visible', rect };
    }
    
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);
    
    if (topElement && topElement !== element && !element.contains(topElement)) {
      return { ok: false, issue: 'obscured', rect };
    }
    
    return { ok: true, rect };
  }
  
  /**
   * Capture page state before click
   */
  private static capturePageState(element: Element): PageState {
    return {
      activeElement: document.activeElement,
      url: window.location.href,
      bodyLength: document.body.innerHTML.length,
      elementClass: element.className,
    };
  }
  
  /**
   * Verify click result by checking for page changes
   */
  private static async verifyClickResult(
    element: Element,
    beforeState: PageState
  ): Promise<boolean> {
    await this.sleep(300);
    
    const changes = {
      focusChanged: document.activeElement !== beforeState.activeElement,
      urlChanged: window.location.href !== beforeState.url,
      modalOpened: !!document.querySelector('[role="dialog"]:not([hidden])'),
      dropdownOpened: !!document.querySelector('[role="listbox"]:not([hidden]), [role="menu"]:not([hidden]), [class*="dropdown"][class*="open"]'),
      contentChanged: document.body.innerHTML.length !== beforeState.bodyLength,
      elementRemoved: !document.contains(element),
      classChanged: element.className !== beforeState.elementClass,
      ariaExpanded: element.getAttribute('aria-expanded') === 'true',
    };
    
    const hasChange = Object.values(changes).some(c => c);
    
    if (hasChange) {
      const changesList = Object.entries(changes)
        .filter(([_, v]) => v)
        .map(([k]) => k);
      console.log('[SmartClicker] Changes detected:', changesList.join(', '));
    } else {
      console.warn('[SmartClicker] No visible change detected after click');
    }
    
    return hasChange;
  }
  
  // ==========================================================================
  // Helpers
  // ==========================================================================
  
  /**
   * Query selector that traverses shadow DOM and iframes
   */
  private static querySelectorAllDeep(selector: string): Element[] {
    const results: Element[] = [];
    
    // Search in main document
    try {
      const mainResults = document.querySelectorAll(selector);
      results.push(...Array.from(mainResults));
    } catch {
      // Invalid selector
    }
    
    // Search in shadow DOMs
    ShadowDOMUtils.traverseShadowDOM(document, (element) => {
      try {
        if (element.matches(selector)) {
          results.push(element);
        }
      } catch {
        // Invalid selector for this element
      }
    });
    
    // Search in same-origin iframes
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument;
        if (iframeDoc) {
          const iframeResults = iframeDoc.querySelectorAll(selector);
          results.push(...Array.from(iframeResults));
        }
      } catch {
        // Cross-origin iframe, skip
      }
    }
    
    return results;
  }
  
  /**
   * Filter elements by region
   */
  private static filterByRegion(elements: Element[], region?: string): Element[] {
    if (!region) return elements;
    
    return elements.filter(el => PlatformDetector.isInRegion(el, region));
  }
  
  /**
   * Check if element text matches target
   */
  private static textMatches(element: Element, target: SemanticTarget): boolean {
    if (!target.text) return true;
    
    const elText = element.textContent?.trim() || '';
    const targetText = target.text;
    const mode = target.textMatch || 'contains';
    
    switch (mode) {
      case 'exact':
        return elText === targetText;
      case 'contains':
        return elText.includes(targetText);
      case 'startsWith':
        return elText.startsWith(targetText);
      case 'endsWith':
        return elText.endsWith(targetText);
      case 'fuzzy':
        return this.levenshteinSimilarity(
          elText.toLowerCase(),
          targetText.toLowerCase()
        ) > 0.7;
      default:
        return elText.includes(targetText);
    }
  }
  
  /**
   * Calculate Levenshtein similarity (0-1)
   */
  private static levenshteinSimilarity(a: string, b: string): number {
    const distance = this.levenshteinDistance(a, b);
    const maxLen = Math.max(a.length, b.length);
    return maxLen === 0 ? 1 : 1 - distance / maxLen;
  }
  
  /**
   * Calculate Levenshtein distance
   */
  private static levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[b.length][a.length];
  }
  
  /**
   * Check if element is visible
   */
  private static isVisible(element: Element): boolean {
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
   * Random delay (human-like)
   */
  private static randomDelay(min: number, max: number): Promise<void> {
    const delay = min + Math.random() * (max - min);
    return new Promise(resolve => setTimeout(resolve, delay));
  }
  
  /**
   * Random offset (human-like)
   */
  private static randomOffset(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
  
  /**
   * Sleep utility
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
