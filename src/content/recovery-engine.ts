/**
 * RecoveryEngine - Deterministic recovery actions
 * 
 * When element resolution or verification fails, this engine executes
 * recovery actions to fix the state. No time-based delays - all actions
 * are deterministic and state-based.
 */

import type { Intent } from '../types/intent';
import type { LocatorBundle } from '../types/locator';
import { StateWaitEngine } from './state-wait-engine';

/**
 * Types of recovery actions
 */
export type RecoveryAction =
  | { kind: 'SCROLL_TARGET_INTO_VIEW'; target: string }
  | { kind: 'SCROLL_TO_TOP' }
  | { kind: 'SCROLL_TO_BOTTOM' }
  | { kind: 'DISMISS_COMMON_POPUPS' }
  | { kind: 'WAIT_FOR_PAGE_READY' }
  | { kind: 'SWITCH_TO_FRAME'; selector: string }
  | { kind: 'SWITCH_TO_MAIN_FRAME' }
  | { kind: 'REFRESH_ELEMENT_REFERENCES' }
  | { kind: 'RETRY_WITH_LOOSER_MATCH' }
  | { kind: 'CLICK_AWAY' }
  | { kind: 'PRESS_ESCAPE' }
  | { kind: 'FOCUS_BODY' }
  | { kind: 'ASK_USER'; message: string };

/**
 * Recovery strategy configuration
 */
export interface RecoveryStrategy {
  /** Maximum number of recovery attempts */
  maxAttempts: number;
  /** Ordered list of recovery actions to try */
  actions: RecoveryAction[];
}

/**
 * Context for recovery execution
 */
export interface RecoveryContext {
  /** Current locator bundle being resolved */
  locatorBundle?: LocatorBundle;
  /** Current intent */
  intent?: Intent;
  /** Number of attempts so far */
  attemptNumber: number;
  /** Last error message */
  lastError?: string;
  /** Callback for user intervention */
  onAskUser?: (message: string) => Promise<boolean>;
}

/**
 * Result of recovery action
 */
export interface RecoveryResult {
  /** Whether recovery action succeeded */
  success: boolean;
  /** Action that was executed */
  action: RecoveryAction;
  /** Time taken in ms */
  elapsedMs: number;
  /** Message about what happened */
  message?: string;
  /** Whether to retry resolution */
  shouldRetry: boolean;
}

/**
 * RecoveryEngine handles recovery when resolution or verification fails
 */
export class RecoveryEngine {
  /**
   * Execute a single recovery action
   */
  static async executeRecovery(
    action: RecoveryAction,
    context: RecoveryContext
  ): Promise<RecoveryResult> {
    const startTime = Date.now();
    
    try {
      switch (action.kind) {
        case 'SCROLL_TARGET_INTO_VIEW':
          return await this.scrollTargetIntoView(action.target, startTime);
          
        case 'SCROLL_TO_TOP':
          return await this.scrollToTop(startTime);
          
        case 'SCROLL_TO_BOTTOM':
          return await this.scrollToBottom(startTime);
          
        case 'DISMISS_COMMON_POPUPS':
          return await this.dismissCommonPopups(startTime);
          
        case 'WAIT_FOR_PAGE_READY':
          return await this.waitForPageReady(startTime);
          
        case 'SWITCH_TO_FRAME':
          return await this.switchToFrame(action.selector, startTime);
          
        case 'SWITCH_TO_MAIN_FRAME':
          return await this.switchToMainFrame(startTime);
          
        case 'REFRESH_ELEMENT_REFERENCES':
          return await this.refreshElementReferences(startTime);
          
        case 'RETRY_WITH_LOOSER_MATCH':
          return this.retryWithLooserMatch(startTime);
          
        case 'CLICK_AWAY':
          return await this.clickAway(startTime);
          
        case 'PRESS_ESCAPE':
          return await this.pressEscape(startTime);
          
        case 'FOCUS_BODY':
          return await this.focusBody(startTime);
          
        case 'ASK_USER':
          return await this.askUser(action.message, context, startTime);
          
        default:
          return {
            success: false,
            action,
            elapsedMs: Date.now() - startTime,
            message: 'Unknown recovery action',
            shouldRetry: false,
          };
      }
    } catch (error) {
      return {
        success: false,
        action,
        elapsedMs: Date.now() - startTime,
        message: error instanceof Error ? error.message : 'Recovery action failed',
        shouldRetry: false,
      };
    }
  }
  
  /**
   * Execute a recovery strategy
   */
  static async executeStrategy(
    strategy: RecoveryStrategy,
    context: RecoveryContext
  ): Promise<RecoveryResult[]> {
    const results: RecoveryResult[] = [];
    
    for (let attempt = 0; attempt < strategy.maxAttempts; attempt++) {
      for (const action of strategy.actions) {
        const result = await this.executeRecovery(action, {
          ...context,
          attemptNumber: attempt,
        });
        
        results.push(result);
        
        if (result.success && result.shouldRetry) {
          // Recovery succeeded and suggests retry
          return results;
        }
        
        if (action.kind === 'ASK_USER' && !result.success) {
          // User declined to continue
          return results;
        }
      }
    }
    
    return results;
  }
  
  /**
   * Get default recovery strategy for an intent
   */
  static getDefaultRecoveryForIntent(intent: Intent): RecoveryStrategy {
    switch (intent.kind) {
      case 'CLICK':
      case 'OPEN_ROW_ACTIONS':
        return {
          maxAttempts: 2,
          actions: [
            { kind: 'DISMISS_COMMON_POPUPS' },
            { kind: 'SCROLL_TARGET_INTO_VIEW', target: '' }, // Will be filled in
            { kind: 'WAIT_FOR_PAGE_READY' },
            { kind: 'RETRY_WITH_LOOSER_MATCH' },
          ],
        };
        
      case 'TYPE':
        return {
          maxAttempts: 2,
          actions: [
            { kind: 'FOCUS_BODY' },
            { kind: 'PRESS_ESCAPE' }, // Close any dropdowns
            { kind: 'WAIT_FOR_PAGE_READY' },
            { kind: 'SCROLL_TARGET_INTO_VIEW', target: '' },
          ],
        };
        
      case 'SELECT_DROPDOWN_OPTION':
        return {
          maxAttempts: 2,
          actions: [
            { kind: 'WAIT_FOR_PAGE_READY' },
            { kind: 'SCROLL_TARGET_INTO_VIEW', target: '' },
            { kind: 'RETRY_WITH_LOOSER_MATCH' },
          ],
        };
        
      case 'NAVIGATE':
        return {
          maxAttempts: 1,
          actions: [
            { kind: 'WAIT_FOR_PAGE_READY' },
          ],
        };
        
      case 'SUBMIT_FORM':
        return {
          maxAttempts: 2,
          actions: [
            { kind: 'SCROLL_TARGET_INTO_VIEW', target: '' },
            { kind: 'WAIT_FOR_PAGE_READY' },
            { kind: 'DISMISS_COMMON_POPUPS' },
          ],
        };
        
      default:
        return {
          maxAttempts: 1,
          actions: [
            { kind: 'WAIT_FOR_PAGE_READY' },
          ],
        };
    }
  }
  
  // ============ Recovery action implementations ============
  
  private static async scrollTargetIntoView(
    target: string,
    startTime: number
  ): Promise<RecoveryResult> {
    const action: RecoveryAction = { kind: 'SCROLL_TARGET_INTO_VIEW', target };
    
    if (!target) {
      return {
        success: false,
        action,
        elapsedMs: Date.now() - startTime,
        message: 'No target specified for scroll',
        shouldRetry: false,
      };
    }
    
    try {
      const element = document.querySelector(target);
      if (element) {
        try {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Wait for scroll to complete
          await this.sleep(500);
          
          return {
            success: true,
            action,
            elapsedMs: Date.now() - startTime,
            message: `Scrolled "${target}" into view`,
            shouldRetry: true,
          };
        } catch (e) {
          // Page error during scroll - return failure but don't throw
          return {
            success: false,
            action,
            elapsedMs: Date.now() - startTime,
            message: 'Scroll triggered page error',
            shouldRetry: false,
          };
        }
      }
    } catch (e) {
      // Invalid selector or other error
    }
    
    return {
      success: false,
      action,
      elapsedMs: Date.now() - startTime,
      message: `Could not find element "${target}" to scroll`,
      shouldRetry: false,
    };
  }
  
  private static async scrollToTop(startTime: number): Promise<RecoveryResult> {
    const action: RecoveryAction = { kind: 'SCROLL_TO_TOP' };
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await this.sleep(300);
    
    return {
      success: true,
      action,
      elapsedMs: Date.now() - startTime,
      message: 'Scrolled to top of page',
      shouldRetry: true,
    };
  }
  
  private static async scrollToBottom(startTime: number): Promise<RecoveryResult> {
    const action: RecoveryAction = { kind: 'SCROLL_TO_BOTTOM' };
    
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    await this.sleep(300);
    
    return {
      success: true,
      action,
      elapsedMs: Date.now() - startTime,
      message: 'Scrolled to bottom of page',
      shouldRetry: true,
    };
  }
  
  private static async dismissCommonPopups(startTime: number): Promise<RecoveryResult> {
    const action: RecoveryAction = { kind: 'DISMISS_COMMON_POPUPS' };
    let dismissed = 0;
    
    // Common close button selectors
    const closeSelectors = [
      '[aria-label="Close"]',
      '[aria-label="close"]',
      '[aria-label="Dismiss"]',
      '.close-button',
      '.modal-close',
      '.popup-close',
      'button[class*="close"]',
      '[data-dismiss="modal"]',
      '.MuiDialog-root button[aria-label="close"]',
    ];
    
    for (const selector of closeSelectors) {
      try {
        const buttons = document.querySelectorAll(selector);
        for (const button of Array.from(buttons)) {
          if (button instanceof HTMLElement && this.isVisible(button)) {
            try {
              button.click();
              dismissed++;
              await this.sleep(100);
            } catch (e) {
              // Page error during click - ignore and continue
              console.warn('Recovery: Error clicking close button:', e);
            }
          }
        }
      } catch (e) {
        // Invalid selector
      }
    }
    
    // Also try pressing Escape (wrap in try-catch)
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch (e) {
      console.warn('Recovery: Error pressing Escape:', e);
    }
    
    // Click on modal backdrops (wrap in try-catch)
    try {
      const backdrops = document.querySelectorAll(
        '.modal-backdrop, .MuiBackdrop-root, [class*="overlay"]'
      );
      for (const backdrop of Array.from(backdrops)) {
        if (backdrop instanceof HTMLElement && this.isVisible(backdrop)) {
          try {
            backdrop.click();
            dismissed++;
            await this.sleep(100);
          } catch (e) {
            console.warn('Recovery: Error clicking backdrop:', e);
          }
        }
      }
    } catch (e) {
      console.warn('Recovery: Error finding backdrops:', e);
    }
    
    return {
      success: true,
      action,
      elapsedMs: Date.now() - startTime,
      message: `Dismissed ${dismissed} popup(s)`,
      shouldRetry: dismissed > 0,
    };
  }
  
  private static async waitForPageReady(startTime: number): Promise<RecoveryResult> {
    const action: RecoveryAction = { kind: 'WAIT_FOR_PAGE_READY' };
    
    const result = await StateWaitEngine.waitForPageReady(10000);
    
    return {
      success: result.success,
      action,
      elapsedMs: Date.now() - startTime,
      message: result.success ? 'Page is ready' : 'Page ready timeout',
      shouldRetry: result.success,
    };
  }
  
  private static async switchToFrame(
    selector: string,
    startTime: number
  ): Promise<RecoveryResult> {
    const action: RecoveryAction = { kind: 'SWITCH_TO_FRAME', selector };
    
    try {
      const iframe = document.querySelector(selector) as HTMLIFrameElement;
      if (iframe && iframe.contentDocument) {
        // Store reference to iframe's document
        // Note: Actual frame switching is handled by the execution engine
        return {
          success: true,
          action,
          elapsedMs: Date.now() - startTime,
          message: `Ready to switch to frame "${selector}"`,
          shouldRetry: true,
        };
      }
    } catch (e) {
      // Cross-origin or other error
    }
    
    return {
      success: false,
      action,
      elapsedMs: Date.now() - startTime,
      message: `Could not access frame "${selector}"`,
      shouldRetry: false,
    };
  }
  
  private static async switchToMainFrame(startTime: number): Promise<RecoveryResult> {
    const action: RecoveryAction = { kind: 'SWITCH_TO_MAIN_FRAME' };
    
    // In content script context, we're always in a specific frame
    // This action signals the execution engine to switch
    return {
      success: true,
      action,
      elapsedMs: Date.now() - startTime,
      message: 'Ready to switch to main frame',
      shouldRetry: true,
    };
  }
  
  private static async refreshElementReferences(startTime: number): Promise<RecoveryResult> {
    const action: RecoveryAction = { kind: 'REFRESH_ELEMENT_REFERENCES' };
    
    // Wait for any pending DOM updates
    await StateWaitEngine.waitForDOMStable(200, 2000);
    
    // Force a layout reflow
    void document.body.offsetHeight;
    
    return {
      success: true,
      action,
      elapsedMs: Date.now() - startTime,
      message: 'Element references refreshed',
      shouldRetry: true,
    };
  }
  
  private static retryWithLooserMatch(startTime: number): RecoveryResult {
    const action: RecoveryAction = { kind: 'RETRY_WITH_LOOSER_MATCH' };
    
    // This is a signal to the resolver to use looser matching
    return {
      success: true,
      action,
      elapsedMs: Date.now() - startTime,
      message: 'Will retry with looser matching thresholds',
      shouldRetry: true,
    };
  }
  
  private static async clickAway(startTime: number): Promise<RecoveryResult> {
    const action: RecoveryAction = { kind: 'CLICK_AWAY' };
    
    // Click on body to dismiss any open popups/dropdowns
    document.body.click();
    await this.sleep(100);
    
    return {
      success: true,
      action,
      elapsedMs: Date.now() - startTime,
      message: 'Clicked away from current element',
      shouldRetry: true,
    };
  }
  
  private static async pressEscape(startTime: number): Promise<RecoveryResult> {
    const action: RecoveryAction = { kind: 'PRESS_ESCAPE' };
    
    // Dispatch Escape key
    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    
    document.activeElement?.dispatchEvent(escapeEvent);
    document.dispatchEvent(escapeEvent);
    
    await this.sleep(100);
    
    return {
      success: true,
      action,
      elapsedMs: Date.now() - startTime,
      message: 'Pressed Escape key',
      shouldRetry: true,
    };
  }
  
  private static async focusBody(startTime: number): Promise<RecoveryResult> {
    const action: RecoveryAction = { kind: 'FOCUS_BODY' };
    
    // Remove focus from current element
    (document.activeElement as HTMLElement)?.blur?.();
    document.body.focus();
    
    await this.sleep(50);
    
    return {
      success: true,
      action,
      elapsedMs: Date.now() - startTime,
      message: 'Focused body element',
      shouldRetry: true,
    };
  }
  
  private static async askUser(
    message: string,
    context: RecoveryContext,
    startTime: number
  ): Promise<RecoveryResult> {
    const action: RecoveryAction = { kind: 'ASK_USER', message };
    
    if (context.onAskUser) {
      const shouldContinue = await context.onAskUser(message);
      
      return {
        success: shouldContinue,
        action,
        elapsedMs: Date.now() - startTime,
        message: shouldContinue ? 'User approved continuation' : 'User declined continuation',
        shouldRetry: shouldContinue,
      };
    }
    
    // No callback provided, can't ask user
    return {
      success: false,
      action,
      elapsedMs: Date.now() - startTime,
      message: 'No user callback available',
      shouldRetry: false,
    };
  }
  
  // ============ Helper methods ============
  
  private static isVisible(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    
    const style = window.getComputedStyle(element);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    
    return true;
  }
  
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

