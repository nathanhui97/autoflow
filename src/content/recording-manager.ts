/**
 * RecordingManager - Manages event listeners and captures user interactions
 */

import { SelectorEngine } from './selector-engine';
import { LabelFinder } from './label-finder';
import { ElementContext } from './element-context';
import { ElementSimilarity } from './element-similarity';
import { ElementStateCapture } from './element-state';
import { ElementTextCapture } from './element-text';
import { WaitConditionDeterminer } from './wait-conditions';
import type { WorkflowStep } from '../types/workflow';

export class RecordingManager {
  private isRecording: boolean = false;
  private inputDebounceTimer: number | null = null;
  private clickHandler: ((event: MouseEvent) => void) | null = null;
  private inputHandler: ((event: Event) => void) | null = null;
  private changeHandler: ((event: Event) => void) | null = null;
  private currentUrl: string = window.location.href;
  private readonly DEBOUNCE_DELAY = 500; // 500ms debounce for input events
  private readonly CLICK_DEDUP_WINDOW = 2000; // 2 seconds - ignore duplicate clicks on same element within this window
  private lastInputStep: { selector: string; value: string } | null = null; // Track last input to prevent duplicates
  private lastClickStep: { selector: string; timestamp: number } | null = null; // Track last click to prevent duplicates
  private lastStep: WorkflowStep | null = null; // Track last step for wait condition determination

  /**
   * Start recording - attach event listeners
   */
  start(): void {
    if (this.isRecording) {
      console.warn('Recording already started');
      return;
    }

    this.isRecording = true;
    this.currentUrl = window.location.href;

    // Add visual indicator
    if (document.body) {
      document.body.setAttribute('data-ghostwriter-recording', 'true');
    }

    // Setup click handler - use bubble phase to avoid blocking clicks
    this.clickHandler = this.handleClick.bind(this);
    document.addEventListener('click', this.clickHandler, false);

    // Setup input handler - use bubble phase to avoid blocking input
    this.inputHandler = this.handleInput.bind(this);
    document.addEventListener('input', this.inputHandler, false);

    // Setup change handler (for select, checkbox, radio) - use bubble phase
    this.changeHandler = this.handleChange.bind(this);
    document.addEventListener('change', this.changeHandler, false);

    console.log('Recording started');
  }

  /**
   * Stop recording - remove event listeners
   */
  stop(): void {
    if (!this.isRecording) {
      return;
    }

    this.isRecording = false;

    // Remove visual indicator
    if (document.body) {
      document.body.removeAttribute('data-ghostwriter-recording');
    }

    // Remove event listeners
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, false);
      this.clickHandler = null;
    }

    if (this.inputHandler) {
      document.removeEventListener('input', this.inputHandler, false);
      this.inputHandler = null;
    }

    if (this.changeHandler) {
      document.removeEventListener('change', this.changeHandler, false);
      this.changeHandler = null;
    }

    // Clear any pending debounce timer
    if (this.inputDebounceTimer !== null) {
      clearTimeout(this.inputDebounceTimer);
      this.inputDebounceTimer = null;
    }

    // Clear last input step tracking
    this.lastInputStep = null;
    this.lastClickStep = null;
    this.lastStep = null;

    console.log('Recording stopped');
  }

  /**
   * Check if an element is an overlay (mask, backdrop, etc.)
   */
  private isOverlayElement(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    const className = element.className?.toString().toLowerCase() || '';
    const style = window.getComputedStyle(element as HTMLElement);
    
    // Check tag name
    if (tagName.includes('overlay') || tagName.includes('backdrop') || tagName.includes('mask')) {
      return true;
    }
    
    // Check class names
    if (className.includes('overlay') || className.includes('backdrop') || className.includes('mask') || className.includes('modal-backdrop')) {
      return true;
    }
    
    // Check styles - invisible elements with pointer-events: none are likely overlays
    if (style.pointerEvents === 'none' && style.position === 'absolute') {
      return true;
    }
    
    return false;
  }

  /**
   * Check if an element is interactive/clickable
   * IMPORTANT: Must be permissive for modern React/Angular apps that use div/span with click handlers
   */
  private isInteractiveElement(element: Element): boolean {
    const htmlEl = element as HTMLElement;
    const tagName = element.tagName.toLowerCase();
    const style = window.getComputedStyle(htmlEl);
    
    // 1. Widget elements are always interactive
    if (tagName.includes('widget') || tagName.includes('gs-report') || 
        element.className?.toString().includes('widget')) {
      return true;
    }
    
    // 2. Cursor pointer is a strong indicator (handles React/Angular div/span buttons)
    if (style.cursor === 'pointer' || style.cursor === 'grab') {
      return true;
    }
    
    // 3. Standard interactive tags
    if (['button', 'a', 'select', 'textarea'].includes(tagName) ||
        (tagName === 'input' && ['button', 'submit', 'checkbox', 'radio'].includes((htmlEl as HTMLInputElement).type))) {
      return true;
    }
    
    // 4. ARIA roles
    const role = element.getAttribute('role');
    if (role && ['button', 'link', 'menuitem', 'tab', 'option'].includes(role)) {
      return true;
    }
    
    // 5. Fallback: visible element with reasonable size (permissive)
    if (ElementStateCapture.isElementVisible(element)) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 10 && rect.height > 10) {
        return true; // Assume potentially interactive
      }
    }
    
    return false;
  }

  /**
   * Find the actual clickable element when clicking on an overlay
   * If the element is invisible (overlay), find the widget/container underneath
   * Returns null if no visible, interactive target can be found
   */
  private findActualClickableElement(element: Element, event: MouseEvent): Element | null {
    // Check if element is visible and not an overlay
    const isVisible = ElementStateCapture.isElementVisible(element);
    const isOverlay = this.isOverlayElement(element);
    
    // If visible and not an overlay, return as-is
    if (isVisible && !isOverlay && this.isInteractiveElement(element)) {
      return element;
    }

    // Element is invisible or is an overlay, try to find the actual clickable element

    // Strategy 1: Use elementsFromPoint to get ALL elements at click coordinates
    // This is more reliable than elementFromPoint (singular) which might return the overlay
    try {
      const elementsAtPoint = document.elementsFromPoint(event.clientX, event.clientY);
      
      // Filter for visible, interactive elements that are not overlays
      const visibleElements = elementsAtPoint.filter(el => {
        if (el === element) return false; // Skip the original overlay element
        if (this.isOverlayElement(el)) return false; // Skip other overlays
        if (!ElementStateCapture.isElementVisible(el)) return false; // Must be visible
        return this.isInteractiveElement(el); // Must be interactive
      });
      
      // Return the first valid element (topmost visible, interactive, non-overlay element)
      if (visibleElements.length > 0) {
        return visibleElements[0];
      }
    } catch (error) {
      console.warn('GhostWriter: Error using elementsFromPoint:', error);
    }

    // Strategy 2: Traverse up the DOM to find a parent widget/container element
    const widgetTags = ['gs-report-widget-element', 'gs-widget', 'widget', 'gridster-item'];
    let current: Element | null = element.parentElement;
    let level = 0;
    const maxLevels = 10;

    while (current && level < maxLevels && current !== document.body) {
      const tagName = current.tagName.toLowerCase();
      
      // Check if this is a widget/container element
      if (widgetTags.some(wt => tagName.includes(wt))) {
        // Check if it's visible and interactive
        if (ElementStateCapture.isElementVisible(current) && this.isInteractiveElement(current)) {
          return current;
        }
      }

      current = current.parentElement;
      level++;
    }

    // Strategy 3: If element is an overlay, search for widget elements in parent hierarchy
    if (isOverlay) {
      let parent: Element | null = element.parentElement;
      level = 0;
      while (parent && level < 5 && parent !== document.body) {
        // Look for widget elements within the parent
        for (const widgetTag of widgetTags) {
          const widget = parent.querySelector(widgetTag);
          if (widget && ElementStateCapture.isElementVisible(widget) && this.isInteractiveElement(widget)) {
            return widget;
          }
        }
        parent = parent.parentElement;
        level++;
      }
    }

    // Strategy 4: Try to find any visible, interactive element near the click point
    // This is a last resort - look for siblings or nearby elements
    try {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      // Try elementsFromPoint at the center of the element
      const elementsAtCenter = document.elementsFromPoint(centerX, centerY);
      for (const el of elementsAtCenter) {
        if (el === element) continue;
        if (this.isOverlayElement(el)) continue;
        if (ElementStateCapture.isElementVisible(el) && this.isInteractiveElement(el)) {
          return el;
        }
      }
    } catch (error) {
      // Ignore errors in fallback strategy
    }

    // If no better target found, return null (caller will skip recording)
    console.warn('GhostWriter: Could not find visible, interactive element for click. Original element:', element.tagName, 'Visible:', isVisible, 'Overlay:', isOverlay);
    return null;
  }

  private getActualElement(event: Event): Element | null {
    // Use composedPath to get the actual element (works across shadow boundaries)
    if ('composedPath' in event) {
      const path = event.composedPath();
      // First element in path is the actual target
      if (path.length > 0 && path[0] instanceof Element) {
        return path[0] as Element;
      }
    }
    
    // Fallback to target
    return (event.target as Element) || null;
  }


  /**
   * Handle click events
   * IMPORTANT: This handler must NOT block event propagation
   */
  private handleClick(event: MouseEvent): void {
    if (!this.isRecording) return;

    // Process asynchronously to avoid blocking the click event
    // Use requestIdleCallback or setTimeout(0) to ensure event can propagate
    const processClick = () => {
      try {
        // Get actual element (handles Shadow DOM)
        const actualElement = this.getActualElement(event);
        if (!actualElement) return;

        // Find the actual clickable element (handles overlay clicks)
        const clickableElement = this.findActualClickableElement(actualElement, event);
        
        // Final visibility check - never record invisible elements
        // This is the safety net: even if overlay piercing fails, we won't record bad data
        if (!clickableElement || !ElementStateCapture.isElementVisible(clickableElement)) {
          console.warn('GhostWriter: Skipping click on invisible element or no target found. Original element:', actualElement.tagName);
          return; // Don't record invisible elements
        }
        
        const target = clickableElement as HTMLElement;

        // Ignore clicks on extension UI elements
        if (target.closest && target.closest('[data-ghostwriter]')) {
          return;
        }

        const url = window.location.href;
        
        // Capture context and similarity information first (needed for container-scoped selectors)
        let context: import('./element-context').ElementContextData | null = null;
        let similarElements: Element[] = [];
        let uniquenessScore = 1.0;
        let disambiguationAttrs: Record<string, string> = {};
        let containerContext: import('./element-context').ContainerContext | null = null;
        
        // Capture context first to get container text
        try {
          context = ElementContext.captureContext(target);
          containerContext = ElementContext.captureContainerContext(target);
          similarElements = ElementSimilarity.findSimilarElements(target);
          uniquenessScore = ElementSimilarity.getUniquenessScore(target, similarElements);
          disambiguationAttrs = ElementSimilarity.getDisambiguationAttributes(target, similarElements);
        } catch (contextError) {
          console.warn('GhostWriter: Error capturing context, continuing with basic recording:', contextError);
        }
        
        // Generate selectors with container context (this is fast)
        let selectors: ReturnType<typeof SelectorEngine.generateSelectors>;
        try {
          const containerCtx = containerContext || context?.container;
          selectors = SelectorEngine.generateSelectors(target, containerCtx ? {
            text: containerCtx.text,
            type: containerCtx.type,
            selector: containerCtx.selector,
          } : undefined);
        } catch (selectorError) {
          console.warn('GhostWriter: Error generating selectors:', selectorError);
          return; // Can't record without selectors
        }

        // Deduplicate: Skip if this is the same click on the same element within the dedup window
        // Check BEFORE processing to avoid duplicate work
        const currentTimestamp = Date.now();
        if (this.lastClickStep && 
            this.lastClickStep.selector === selectors.primary &&
            (currentTimestamp - this.lastClickStep.timestamp) < this.CLICK_DEDUP_WINDOW) {
          console.log('GhostWriter: Skipping duplicate click on same element within', this.CLICK_DEDUP_WINDOW, 'ms');
          return; // Skip duplicate click
        }

        // Mark this click as pending to prevent duplicates during async processing
        // This prevents race conditions where two clicks pass the check before either records
        this.lastClickStep = {
          selector: selectors.primary,
          timestamp: currentTimestamp,
        };

        let elementState: import('../types/workflow').ElementState | null = null;
        let elementText: string | undefined = undefined;

        try {
          elementState = ElementStateCapture.captureElementState(target);
          elementText = ElementTextCapture.captureElementText(target);
        } catch (stateError) {
          console.warn('GhostWriter: Error capturing element state/text:', stateError);
        }

        // Check for navigation after a short delay
        setTimeout(() => {
          // Don't send step if recording was stopped
          if (!this.isRecording) return;

          // Double-check deduplication here (in case another click happened during the delay)
          const checkTimestamp = Date.now();
          if (this.lastClickStep && 
              this.lastClickStep.selector === selectors.primary &&
              this.lastClickStep.timestamp !== currentTimestamp && // Different click
              (checkTimestamp - this.lastClickStep.timestamp) < this.CLICK_DEDUP_WINDOW) {
            console.log('GhostWriter: Skipping duplicate click detected during async processing');
            return; // Skip duplicate click
          }

          const newUrl = window.location.href;
          const isNavigation = newUrl !== this.currentUrl;

          // Build step payload first (without wait conditions)
          // Ensure container text includes anchor text if available
          const finalContainerContext = containerContext || context?.container;
          if (selectors.anchorText && finalContainerContext) {
            // Update container context with anchor text (widget title)
            finalContainerContext.text = selectors.anchorText;
          }

          const stepPayload: WorkflowStep['payload'] = {
            selector: selectors.primary,
            fallbackSelectors: selectors.fallbacks.length > 0 ? selectors.fallbacks : [selectors.primary], // Ensure never empty
            xpath: selectors.xpath,
            timestamp: Date.now(),
            url: isNavigation ? this.currentUrl : url,
            shadowPath: selectors.shadowPath,
            elementState: elementState || undefined,
            elementText: elementText,
            context: context ? {
              siblings: context.siblings,
              parent: context.parent || undefined,
              ancestors: context.ancestors,
              container: finalContainerContext || undefined,
              position: context.position,
              surroundingText: context.surroundingText,
              uniqueAttributes: Object.keys(disambiguationAttrs).length > 0 ? disambiguationAttrs : undefined,
              formContext: context.formContext,
            } : undefined,
            similarity: similarElements.length > 0 ? {
              similarCount: similarElements.length,
              uniquenessScore,
              disambiguation: Object.keys(disambiguationAttrs).map(
                key => `${key}="${disambiguationAttrs[key]}"`
              ),
            } : undefined,
          };

          // Determine wait conditions based on this step and previous step
          const tempStep: WorkflowStep = {
            type: isNavigation ? 'NAVIGATION' : 'CLICK',
            payload: stepPayload,
          };
          const waitConditions = WaitConditionDeterminer.determineWaitConditions(tempStep, this.lastStep || undefined);
          stepPayload.waitConditions = waitConditions.length > 0 ? waitConditions : undefined;

          const step: WorkflowStep = {
            type: isNavigation ? 'NAVIGATION' : 'CLICK',
            payload: stepPayload,
          };

          this.sendStep(step);
          this.lastStep = step;
          // Update last click timestamp (already set earlier, but update with actual step timestamp)
          this.lastClickStep = {
            selector: selectors.primary,
            timestamp: stepPayload.timestamp,
          };

          if (isNavigation) {
            this.currentUrl = newUrl;
          }
        }, 100);
      } catch (error) {
        console.error('Error handling click:', error);
      }
    };

    // Use setTimeout with 0 delay to ensure event can propagate first
    // This prevents blocking the click event
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(processClick, { timeout: 100 });
    } else {
      setTimeout(processClick, 0);
    }
  }

  /**
   * Handle input events (debounced)
   */
  private handleInput(event: Event): void {
    if (!this.isRecording) return;

    try {
      // Get actual element (handles Shadow DOM)
      const actualElement = this.getActualElement(event);
      if (!actualElement) return;

      const target = actualElement as HTMLInputElement | HTMLTextAreaElement;
      if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA')) {
        return;
      }

      // Ignore password fields (though user chose to record all)
      // We'll still record them but could add filtering here if needed

      // Clear previous timer
      if (this.inputDebounceTimer !== null) {
        clearTimeout(this.inputDebounceTimer);
      }

      // Set new timer
      this.inputDebounceTimer = window.setTimeout(() => {
        // Don't capture if recording was stopped
        if (!this.isRecording) return;
        this.captureInputValue(target);
      }, this.DEBOUNCE_DELAY);
    } catch (error) {
      console.error('Error handling input:', error);
    }
  }

  /**
   * Handle change events (for select, checkbox, radio)
   */
  private handleChange(event: Event): void {
    if (!this.isRecording) return;

    try {
      // Get actual element (handles Shadow DOM)
      const actualElement = this.getActualElement(event);
      if (!actualElement) return;

      const target = actualElement as HTMLSelectElement | HTMLInputElement;
      if (!target) return;

      // Capture immediately (no debounce for change events)
      this.captureInputValue(target);
    } catch (error) {
      console.error('Error handling change:', error);
    }
  }

  /**
   * Capture the final value of an input element
   */
  private captureInputValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
    try {
      const selectors = SelectorEngine.generateSelectors(element, undefined);
      const label = LabelFinder.findLabel(element);
      const value = element.value || (element as HTMLInputElement).checked?.toString() || '';
      const url = window.location.href;

      // Deduplicate: Skip if this is the same input with the same value as the last recorded step
      if (this.lastInputStep && 
          this.lastInputStep.selector === selectors.primary && 
          this.lastInputStep.value === value) {
        return; // Skip duplicate input
      }

      // Capture context for input elements too (with error handling)
      let context: import('./element-context').ElementContextData | null = null;
      let similarElements: Element[] = [];
      let uniquenessScore = 1.0;
      let disambiguationAttrs: Record<string, string> = {};
      let elementState: import('../types/workflow').ElementState | null = null;

      try {
        context = ElementContext.captureContext(element);
        similarElements = SelectorEngine.findSimilarElements(element);
        uniquenessScore = ElementSimilarity.getUniquenessScore(element, similarElements);
        disambiguationAttrs = ElementSimilarity.getDisambiguationAttributes(element, similarElements);
        elementState = ElementStateCapture.captureElementState(element);
      } catch (contextError) {
        console.warn('GhostWriter: Error capturing input context, continuing with basic recording:', contextError);
        // Continue with basic recording even if context capture fails
        // Still try to capture state even if context fails
        try {
          elementState = ElementStateCapture.captureElementState(element);
        } catch (stateError) {
          console.warn('GhostWriter: Error capturing element state:', stateError);
        }
      }

      // Build step payload first (without wait conditions)
      const stepPayload: WorkflowStep['payload'] = {
        selector: selectors.primary,
        fallbackSelectors: selectors.fallbacks,
        xpath: selectors.xpath,
        label: label || undefined,
        value: value,
        timestamp: Date.now(),
        url: url,
        shadowPath: selectors.shadowPath,
        elementState: elementState || undefined,
        context: context ? {
          siblings: context.siblings,
          parent: context.parent || undefined,
          ancestors: context.ancestors,
          container: context.container || undefined,
          position: context.position,
          surroundingText: context.surroundingText,
          uniqueAttributes: Object.keys(disambiguationAttrs).length > 0 ? disambiguationAttrs : undefined,
          formContext: context.formContext,
        } : undefined,
        similarity: similarElements.length > 0 ? {
          similarCount: similarElements.length,
          uniquenessScore,
          disambiguation: Object.keys(disambiguationAttrs).map(
            key => `${key}="${disambiguationAttrs[key]}"`
          ),
        } : undefined,
      };

      // Determine wait conditions based on this step and previous step
      const tempStep: WorkflowStep = {
        type: 'INPUT',
        payload: stepPayload,
      };
      const waitConditions = WaitConditionDeterminer.determineWaitConditions(tempStep, this.lastStep || undefined);
      stepPayload.waitConditions = waitConditions.length > 0 ? waitConditions : undefined;

      const step: WorkflowStep = {
        type: 'INPUT',
        payload: stepPayload,
      };

      // Update last input step
      this.lastInputStep = {
        selector: selectors.primary,
        value: value,
      };

      this.sendStep(step);
      this.lastStep = step;
    } catch (error) {
      console.error('Error capturing input value:', error);
    }
  }

  /**
   * Send a workflow step to the side panel
   */
  private sendStep(step: WorkflowStep): void {
    try {
      chrome.runtime.sendMessage({
        type: 'RECORDED_STEP',
        payload: { step },
      } as import('../types/messages').RecordedStepMessage);
    } catch (error) {
      console.error('Error sending step:', error);
    }
  }

  /**
   * Get current recording state
   */
  getRecordingState(): boolean {
    return this.isRecording;
  }
}

