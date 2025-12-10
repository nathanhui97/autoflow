/**
 * Workflow types for GhostWriter Extension
 */

import type { ShadowPath } from '../content/shadow-dom-utils';

export type WorkflowStepType = 'CLICK' | 'INPUT' | 'NAVIGATION' | 'KEYBOARD';

export interface ElementState {
  visible: boolean;
  enabled: boolean;
  readonly?: boolean;
  checked?: boolean;
}

export interface WaitCondition {
  type: 'element' | 'text' | 'url' | 'time';
  selector?: string; // For 'element' type
  text?: string; // For 'text' type
  url?: string; // For 'url' type (can be pattern)
  timeout?: number; // Max wait time in ms
}

export interface EventDetails {
  mouseButton?: 'left' | 'right' | 'middle';
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  }; // Only included if at least one modifier is true
  coordinates?: { x: number; y: number }; // Click coordinates
  eventSequence?: ('mousedown' | 'focus' | 'mouseup' | 'click')[];
}

export interface ViewportInfo {
  width: number;
  height: number;
  scrollX?: number; // Only included if non-zero
  scrollY?: number; // Only included if non-zero
  elementScrollContainer?: {
    selector: string;
    scrollTop?: number; // Only included if non-zero
    scrollLeft?: number; // Only included if non-zero
  };
}

export interface InputDetails {
  type: string; // 'text', 'number', 'email', 'date', etc.
  required?: boolean;
  min?: number | string;
  max?: number | string;
  pattern?: string; // regex pattern
  step?: number; // for number inputs
}

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  // top, left, right, bottom removed - can be computed from x, y, width, height
  // top = y, left = x, right = x + width, bottom = y + height
}

export interface IframeContext {
  selector: string;
  src?: string;
  name?: string;
  index?: number; // if multiple iframes
}

export interface TimingInfo {
  delayAfter?: number; // ms to wait after this step
  animationWait?: boolean; // wait for CSS animations
  networkWait?: boolean; // wait for network requests
}

export interface KeyboardDetails {
  key: string; // 'Enter', 'Tab', 'Escape', etc.
  code: string; // 'Enter', 'TabLeft', etc.
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  };
}

export interface RetryStrategy {
  maxRetries?: number;
  retryDelay?: number;
  // retrySelectors removed - replayer uses fallbackSelectors directly
}

export interface NetworkConditions {
  waitForRequests?: boolean;
  requestPatterns?: string[]; // URL patterns to wait for
  timeout?: number;
}

export interface PageState {
  readyState: 'loading' | 'interactive' | 'complete';
  loadTime?: number; // time since page load
}

export interface FocusEvents {
  needsFocus?: boolean;
  needsBlur?: boolean;
}

export interface WorkflowStepPayload {
  selector: string; // The best stable selector
  fallbackSelectors: string[]; // List of backup selectors
  xpath: string; // XPath for text matching
  label?: string; // "Client Name"
  value?: string; // "Acme Corp"
  timestamp: number;
  url: string;
  shadowPath?: ShadowPath[]; // Path through shadow boundaries
  elementState?: ElementState; // Element state at time of recording
  elementText?: string; // Exact text content of the element (for buttons, links, labels)
  waitConditions?: WaitCondition[]; // What to wait for before executing this step
  // Phase 1: Critical fixes
  eventDetails?: EventDetails; // Event sequence and details
  viewport?: ViewportInfo; // Viewport dimensions and scroll position
  // Phase 2: Important fixes
  inputDetails?: InputDetails; // Input type and validation (for INPUT steps)
  elementBounds?: ElementBounds; // Element bounding box
  iframeContext?: IframeContext; // Iframe information
  timing?: TimingInfo; // Timing and delay information
  keyboardDetails?: KeyboardDetails; // Keyboard event details (for KEYBOARD steps)
  // Phase 2: Visual snapshots for AI reliability
  visualSnapshot?: {
    viewport?: string; // Base64 data URL of viewport
    elementSnippet?: string; // Base64 data URL of element + context (cropped)
    timestamp: number; // When snapshot was taken
    viewportSize: { width: number; height: number }; // Viewport dimensions
    elementBounds?: ElementBounds; // Element position in viewport
  };
  // Phase 3: Minor enhancements
  elementRole?: string; // Element's own role attribute
  retryStrategy?: RetryStrategy; // Retry configuration
  networkConditions?: NetworkConditions; // Network request monitoring
  pageState?: PageState; // Page load state
  focusEvents?: FocusEvents; // Focus/blur requirements
  context?: {
    siblings?: { before?: string[]; after?: string[] }; // Optional arrays - only included if they have content
    parent?: {
      selector: string;
      text?: string;
      attributes?: Record<string, string>;
      index?: number; // Position among similar parents
      state?: {
        expanded?: boolean;
        visible?: boolean;
        enabled?: boolean;
      };
    };
    ancestors?: Array<{
      selector: string;
      text?: string;
      role?: string; // e.g., "dashboard", "widget", "container"
    }>;
    container?: {
      // For menu buttons, identify which dashboard/widget contains it
      selector: string; // e.g., "gridster-item#w26"
      text?: string; // e.g., "STORE LIST - PORTFOLIO"
      type?: string; // e.g., "dashboard", "widget", "table"
      index?: number; // Which dashboard (1st, 2nd, etc.)
    };
    position?: { index: number; total: number; type: string };
    surroundingText?: string;
    uniqueAttributes?: Record<string, string>;
    formContext?: {
      formId?: string;
      fieldset?: string;
      section?: string;
      isValid?: boolean;
      isSubmitting?: boolean;
    };
    // Semantic coordinates for AI interpretation
    gridCoordinates?: {
      rowIndex?: number;
      columnIndex?: number;
      cellReference?: string; // "A1", "B2"
      columnHeader?: string; // "Price", "Product Name"
      rowHeader?: string; // If row has header
      isHeader?: boolean;
    };
    formCoordinates?: {
      label?: string;
      fieldOrder?: number;
      fieldset?: string;
      section?: string;
    };
    tableCoordinates?: {
      rowIndex?: number;
      columnIndex?: number;
      headerRow?: number;
      headerColumn?: number;
    };
    // Decision space for list items/options (AI context)
    decisionSpace?: {
      type: 'LIST_SELECTION';
      options: string[]; // All available options in the container
      selectedIndex: number; // 0-indexed position of selected option
      selectedText: string; // Text of the selected option
      containerSelector?: string; // Selector for the container (dropdown, list, etc.)
    };
    // Button context (Interactive Section Anchoring - for generic div buttons in Salesforce/React)
    buttonContext?: {
      section?: string; // Section header (e.g., "Account Information")
      label?: string; // Button text or aria-label
      role?: string; // ARIA role if present
    };
  };
  similarity?: {
    similarCount: number; // How many similar elements exist
    uniquenessScore: number; // 0-1 score of how unique this element is
    disambiguation: string[]; // Attributes/text that make it unique
  };
}

export interface Pattern {
  type: 'repetitive' | 'sequential' | 'template' | 'unique';
  sequenceType?: 'row' | 'column' | 'grid' | 'none';
  stepCount: number;
  dataVariation: string[];
  confidence: number; // 0-1
}

export interface ExecutionPolicy {
  strategy: 'DYNAMIC_LOCATOR' | 'EXACT_REPLAY' | 'HYBRID';
  tool: string; // Tool name from standard library (e.g., "find_grid_cell", "find_next_empty_row")
  params: Record<string, any>; // Tool-specific parameters
}

export interface WorkflowIntent {
  intent: string; // Human-readable description
  pattern: 'repetitive' | 'sequential' | 'template' | 'unique';
  mode: 'exact' | 'adaptive' | 'hybrid';
  confidence: number; // 0-1
  policy?: ExecutionPolicy; // Tool-use pattern for adaptive execution
}

export interface WorkflowStep {
  type: WorkflowStepType;
  payload: WorkflowStepPayload;
  description?: string; // AI-generated natural language description
}

export interface SavedWorkflow {
  id: string; // Unique identifier (timestamp or UUID)
  name: string; // User-provided name
  createdAt: number; // Timestamp
  updatedAt: number; // Timestamp
  steps: WorkflowStep[]; // Array of recorded steps
}

