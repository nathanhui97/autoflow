/**
 * ExecutionEngine - Executes recorded workflow steps
 * Phase 3: Workflow execution with robust element finding
 */

import { ElementFinder } from './element-finder';
import { ElementStateCapture } from './element-state';
import { ExecutionTools } from './execution-tools';
import type { WorkflowStep, WorkflowIntent } from '../types/workflow';

export class ExecutionEngine {
  /**
   * Execute a workflow (backward compatible - defaults to exact replay)
   */
  async executeWorkflow(steps: WorkflowStep[], intent?: WorkflowIntent): Promise<void> {
    // Determine execution mode
    const mode = intent ? this.determineExecutionMode(intent) : 'exact';

    if (mode === 'adaptive' && intent?.policy) {
      // Use adaptive execution with Policy Object
      await this.adaptiveExecute(steps, intent);
    } else {
      // Use exact replay (backward compatible)
      await this.exactReplay(steps);
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
      if (step.payload.timing?.delayAfter) {
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
      if (step.type === 'INPUT') {
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
      if (step.type === 'INPUT') {
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
   * Execute a single step
   */
  private async executeStep(step: WorkflowStep): Promise<void> {
    // Wait for conditions
    await this.waitForConditions(step);

    switch (step.type) {
      case 'CLICK':
        await this.executeClick(step);
        break;
      case 'INPUT':
        await this.executeInput(step);
        break;
      case 'KEYBOARD':
        await this.executeKeyboard(step);
        break;
      case 'NAVIGATION':
        // Navigation is handled by URL changes, not explicit execution
        break;
      default:
        console.warn(`GhostWriter: Unknown step type: ${(step as any).type}`);
    }
  }

  /**
   * Wait for conditions before executing step
   */
  private async waitForConditions(step: WorkflowStep): Promise<void> {
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
   * Execute a CLICK step
   */
  private async executeClick(step: WorkflowStep): Promise<void> {
    const element = await ElementFinder.findElement(step);
    
    if (!element) {
      throw new Error(
        `GhostWriter: Could not find element for ${step.type} step. ` +
        `Tried ${step.payload.fallbackSelectors?.length || 0} selectors and AI recovery (single multimodal request via Supabase). ` +
        `Selector: ${step.payload.selector}`
      );
    }

    // Scroll element into view if needed
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.delay(100); // Small delay after scroll

    // Dispatch full event sequence for React/Angular compatibility
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
   * Execute an INPUT step
   */
  private async executeInput(step: WorkflowStep): Promise<void> {
    const element = await ElementFinder.findElement(step);
    
    if (!element) {
      throw new Error(
        `GhostWriter: Could not find element for ${step.type} step. ` +
        `Tried ${step.payload.fallbackSelectors?.length || 0} selectors and AI recovery (single multimodal request via Supabase). ` +
        `Selector: ${step.payload.selector}`
      );
    }

    // Check if element is contenteditable
    const isContentEditable = (element as HTMLElement).isContentEditable || 
                              element.getAttribute('contenteditable') === 'true';
    
    const isStandardInput = element instanceof HTMLInputElement || 
                            element instanceof HTMLTextAreaElement || 
                            element instanceof HTMLSelectElement;

    if (!isStandardInput && !isContentEditable) {
      throw new Error(`GhostWriter: Element is not an input element: ${step.payload.selector}`);
    }

    // Scroll element into view
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.delay(100);

    // Focus element
    (element as HTMLElement).focus();
    await this.delay(50);

    if (isContentEditable) {
      // For contenteditable elements (e.g., Google Sheets), use InputEvent with inputType
      const htmlElement = element as HTMLElement;
      
      // Clear existing content
      htmlElement.textContent = '';
      htmlElement.innerText = '';
      
      // Set the value
      htmlElement.textContent = step.payload.value || '';
      
      // Dispatch InputEvent (crucial for modern editors like Google Sheets)
      // This triggers formula calculations and data validation
      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: step.payload.value || ''
      });
      htmlElement.dispatchEvent(inputEvent);
      
      // Dispatch Enter key if it was recorded to commit the cell
      // This is the only way to make the cell "Save" in Google Sheets
      if (step.payload.keyboardDetails?.key === 'Enter') {
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true
        });
        htmlElement.dispatchEvent(enterEvent);
        
        // Also dispatch keyup for completeness
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
      // Clear existing value
      if (element instanceof HTMLSelectElement) {
        // For selects, set value directly
        element.value = step.payload.value || '';
      } else {
        // For inputs and textareas, clear and set value
        element.value = '';
        element.value = step.payload.value || '';
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
   * Execute a KEYBOARD step
   */
  private async executeKeyboard(step: WorkflowStep): Promise<void> {
    const element = await ElementFinder.findElement(step);
    
    if (!element) {
      throw new Error(`GhostWriter: Could not find element for keyboard step: ${step.payload.selector}`);
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
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
