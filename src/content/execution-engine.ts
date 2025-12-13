/**
 * ExecutionEngine - Executes recorded workflow steps with Agentic behavior
 * Phase 3: Workflow execution with robust element finding
 * Phase 4: Enhanced with visual wait conditions and visual strategies
 * Phase 6: Agentic execution with AI Evidence (semantic anchors, clipboard metadata)
 */

import { ElementFinder } from './element-finder';
import { ElementStateCapture } from './element-state';
import { ExecutionTools } from './execution-tools';
import { TextMatcher } from './text-matcher';
import { VisualWait } from '../lib/visual-wait';
import { visualFlowTracker } from '../lib/visual-flow';
import { aiConfig } from '../lib/ai-config';
import type { WorkflowStep, WorkflowIntent, AIEvidence, WorkflowStepPayload } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import type { WorkflowVariables } from '../lib/variable-detector';

/**
 * Result from semantic element search
 */
interface SemanticSearchResult {
  element: Element;
  score: number;
  matchType: 'textLabel' | 'ariaLabel' | 'nearbyText' | 'combined';
}

export class ExecutionEngine {
  // Store variable values for the current execution
  private variableValues: Record<string, string> | undefined;
  private workflowVariables: WorkflowVariables | undefined;
  // Track current tab URL for multi-tab execution
  private currentTabUrl: string | null = null;

  // ============================================
  // AGENTIC METHODS - Finding, Resolving, Acting
  // ============================================

  /**
   * STRATEGY 1 + 2: Find target element with CSS selectors + semantic fallback
   * Uses aiEvidence.semanticAnchors for self-healing when CSS selectors fail
   * 
   * @param step - The workflow step containing element info
   * @param doc - Document to search in (defaults to current document)
   * @returns Found element or null
   */
  async findTargetElement(step: WorkflowStep, doc: Document = document): Promise<Element | null> {
    // Skip TAB_SWITCH steps - they don't have elements
    if (step.type === 'TAB_SWITCH' || !isWorkflowStepPayload(step.payload)) {
      return null;
    }

    const payload = step.payload;

    // STRATEGY 1: Use ElementFinder's comprehensive 12+ strategies
    // This includes CSS selectors, fallback selectors, fuzzy text, container-based, etc.
    const elementFromFinder = await ElementFinder.findElement(step, doc);
    if (elementFromFinder) {
      console.log('🎯 GhostWriter: Element found via ElementFinder strategies');
      return elementFromFinder;
    }

    // STRATEGY 2: Semantic Fallback using aiEvidence.semanticAnchors
    // Only try if CSS-based strategies failed AND we have semantic anchors
    if (payload.aiEvidence?.semanticAnchors) {
      console.log('🔍 GhostWriter: CSS strategies failed, trying semantic fallback...');
      const semanticResult = await this.findBySemanticAnchors(
        payload.aiEvidence.semanticAnchors,
        step,
        doc
      );
      
      if (semanticResult) {
        console.log(`✨ GhostWriter: Semantic fallback succeeded! Match type: ${semanticResult.matchType}, score: ${semanticResult.score.toFixed(2)}`);
        return semanticResult.element;
      }
    }

    // All strategies failed
    return null;
  }

  /**
   * Semantic fallback: Find element using aiEvidence.semanticAnchors
   * Uses XPath and fuzzy text matching for resilient element finding
   */
  private async findBySemanticAnchors(
    anchors: NonNullable<AIEvidence['semanticAnchors']>,
    step: WorkflowStep,
    doc: Document
  ): Promise<SemanticSearchResult | null> {
    const results: SemanticSearchResult[] = [];
    const tagHints = this.getTagHintsForStep(step);

    // Try textLabel first (highest confidence)
    if (anchors.textLabel) {
      const textResult = this.findBySemanticText(anchors.textLabel, tagHints, doc);
      if (textResult) {
        results.push({ ...textResult, matchType: 'textLabel' });
      }
    }

    // Try ariaLabel second
    if (anchors.ariaLabel) {
      const ariaResult = this.findBySemanticAria(anchors.ariaLabel, tagHints, doc);
      if (ariaResult) {
        results.push({ ...ariaResult, matchType: 'ariaLabel' });
      }
    }

    // Try nearbyText last (use for context verification)
    if (anchors.nearbyText && anchors.nearbyText.length > 0 && results.length > 0) {
      // Boost scores for elements that have matching nearby text
      for (const result of results) {
        const nearbyScore = this.scoreNearbyTextMatch(result.element, anchors.nearbyText);
        result.score = result.score * 0.7 + nearbyScore * 0.3; // Weighted combination
      }
    }

    // Return best result above threshold
    if (results.length > 0) {
      results.sort((a, b) => b.score - a.score);
      const best = results[0];
      if (best.score >= 0.6) {
        return best;
      }
    }

    return null;
  }

  /**
   * XPath search: Find elements containing textLabel
   * Uses fuzzy matching for resilience to minor text changes
   */
  private findBySemanticText(
    textLabel: string,
    tagHints: string[],
    doc: Document
  ): { element: Element; score: number } | null {
    let bestMatch: { element: Element; score: number } | null = null;
    const normalizedLabel = TextMatcher.normalize(textLabel);

    // Build tag selector for performance
    const tagSelector = tagHints.length > 0 ? tagHints.join(', ') : '*';
    const candidates = doc.querySelectorAll(tagSelector);

    for (const candidate of Array.from(candidates)) {
      // Skip hidden elements
      if (!ElementStateCapture.isElementVisible(candidate)) continue;

      // Get text from multiple sources
      const candidateText = this.getElementTextContent(candidate);
      if (!candidateText) continue;

      // Calculate similarity score
      const score = TextMatcher.similarityScore(normalizedLabel, candidateText);

      // Track best match
      if (score > 0.6 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { element: candidate, score };
      }
    }

    return bestMatch;
  }

  /**
   * XPath search: Find elements with matching aria-label
   * Supports both exact and fuzzy matching
   */
  private findBySemanticAria(
    ariaLabel: string,
    tagHints: string[],
    doc: Document
  ): { element: Element; score: number } | null {
    const normalizedAria = TextMatcher.normalize(ariaLabel);

    // Try exact match first using XPath
    try {
      const xpathResult = doc.evaluate(
        `//*[@aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`,
        doc,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      if (xpathResult.singleNodeValue) {
        const element = xpathResult.singleNodeValue as Element;
        if (ElementStateCapture.isElementVisible(element)) {
          return { element, score: 1.0 };
        }
      }
    } catch (e) {
      // XPath failed, continue with fallback
    }

    // Fuzzy match as fallback
    let bestMatch: { element: Element; score: number } | null = null;
    const tagSelector = tagHints.length > 0 ? tagHints.join(', ') : '[aria-label]';
    const candidates = doc.querySelectorAll(tagSelector);

    for (const candidate of Array.from(candidates)) {
      if (!ElementStateCapture.isElementVisible(candidate)) continue;

      const candidateAria = candidate.getAttribute('aria-label');
      if (!candidateAria) continue;

      const score = TextMatcher.similarityScore(normalizedAria, candidateAria);
      if (score > 0.7 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { element: candidate, score };
      }
    }

    return bestMatch;
  }

  /**
   * Score how well an element's surrounding text matches the nearbyText array
   */
  private scoreNearbyTextMatch(element: Element, nearbyText: string[]): number {
    if (nearbyText.length === 0) return 0;

    // Get text from parent and siblings
    const parent = element.parentElement;
    if (!parent) return 0;

    const parentText = TextMatcher.normalize(parent.textContent || '');
    let matchCount = 0;

    for (const nearby of nearbyText) {
      const normalizedNearby = TextMatcher.normalize(nearby);
      if (parentText.includes(normalizedNearby)) {
        matchCount++;
      }
    }

    return matchCount / nearbyText.length;
  }

  /**
   * Get combined text content from element (text, aria-label, title, etc.)
   */
  private getElementTextContent(element: Element): string {
    const textContent = element.textContent?.trim() || '';
    const ariaLabel = element.getAttribute('aria-label') || '';
    const title = element.getAttribute('title') || '';
    const placeholder = element.getAttribute('placeholder') || '';

    // Combine all text sources
    const combined = [textContent, ariaLabel, title, placeholder]
      .filter(t => t.length > 0)
      .join(' ');

    return TextMatcher.normalize(combined);
  }

  /**
   * Get tag hints for element search based on step type
   * Performance optimization: Only search relevant element types
   */
  private getTagHintsForStep(step: WorkflowStep): string[] {
    switch (step.type) {
      case 'CLICK':
        return ['button', 'a', 'input[type="button"]', 'input[type="submit"]', '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="option"]', 'div[onclick]', 'span[onclick]'];
      case 'INPUT':
        return ['input', 'textarea', 'select', '[contenteditable="true"]'];
      case 'KEYBOARD':
        return ['input', 'textarea', 'select', 'button', 'a', '[tabindex]', '[contenteditable="true"]'];
      default:
        return [];
    }
  }

  /**
   * Resolve input value with context awareness
   * Checks clipboardMetadata for data lineage and supports variable substitution
   * 
   * @param step - The workflow step
   * @returns Resolved value to use for input
   */
  resolveInputValue(step: WorkflowStep): string {
    if (!isWorkflowStepPayload(step.payload)) {
      return '';
    }

    const payload = step.payload;

    // Check for clipboard metadata (data lineage tracking)
    if (payload.aiEvidence?.clipboardMetadata) {
      const clipboardMeta = payload.aiEvidence.clipboardMetadata;
      console.log(`📋 GhostWriter: Context: Variable detected from source "${clipboardMeta.sourceSelector}"`);
      console.log(`   Copied value: "${clipboardMeta.copiedValue}"`);
      console.log(`   Timestamp: ${new Date(clipboardMeta.timestamp).toISOString()}`);
      
      // TODO: Future enhancement - dynamically fetch current value from sourceSelector
      // For now, we use the recorded value or variable substitution
    }

    // Check for variable substitution
    const variableValue = this.getVariableValueForStep(step);
    if (variableValue !== undefined) {
      console.log(`🔄 GhostWriter: Variable substitution: "${payload.value}" → "${variableValue}"`);
      return variableValue;
    }

    // Default: return recorded value
    return payload.value || '';
  }

  /**
   * Perform action on element with reliable event dispatching
   * Handles both click and input actions with framework-compatible events
   * 
   * @param element - Target element to interact with
   * @param actionType - Type of action ('click' | 'input' | 'keyboard')
   * @param step - The workflow step for context
   * @param value - Optional value for input actions
   */
  async performAction(
    element: Element,
    actionType: 'click' | 'input' | 'keyboard',
    step: WorkflowStep,
    value?: string
  ): Promise<void> {
    // Scroll element into view
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.delay(100);

    switch (actionType) {
      case 'click':
        await this.dispatchClickEvents(element, step);
        break;
      case 'input':
        await this.dispatchInputEvents(element, step, value || '');
        break;
      case 'keyboard':
        await this.dispatchKeyboardEvents(element, step);
        break;
    }
  }

  /**
   * Dispatch click events with proper sequence for React/Angular compatibility
   */
  private async dispatchClickEvents(element: Element, step: WorkflowStep): Promise<void> {
    if (!isWorkflowStepPayload(step.payload)) {
      throw new Error('GhostWriter: Invalid payload for click action');
    }

    const eventDetails = step.payload.eventDetails;
    const mouseButton = eventDetails?.mouseButton || 'left';
    const modifiers = eventDetails?.modifiers || {};

    // Create event options
    const eventOptions: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      button: mouseButton === 'left' ? 0 : mouseButton === 'right' ? 2 : 1,
      ctrlKey: modifiers.ctrl || false,
      shiftKey: modifiers.shift || false,
      altKey: modifiers.alt || false,
      metaKey: modifiers.meta || false,
    };

    // Get coordinates
    const rect = element.getBoundingClientRect();
    const x = eventDetails?.coordinates?.x || rect.left + rect.width / 2;
    const y = eventDetails?.coordinates?.y || rect.top + rect.height / 2;

    // Dispatch event sequence
    const eventSequence = eventDetails?.eventSequence || ['mousedown', 'focus', 'mouseup', 'click'];
    
    for (const eventType of eventSequence) {
      if (eventType === 'focus') {
        (element as HTMLElement).focus();
      } else if (eventType === 'mousedown' || eventType === 'mouseup' || eventType === 'click') {
        const event = new MouseEvent(eventType, {
          ...eventOptions,
          clientX: x,
          clientY: y,
        });
        element.dispatchEvent(event);
      }
      
      // Small delay between events
      await this.delay(10);
    }
  }

  /**
   * Dispatch input events with proper sequence for form and contenteditable elements
   */
  private async dispatchInputEvents(element: Element, step: WorkflowStep, value: string): Promise<void> {
    if (!isWorkflowStepPayload(step.payload)) {
      throw new Error('GhostWriter: Invalid payload for input action');
    }

    // Check if element is contenteditable
    const isContentEditable = (element as HTMLElement).isContentEditable || 
                              element.getAttribute('contenteditable') === 'true';
    
    const isStandardInput = element instanceof HTMLInputElement || 
                            element instanceof HTMLTextAreaElement || 
                            element instanceof HTMLSelectElement;

    // Focus element
    (element as HTMLElement).focus();
    await this.delay(50);

    if (isContentEditable) {
      // For contenteditable elements (e.g., Google Sheets)
      const htmlElement = element as HTMLElement;
      
      // Clear existing content
      htmlElement.textContent = '';
      htmlElement.innerText = '';
      
      // Set the value
      htmlElement.textContent = value;
      
      // Dispatch InputEvent (crucial for modern editors)
      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: value
      });
      htmlElement.dispatchEvent(inputEvent);
      
      // Dispatch Enter key if recorded (for Google Sheets cell commit)
      if (step.payload.keyboardDetails?.key === 'Enter') {
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true
        });
        htmlElement.dispatchEvent(enterEvent);
        
        const enterUpEvent = new KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true
        });
        htmlElement.dispatchEvent(enterUpEvent);
      }
      
      // Dispatch change event
      htmlElement.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (isStandardInput) {
      // For standard inputs, textareas, and selects
      if (element instanceof HTMLSelectElement) {
        element.value = value;
      } else {
        element.value = '';
        element.value = value;
      }

      // Dispatch input and change events
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Blur if needed
    if (step.payload.focusEvents?.needsBlur) {
      (element as HTMLElement).blur();
    }
  }

  /**
   * Dispatch keyboard events
   */
  private async dispatchKeyboardEvents(element: Element, step: WorkflowStep): Promise<void> {
    if (!isWorkflowStepPayload(step.payload)) {
      throw new Error('GhostWriter: Invalid payload for keyboard action');
    }

    // Focus element
    (element as HTMLElement).focus();
    await this.delay(50);

    const keyboardDetails = step.payload.keyboardDetails;
    if (!keyboardDetails) {
      throw new Error('GhostWriter: Keyboard step missing keyboardDetails');
    }

    const modifiers = keyboardDetails.modifiers || {};
    const key = keyboardDetails.key;
    const code = keyboardDetails.code;

    // Dispatch keydown event
    const keydownEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
      code,
      ctrlKey: modifiers.ctrl || false,
      shiftKey: modifiers.shift || false,
      altKey: modifiers.alt || false,
      metaKey: modifiers.meta || false,
    });
    element.dispatchEvent(keydownEvent);

    // Dispatch keyup event
    const keyupEvent = new KeyboardEvent('keyup', {
      bubbles: true,
      cancelable: true,
      key,
      code,
      ctrlKey: modifiers.ctrl || false,
      shiftKey: modifiers.shift || false,
      altKey: modifiers.alt || false,
      metaKey: modifiers.meta || false,
    });
    element.dispatchEvent(keyupEvent);
  }

  // ============================================
  // WORKFLOW EXECUTION
  // ============================================

  /**
   * Execute a workflow (backward compatible - defaults to exact replay)
   * @param steps - The workflow steps to execute
   * @param intent - Optional workflow intent for adaptive execution
   * @param variableValues - Optional variable values to substitute during execution
   * @param workflowVariables - Optional workflow variables metadata for step matching
   */
  async executeWorkflow(
    steps: WorkflowStep[], 
    intent?: WorkflowIntent,
    variableValues?: Record<string, string>,
    workflowVariables?: WorkflowVariables
  ): Promise<void> {
    // Store variable values for use in executeInput
    this.variableValues = variableValues;
    this.workflowVariables = workflowVariables;
    // Initialize current tab URL
    this.currentTabUrl = window.location.href;

    try {
      // Determine execution mode
      const mode = intent ? this.determineExecutionMode(intent) : 'exact';

      if (mode === 'adaptive' && intent?.policy) {
        // Use adaptive execution with Policy Object
        await this.adaptiveExecute(steps, intent);
      } else {
        // Use exact replay (backward compatible)
        await this.exactReplay(steps);
      }
    } finally {
      // Clear variable values after execution
      this.variableValues = undefined;
      this.workflowVariables = undefined;
      this.currentTabUrl = null;
    }
  }

  /**
   * Determine execution mode based on intent and confidence
   */
  determineExecutionMode(intent: WorkflowIntent, userPreference?: 'exact' | 'adaptive'): 'exact' | 'adaptive' {
    // User preference takes precedence
    if (userPreference) {
      return userPreference;
    }

    // Auto-detect: Use adaptive if confidence > 0.7 and pattern is repetitive/sequential
    if (intent.confidence > 0.7 && 
        (intent.pattern === 'repetitive' || intent.pattern === 'sequential') &&
        intent.policy) {
      return 'adaptive';
    }

    // Fallback to exact if confidence is low or pattern is unique
    return 'exact';
  }

  /**
   * Exact replay (original behavior)
   */
  private async exactReplay(steps: WorkflowStep[]): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      try {
        await this.executeStep(step);
      } catch (error) {
        console.error(`GhostWriter: Error executing step ${i + 1}:`, error);
        throw error;
      }

      // Wait between steps if needed
      if (isWorkflowStepPayload(step.payload) && step.payload.timing?.delayAfter) {
        await this.delay(step.payload.timing.delayAfter);
      }
    }
  }

  /**
   * Adaptive execution using Policy Object pattern
   */
  private async adaptiveExecute(steps: WorkflowStep[], intent: WorkflowIntent): Promise<void> {
    if (!intent.policy) {
      console.warn('GhostWriter: Adaptive mode requested but no policy provided, falling back to exact replay');
      return this.exactReplay(steps);
    }

    const policy = intent.policy;

    // Map Policy Object to execution strategy
    switch (policy.strategy) {
      case 'DYNAMIC_LOCATOR':
        await this.executeWithDynamicLocator(steps, policy);
        break;
      case 'HYBRID':
        await this.executeHybrid(steps);
        break;
      case 'EXACT_REPLAY':
      default:
        await this.exactReplay(steps);
        break;
    }
  }

  /**
   * Execute with dynamic locator (uses tools from ExecutionTools)
   */
  private async executeWithDynamicLocator(steps: WorkflowStep[], policy: import('../types/workflow').ExecutionPolicy): Promise<void> {
    // Map tool name to execution
    switch (policy.tool) {
      case 'find_grid_cell':
        await this.executeRepetitiveGridPattern(steps, policy.params);
        break;
      case 'find_next_empty_row':
        await this.executeRepetitiveRowPattern(steps, policy.params);
        break;
      case 'find_next_empty_column':
        await this.executeRepetitiveColumnPattern(steps, policy.params);
        break;
      case 'find_form_field':
        await this.executeSequentialFormPattern(steps, policy.params);
        break;
      case 'find_table_cell':
        await this.executeTablePattern(steps, policy.params);
        break;
      default:
        console.warn(`GhostWriter: Unknown tool "${policy.tool}", falling back to exact replay`);
        await this.exactReplay(steps);
        break;
    }
  }

  /**
   * Execute hybrid strategy (mix of exact and adaptive)
   */
  private async executeHybrid(steps: WorkflowStep[]): Promise<void> {
    // For hybrid, we execute some steps exactly and some adaptively
    // For now, fall back to exact replay (can be enhanced later)
    console.log('GhostWriter: Hybrid mode not fully implemented, using exact replay');
    await this.exactReplay(steps);
  }

  /**
   * Execute repetitive grid pattern (spreadsheet rows)
   */
  private async executeRepetitiveGridPattern(steps: WorkflowStep[], params: Record<string, any>): Promise<void> {
    // Find the cell using the tool
    const cell = ExecutionTools.findGridCell({
      columnHeader: params.columnHeader,
      condition: params.condition || 'is_empty',
      searchDirection: params.searchDirection || 'down',
      startRow: params.startRow,
      startColumn: params.startColumn,
    });

    if (!cell) {
      throw new Error('GhostWriter: Could not find grid cell using dynamic locator');
    }

    // Execute the first INPUT step on the found cell
    const inputStep = steps.find(s => s.type === 'INPUT');
    if (inputStep) {
      // Create a modified step with the found cell's selector
      const modifiedStep: WorkflowStep = {
        ...inputStep,
        payload: {
          ...inputStep.payload,
          selector: this.getElementSelector(cell),
        },
      };
      await this.executeInput(modifiedStep);
    }
  }

  /**
   * Execute repetitive row pattern
   */
  private async executeRepetitiveRowPattern(steps: WorkflowStep[], params: Record<string, any>): Promise<void> {
    // Find next empty row
    const nextRow = ExecutionTools.findNextEmptyRow({
      startRow: params.startRow,
      columnIndex: params.columnIndex,
    });

    if (nextRow === null) {
      throw new Error('GhostWriter: Could not find next empty row');
    }

    // For each INPUT step, find the cell in the next row
    for (const step of steps) {
      if (step.type === 'INPUT' && isWorkflowStepPayload(step.payload)) {
        const columnIndex = step.payload.context?.gridCoordinates?.columnIndex;
        if (columnIndex !== undefined) {
          // Find cell at (nextRow, columnIndex)
          const cell = ExecutionTools.findGridCell({
            condition: 'is_empty',
            searchDirection: 'down',
            startRow: nextRow,
            startColumn: columnIndex,
          });

          if (cell) {
            const modifiedStep: WorkflowStep = {
              ...step,
              payload: {
                ...step.payload,
                selector: this.getElementSelector(cell),
              },
            };
            await this.executeInput(modifiedStep);
            await this.delay(step.payload.timing?.delayAfter || 100);
          }
        } else {
          // Fall back to exact execution
          await this.executeStep(step);
        }
      } else {
        // Execute non-INPUT steps exactly
        await this.executeStep(step);
      }
    }
  }

  /**
   * Execute repetitive column pattern
   */
  private async executeRepetitiveColumnPattern(steps: WorkflowStep[], params: Record<string, any>): Promise<void> {
    // Similar to row pattern but for columns
    const nextColumn = ExecutionTools.findNextEmptyColumn({
      startColumn: params.startColumn,
      rowIndex: params.rowIndex,
    });

    if (nextColumn === null) {
      throw new Error('GhostWriter: Could not find next empty column');
    }

    // Execute steps with column adaptation
    for (const step of steps) {
      if (step.type === 'INPUT' && isWorkflowStepPayload(step.payload)) {
        const rowIndex = step.payload.context?.gridCoordinates?.rowIndex;
        if (rowIndex !== undefined) {
          const cell = ExecutionTools.findTableCell({
            rowIndex,
            columnIndex: nextColumn,
          });

          if (cell) {
            const modifiedStep: WorkflowStep = {
              ...step,
              payload: {
                ...step.payload,
                selector: this.getElementSelector(cell),
              },
            };
            await this.executeInput(modifiedStep);
            await this.delay(step.payload.timing?.delayAfter || 100);
          }
        } else {
          await this.executeStep(step);
        }
      } else {
        await this.executeStep(step);
      }
    }
  }

  /**
   * Execute sequential form pattern
   */
  private async executeSequentialFormPattern(steps: WorkflowStep[], params: Record<string, any>): Promise<void> {
    // Find form field using tool
    const field = ExecutionTools.findFormField({
      label: params.label,
      fieldOrder: params.fieldOrder,
    });

    if (field) {
      const inputStep = steps.find(s => s.type === 'INPUT');
      if (inputStep) {
        const modifiedStep: WorkflowStep = {
          ...inputStep,
          payload: {
            ...inputStep.payload,
            selector: this.getElementSelector(field),
          },
        };
        await this.executeInput(modifiedStep);
      }
    } else {
      // Fall back to exact replay
      await this.exactReplay(steps);
    }
  }

  /**
   * Execute table pattern
   */
  private async executeTablePattern(steps: WorkflowStep[], params: Record<string, any>): Promise<void> {
    const cell = ExecutionTools.findTableCell({
      rowIndex: params.rowIndex,
      columnIndex: params.columnIndex,
      headerRow: params.headerRow,
    });

    if (cell) {
      const clickStep = steps.find(s => s.type === 'CLICK');
      if (clickStep) {
        const modifiedStep: WorkflowStep = {
          ...clickStep,
          payload: {
            ...clickStep.payload,
            selector: this.getElementSelector(cell),
          },
        };
        await this.executeClick(modifiedStep);
      }
    } else {
      await this.exactReplay(steps);
    }
  }

  /**
   * Get selector for an element (simple fallback)
   */
  private getElementSelector(element: Element): string {
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.split(/\s+/).filter(c => c).map(c => `.${CSS.escape(c)}`).join('');
      if (classes) {
        return `${element.tagName.toLowerCase()}${classes}`;
      }
    }
    return element.tagName.toLowerCase();
  }

  /**
   * Execute a single step with Agentic behavior
   * Orchestrates: tab switching → wait conditions → find element → resolve value → perform action
   */
  private async executeStep(step: WorkflowStep): Promise<void> {
    // Check if tab switch is needed
    if (step.type === 'TAB_SWITCH') {
      const tabSwitchPayload = step.payload as import('../types/workflow').TabSwitchPayload;
      await this.switchToTabByUrl(tabSwitchPayload.toUrl);
      // Update current tab URL
      this.currentTabUrl = tabSwitchPayload.toUrl;
      // Wait for page to be ready
      await this.waitForPageReady();
      return;
    }

    // Check if step requires a different tab
    const stepTabUrl = 'tabUrl' in step.payload ? step.payload.tabUrl : undefined;
    if (stepTabUrl && stepTabUrl !== this.currentTabUrl) {
      // Switch to the required tab
      await this.switchToTabByUrl(stepTabUrl);
      this.currentTabUrl = stepTabUrl;
      // Wait for page to be ready after tab switch
      await this.waitForPageReady();
    }

    // Wait for conditions
    await this.waitForConditions(step);

    // Phase 4: Capture visual state before action (if visual analysis enabled)
    if (aiConfig.isVisualAnalysisEnabled()) {
      await visualFlowTracker.captureBeforeState();
    }

    // Execute action based on step type
    switch (step.type) {
      case 'CLICK':
        await this.executeClickAgentic(step);
        break;
      case 'INPUT':
        await this.executeInputAgentic(step);
        break;
      case 'KEYBOARD':
        await this.executeKeyboardAgentic(step);
        break;
      case 'NAVIGATION':
        // Navigation is handled by URL changes, not explicit execution
        break;
      case 'SCROLL':
        // Scroll steps are handled implicitly during execution
        break;
      default:
        console.warn(`GhostWriter: Unknown step type: ${(step as any).type}`);
    }

    // Phase 4: Wait for visual stability after action
    if (aiConfig.isVisualAnalysisEnabled()) {
      await this.waitForVisualStability(step);
      await visualFlowTracker.captureAfterState();
    }
  }

  /**
   * Execute CLICK step with Agentic element finding
   */
  private async executeClickAgentic(step: WorkflowStep): Promise<void> {
    // Step 1: Find target element using agentic methods
    const element = await this.findTargetElement(step);
    
    if (!element) {
      throw this.buildElementNotFoundError(step, 'CLICK');
    }

    // Step 2: Perform click action
    await this.performAction(element, 'click', step);
  }

  /**
   * Execute INPUT step with Agentic element finding and value resolution
   */
  private async executeInputAgentic(step: WorkflowStep): Promise<void> {
    // Step 1: Find target element
    const element = await this.findTargetElement(step);
    
    if (!element) {
      throw this.buildElementNotFoundError(step, 'INPUT');
    }

    if (!isWorkflowStepPayload(step.payload)) {
      throw new Error('GhostWriter: Invalid payload for INPUT step');
    }

    // Step 2: Validate element is inputtable
    const isContentEditable = (element as HTMLElement).isContentEditable || 
                              element.getAttribute('contenteditable') === 'true';
    const isStandardInput = element instanceof HTMLInputElement || 
                            element instanceof HTMLTextAreaElement || 
                            element instanceof HTMLSelectElement;

    if (!isStandardInput && !isContentEditable) {
      throw new Error(`GhostWriter: Element is not an input element: ${step.payload.selector}`);
    }

    // Step 3: Resolve input value (with clipboard context and variable substitution)
    const valueToUse = this.resolveInputValue(step);

    // Step 4: Perform input action
    await this.performAction(element, 'input', step, valueToUse);
  }

  /**
   * Execute KEYBOARD step with Agentic element finding
   */
  private async executeKeyboardAgentic(step: WorkflowStep): Promise<void> {
    // Step 1: Find target element
    const element = await this.findTargetElement(step);
    
    if (!element) {
      throw this.buildElementNotFoundError(step, 'KEYBOARD');
    }

    // Step 2: Perform keyboard action
    await this.performAction(element, 'keyboard', step);
  }

  /**
   * Build a detailed error message when element is not found
   * Includes semantic context for better debugging
   */
  private buildElementNotFoundError(step: WorkflowStep, actionType: string): Error {
    if (!isWorkflowStepPayload(step.payload)) {
      return new Error(`GhostWriter: Cannot execute ${actionType} step - invalid payload`);
    }

    const payload = step.payload;
    const parts: string[] = [
      `GhostWriter: Could not find element for ${actionType} step.`
    ];

    // Add selector info
    parts.push(`Primary selector: "${payload.selector}"`);
    parts.push(`Fallback selectors tried: ${payload.fallbackSelectors?.length || 0}`);

    // Add semantic context if available
    if (payload.aiEvidence?.semanticAnchors) {
      const anchors = payload.aiEvidence.semanticAnchors;
      if (anchors.textLabel) {
        parts.push(`Text label: "${anchors.textLabel}"`);
      }
      if (anchors.ariaLabel) {
        parts.push(`ARIA label: "${anchors.ariaLabel}"`);
      }
      if (anchors.nearbyText && anchors.nearbyText.length > 0) {
        parts.push(`Nearby text: "${anchors.nearbyText.slice(0, 2).join('", "')}"`);
      }
    }

    // Add element text if available
    if (payload.elementText) {
      parts.push(`Element text: "${payload.elementText}"`);
    }

    // Add helpful hint
    parts.push('Semantic self-healing was attempted but no matching element was found.');

    return new Error(parts.join(' | '));
  }

  /**
   * Wait for visual stability after an action
   */
  private async waitForVisualStability(step: WorkflowStep): Promise<void> {
    // For navigation or clicks that might trigger page changes, wait for stability
    if (step.type === 'NAVIGATION' || step.type === 'CLICK') {
      const waitResult = await VisualWait.waitForStability(300, 3000, 100);
      if (!waitResult.success) {
        console.log('🔄 GhostWriter: Visual stability timeout, continuing anyway');
      }
    }
    
    // For clicks on buttons that might trigger modals/dropdowns, wait briefly
    if (step.type === 'CLICK' && 
        isWorkflowStepPayload(step.payload) &&
        (step.payload.elementRole === 'button' || step.payload.context?.buttonContext)) {
      await VisualWait.waitForAnimationComplete(1000, 100, 50);
    }
  }

  /**
   * Wait for conditions before executing step
   */
  private async waitForConditions(step: WorkflowStep): Promise<void> {
    if (!isWorkflowStepPayload(step.payload)) {
      return; // TAB_SWITCH steps handle their own waiting
    }
    const conditions = step.payload.waitConditions || [];

    for (const condition of conditions) {
      switch (condition.type) {
        case 'element':
          if (condition.selector) {
            await this.waitForElement(condition.selector, condition.timeout || 5000);
          }
          break;
        case 'text':
          if (condition.text) {
            await this.waitForText(condition.text, condition.timeout || 5000);
          }
          break;
        case 'url':
          if (condition.url) {
            await this.waitForUrl(condition.url, condition.timeout || 5000);
          }
          break;
        case 'time':
          await this.delay(condition.timeout || 1000);
          break;
      }
    }
  }

  /**
   * Execute a CLICK step (legacy method - used by adaptive execution)
   * Delegates to agentic method for consistency
   */
  private async executeClick(step: WorkflowStep): Promise<void> {
    await this.executeClickAgentic(step);
  }

  /**
   * Get variable value for a step if it exists
   * Matches by step timestamp (stepId)
   */
  private getVariableValueForStep(step: WorkflowStep): string | undefined {
    if (!this.variableValues || !this.workflowVariables || !isWorkflowStepPayload(step.payload)) {
      return undefined;
    }

    // Find variable definition for this step by matching timestamp
    const stepId = String(step.payload.timestamp);
    const variableDef = this.workflowVariables.variables.find(
      v => String(v.stepId) === stepId
    );

    if (!variableDef) {
      return undefined;
    }

    // Return the user-provided value for this variable
    return this.variableValues[variableDef.variableName];
  }

  /**
   * Execute an INPUT step (legacy method - used by adaptive execution)
   * Delegates to agentic method for consistency
   */
  private async executeInput(step: WorkflowStep): Promise<void> {
    await this.executeInputAgentic(step);
  }

  /**
   * Execute a KEYBOARD step (legacy method - used by adaptive execution)
   * Delegates to agentic method for consistency
   */
  private async executeKeyboard(step: WorkflowStep): Promise<void> {
    await this.executeKeyboardAgentic(step);
  }

  /**
   * Wait for element to appear
   */
  private async waitForElement(selector: string, timeout: number): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const element = document.querySelector(selector);
        if (element && ElementStateCapture.isElementVisible(element)) {
          return;
        }
      } catch (e) {
        // Invalid selector, continue waiting
      }
      
      await this.delay(100);
    }
    
    throw new Error(`GhostWriter: Timeout waiting for element: ${selector}`);
  }

  /**
   * Wait for text to appear
   */
  private async waitForText(text: string, timeout: number): Promise<void> {
    const startTime = Date.now();
    const normalizedText = text.toLowerCase().trim();
    
    while (Date.now() - startTime < timeout) {
      const bodyText = document.body.textContent?.toLowerCase() || '';
      if (bodyText.includes(normalizedText)) {
        return;
      }
      
      await this.delay(100);
    }
    
    throw new Error(`GhostWriter: Timeout waiting for text: ${text}`);
  }

  /**
   * Wait for URL to match
   */
  private async waitForUrl(urlPattern: string, timeout: number): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const currentUrl = window.location.href;
      if (currentUrl.includes(urlPattern) || currentUrl === urlPattern) {
        return;
      }
      
      await this.delay(100);
    }
    
    throw new Error(`GhostWriter: Timeout waiting for URL: ${urlPattern}`);
  }

  /**
   * Switch to a tab by URL
   * Uses URL matching to find the correct tab (handles tab ID volatility)
   */
  private async switchToTabByUrl(targetUrl: string): Promise<void> {
    try {
      // Query all tabs
      const tabs = await chrome.tabs.query({});
      
      // Try exact URL match first
      let matchingTab = tabs.find(tab => tab.url === targetUrl);
      
      // If no exact match, try base URL match (ignore query params and hash)
      if (!matchingTab) {
        const targetBaseUrl = this.getBaseUrl(targetUrl);
        matchingTab = tabs.find(tab => {
          if (!tab.url) return false;
          const tabBaseUrl = this.getBaseUrl(tab.url);
          return tabBaseUrl === targetBaseUrl;
        });
      }
      
      // If still no match, try pattern matching (for dynamic query parameters)
      if (!matchingTab) {
        const targetPattern = this.getUrlPattern(targetUrl);
        matchingTab = tabs.find(tab => {
          if (!tab.url) return false;
          return this.matchesUrlPattern(tab.url, targetPattern);
        });
      }
      
      if (!matchingTab || !matchingTab.id) {
        throw new Error(`GhostWriter: No tab found matching URL: ${targetUrl}`);
      }
      
      // Switch to the matching tab
      await chrome.tabs.update(matchingTab.id, { active: true });
      
      // Wait for tab to become active
      await this.waitForTabActive(matchingTab.id);
      
      // Wait for content script to be ready
      await this.waitForContentScriptReady(matchingTab.id);
      
      console.log(`GhostWriter: Switched to tab ${matchingTab.id} (${targetUrl})`);
    } catch (error) {
      console.error('GhostWriter: Error switching tabs:', error);
      throw error;
    }
  }

  /**
   * Get base URL (without query params and hash)
   */
  private getBaseUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    } catch {
      // If URL parsing fails, return original
      return url.split('?')[0].split('#')[0];
    }
  }

  /**
   * Get URL pattern for matching (extracts domain and path)
   */
  private getUrlPattern(url: string): { domain: string; path: string } {
    try {
      const urlObj = new URL(url);
      return {
        domain: urlObj.host,
        path: urlObj.pathname,
      };
    } catch {
      // Fallback parsing
      const match = url.match(/^(https?:\/\/[^\/]+)(\/.*)?/);
      if (match) {
        return {
          domain: match[1],
          path: match[2] || '/',
        };
      }
      return { domain: '', path: '' };
    }
  }

  /**
   * Check if URL matches pattern (domain and path must match)
   */
  private matchesUrlPattern(url: string, pattern: { domain: string; path: string }): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.host === pattern.domain && urlObj.pathname === pattern.path;
    } catch {
      return false;
    }
  }

  /**
   * Wait for tab to become active
   */
  private async waitForTabActive(tabId: number, timeout: number = 5000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.active) {
          return;
        }
      } catch (error) {
        // Tab might not exist, continue waiting
      }
      
      await this.delay(100);
    }
    
    throw new Error(`GhostWriter: Timeout waiting for tab ${tabId} to become active`);
  }

  /**
   * Wait for content script to be ready in the target tab
   */
  private async waitForContentScriptReady(tabId: number, timeout: number = 10000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          type: 'PING',
          payload: { timestamp: Date.now() },
        });
        
        if (response?.success && response.data?.type === 'PONG') {
          return;
        }
      } catch (error) {
        // Content script might not be ready yet, continue waiting
      }
      
      await this.delay(200);
    }
    
    throw new Error(`GhostWriter: Timeout waiting for content script in tab ${tabId}`);
  }

  /**
   * Wait for page to be ready after tab switch
   */
  private async waitForPageReady(timeout: number = 5000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (document.readyState === 'complete') {
        // Additional wait for dynamic content
        await this.delay(500);
        return;
      }
      
      await this.delay(100);
    }
    
    // Don't throw error, just log warning
    console.warn('GhostWriter: Page ready state timeout, continuing anyway');
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
