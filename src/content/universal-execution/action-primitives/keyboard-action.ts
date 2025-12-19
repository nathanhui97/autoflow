/**
 * Keyboard Action Primitive
 * 
 * Handles keyboard interactions like Enter, Tab, Escape, etc.
 */

import type { ActionResult } from '../../../types/universal-types';

// ============================================================================
// Main Keyboard Execution
// ============================================================================

/**
 * Execute a keyboard action
 */
export async function executeKeyboardAction(
  element: Element,
  key: string,
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}
): Promise<ActionResult> {
  const startTime = Date.now();
  const strategiesTried: string[] = [];

  try {
    // Focus element first
    if (element instanceof HTMLElement) {
      element.focus();
      await sleep(30);
    }

    strategiesTried.push('keydown');

    // Build keyboard event options
    const eventOptions: KeyboardEventInit = {
      bubbles: true,
      cancelable: true,
      key: key,
      code: getKeyCode(key),
      keyCode: getKeyCodeNumber(key),
      ctrlKey: modifiers.ctrl || false,
      shiftKey: modifiers.shift || false,
      altKey: modifiers.alt || false,
      metaKey: modifiers.meta || false,
    };

    // Dispatch keydown
    const keydownEvent = new KeyboardEvent('keydown', eventOptions);
    element.dispatchEvent(keydownEvent);
    await sleep(20);

    // For character keys, also dispatch keypress
    if (key.length === 1) {
      strategiesTried.push('keypress');
      element.dispatchEvent(new KeyboardEvent('keypress', eventOptions));
      await sleep(10);
    }

    // Dispatch keyup
    strategiesTried.push('keyup');
    element.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
    await sleep(10);

    return {
      success: true,
      actionType: 'keyboard',
      elapsedMs: Date.now() - startTime,
      successfulStrategy: 'keyboard-event',
      strategiesTried,
    };

  } catch (error) {
    return {
      success: false,
      actionType: 'keyboard',
      elapsedMs: Date.now() - startTime,
      strategiesTried,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Press a single key
 */
export async function pressKey(
  key: string,
  target: Element = document.activeElement || document.body
): Promise<void> {
  const eventOptions: KeyboardEventInit = {
    bubbles: true,
    cancelable: true,
    key: key,
    code: getKeyCode(key),
    keyCode: getKeyCodeNumber(key),
  };

  target.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
  await sleep(10);
  target.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
}

/**
 * Press a key sequence (e.g., for keyboard navigation)
 */
export async function pressKeySequence(
  keys: string[],
  target: Element = document.activeElement || document.body,
  delayBetween: number = 50
): Promise<void> {
  for (const key of keys) {
    await pressKey(key, target);
    await sleep(delayBetween);
  }
}

/**
 * Press Enter key
 */
export async function pressEnter(target?: Element): Promise<void> {
  await pressKey('Enter', target || document.activeElement || document.body);
}

/**
 * Press Escape key
 */
export async function pressEscape(): Promise<void> {
  await pressKey('Escape', document.body);
}

/**
 * Press Tab key
 */
export async function pressTab(target?: Element, shift: boolean = false): Promise<void> {
  const eventTarget = target || document.activeElement || document.body;
  
  const eventOptions: KeyboardEventInit = {
    bubbles: true,
    cancelable: true,
    key: 'Tab',
    code: 'Tab',
    keyCode: 9,
    shiftKey: shift,
  };

  eventTarget.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
  await sleep(10);
  eventTarget.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
}

/**
 * Press arrow key for navigation
 */
export async function pressArrow(
  direction: 'up' | 'down' | 'left' | 'right',
  target?: Element
): Promise<void> {
  const keyMap = {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
  };
  
  await pressKey(keyMap[direction], target || document.activeElement || document.body);
}

// ============================================================================
// Key Code Mapping
// ============================================================================

/**
 * Get key code string from key name
 */
function getKeyCode(key: string): string {
  const codeMap: Record<string, string> = {
    'Enter': 'Enter',
    'Tab': 'Tab',
    'Escape': 'Escape',
    'Backspace': 'Backspace',
    'Delete': 'Delete',
    'ArrowUp': 'ArrowUp',
    'ArrowDown': 'ArrowDown',
    'ArrowLeft': 'ArrowLeft',
    'ArrowRight': 'ArrowRight',
    'Home': 'Home',
    'End': 'End',
    'PageUp': 'PageUp',
    'PageDown': 'PageDown',
    ' ': 'Space',
    'Space': 'Space',
  };

  if (key in codeMap) {
    return codeMap[key];
  }

  // For letter keys
  if (key.length === 1 && /[a-zA-Z]/.test(key)) {
    return `Key${key.toUpperCase()}`;
  }

  // For number keys
  if (key.length === 1 && /[0-9]/.test(key)) {
    return `Digit${key}`;
  }

  return key;
}

/**
 * Get legacy keyCode number
 */
function getKeyCodeNumber(key: string): number {
  const keyCodeMap: Record<string, number> = {
    'Enter': 13,
    'Tab': 9,
    'Escape': 27,
    'Backspace': 8,
    'Delete': 46,
    'ArrowUp': 38,
    'ArrowDown': 40,
    'ArrowLeft': 37,
    'ArrowRight': 39,
    'Home': 36,
    'End': 35,
    'PageUp': 33,
    'PageDown': 34,
    ' ': 32,
    'Space': 32,
  };

  if (key in keyCodeMap) {
    return keyCodeMap[key];
  }

  // For letter keys
  if (key.length === 1 && /[a-zA-Z]/.test(key)) {
    return key.toUpperCase().charCodeAt(0);
  }

  // For number keys
  if (key.length === 1 && /[0-9]/.test(key)) {
    return key.charCodeAt(0);
  }

  return 0;
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

