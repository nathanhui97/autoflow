/**
 * Agent Executor
 * 
 * Executes actions decided by the AI Agent.
 * This is the "hands" of the agent - it doesn't make decisions,
 * just executes what the AI tells it to do.
 * 
 * Provides these tools to the agent:
 * - click(target): Click an element by semantic description
 * - type(text): Type text into the focused element
 * - scroll(direction, amount): Scroll the page
 * - navigate(url): Navigate to a URL
 * - wait(duration): Wait for a specified time
 */

import type { AgentAction, AgentActionParams } from './ai-agent';
import { SmartClicker } from './smart-clicker';

// ============================================================================
// Types
// ============================================================================

export interface ExecutionResult {
  success: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Agent Executor
// ============================================================================

export class AgentExecutor {
  /**
   * Execute an action decided by the agent
   */
  static async execute(action: AgentAction): Promise<ExecutionResult> {
    console.log(`[AgentExecutor] Executing: ${action.type}`, action.params);

    try {
      switch (action.type) {
        case 'click':
          return await this.executeClick(action.params);
        
        case 'type':
          return await this.executeType(action.params);
        
        case 'scroll':
          return await this.executeScroll(action.params);
        
        case 'navigate':
          return await this.executeNavigate(action.params);
        
        case 'wait':
          return await this.executeWait(action.params);
        
        case 'done':
          return { success: true, details: { reason: 'Goal achieved' } };
        
        case 'fail':
          return { success: false, error: action.params.reason || 'Agent decided to fail' };
        
        default:
          return { success: false, error: `Unknown action type: ${action.type}` };
      }
    } catch (error) {
      console.error('[AgentExecutor] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute a click using semantic targeting
   */
  private static async executeClick(params: AgentActionParams): Promise<ExecutionResult> {
    const { target } = params;
    
    if (!target) {
      return { success: false, error: 'Click requires a semantic target' };
    }

    console.log(`[AgentExecutor] Clicking semantic target:`, target);

    // Use SmartClicker to find and click the element
    const result = await SmartClicker.click(target);

    if (result.success) {
      console.log(`[AgentExecutor] Click successful via ${result.method}`);
      return {
        success: true,
        details: {
          element: result.element?.tagName,
          text: result.element?.textContent?.substring(0, 100),
          method: result.method,
        },
      };
    } else {
      console.error(`[AgentExecutor] Click failed:`, result.error);
      return {
        success: false,
        error: result.error || 'Click failed',
        details: {
          strategiesTried: result.strategiesTried,
        },
      };
    }
  }

  /**
   * Type text into the focused element
   */
  private static async executeType(params: AgentActionParams): Promise<ExecutionResult> {
    const { text } = params;
    
    if (!text) {
      return { success: false, error: 'Type requires text parameter' };
    }

    // Find the active/focused element
    let activeElement = document.activeElement as HTMLElement | null;
    
    // If no focused element, try to find an input at recent click location
    if (!activeElement || activeElement === document.body) {
      return { success: false, error: 'No element is focused. Click on an input field first.' };
    }

    console.log(`[AgentExecutor] Typing into:`, activeElement.tagName);

    // Check if element accepts text input
    const isInput = activeElement.tagName === 'INPUT' || 
                    activeElement.tagName === 'TEXTAREA' ||
                    activeElement.getAttribute('contenteditable') === 'true';
    
    if (!isInput) {
      return { success: false, error: `Element ${activeElement.tagName} does not accept text input` };
    }

    // Clear existing value if it's an input/textarea
    if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
      // Select all and clear
      activeElement.select();
      activeElement.value = '';
      activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Type character by character (human-like)
    for (const char of text) {
      // KeyDown
      activeElement.dispatchEvent(new KeyboardEvent('keydown', {
        key: char,
        code: `Key${char.toUpperCase()}`,
        bubbles: true,
        cancelable: true,
      }));

      // KeyPress (deprecated but some frameworks still use it)
      activeElement.dispatchEvent(new KeyboardEvent('keypress', {
        key: char,
        code: `Key${char.toUpperCase()}`,
        bubbles: true,
        cancelable: true,
      }));

      // Update value
      if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
        activeElement.value += char;
      } else if (activeElement.getAttribute('contenteditable') === 'true') {
        activeElement.textContent = (activeElement.textContent || '') + char;
      }

      // Input event
      activeElement.dispatchEvent(new InputEvent('input', {
        data: char,
        inputType: 'insertText',
        bubbles: true,
        cancelable: true,
      }));

      // KeyUp
      activeElement.dispatchEvent(new KeyboardEvent('keyup', {
        key: char,
        code: `Key${char.toUpperCase()}`,
        bubbles: true,
        cancelable: true,
      }));

      // Small delay between characters
      await this.sleep(30 + Math.random() * 20);
    }

    // Trigger change event
    activeElement.dispatchEvent(new Event('change', { bubbles: true }));

    console.log(`[AgentExecutor] Typed: "${text}"`);

    return {
      success: true,
      details: {
        element: activeElement.tagName,
        text,
        length: text.length,
      },
    };
  }

  /**
   * Scroll the page
   */
  private static async executeScroll(params: AgentActionParams): Promise<ExecutionResult> {
    const { direction, amount } = params;
    const scrollAmount = amount || 300;

    let deltaX = 0;
    let deltaY = 0;

    switch (direction) {
      case 'up':
        deltaY = -scrollAmount;
        break;
      case 'down':
        deltaY = scrollAmount;
        break;
      case 'left':
        deltaX = -scrollAmount;
        break;
      case 'right':
        deltaX = scrollAmount;
        break;
      default:
        return { success: false, error: `Invalid scroll direction: ${direction}` };
    }

    window.scrollBy({
      left: deltaX,
      top: deltaY,
      behavior: 'smooth',
    });

    // Wait for scroll to complete
    await this.sleep(500);

    console.log(`[AgentExecutor] Scrolled ${direction} by ${scrollAmount}px`);

    return {
      success: true,
      details: {
        direction,
        amount: scrollAmount,
        newScrollPosition: {
          x: window.scrollX,
          y: window.scrollY,
        },
      },
    };
  }

  /**
   * Navigate to a URL
   */
  private static async executeNavigate(params: AgentActionParams): Promise<ExecutionResult> {
    const { url } = params;
    
    if (!url) {
      return { success: false, error: 'Navigate requires url parameter' };
    }

    console.log(`[AgentExecutor] Navigating to: ${url}`);

    // Validate URL first
    try {
      const currentOrigin = window.location.origin;
      const targetUrl = new URL(url, currentOrigin);
      
      if (targetUrl.origin !== currentOrigin) {
        return { 
          success: false, 
          error: 'Cross-origin navigation not supported' 
        };
      }

      // IMPORTANT: Return success BEFORE navigating
      // The navigation will close the message channel, so we must respond first
      // We'll use a small delay to ensure the response is sent, then navigate
      setTimeout(() => {
        console.log(`[AgentExecutor] Executing delayed navigation to: ${url}`);
        window.location.href = url;
      }, 100);

      return {
        success: true,
        details: { url, note: 'Navigation will occur after response is sent' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Invalid URL: ${url}`,
      };
    }
  }

  /**
   * Wait for a specified duration
   */
  private static async executeWait(params: AgentActionParams): Promise<ExecutionResult> {
    const { duration } = params;
    const waitTime = duration || 1000;

    console.log(`[AgentExecutor] Waiting ${waitTime}ms`);
    await this.sleep(waitTime);

    return {
      success: true,
      details: { duration: waitTime },
    };
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

