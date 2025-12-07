/**
 * Workflow types for GhostWriter Extension
 */

import type { ShadowPath } from '../content/shadow-dom-utils';

export type WorkflowStepType = 'CLICK' | 'INPUT' | 'NAVIGATION';

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
  context?: {
    siblings?: { before: string[]; after: string[] };
    parent?: {
      selector: string;
      text?: string;
      attributes?: Record<string, string>;
      index?: number; // Position among similar parents
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
    formContext?: { formId?: string; fieldset?: string; section?: string };
  };
  similarity?: {
    similarCount: number; // How many similar elements exist
    uniquenessScore: number; // 0-1 score of how unique this element is
    disambiguation: string[]; // Attributes/text that make it unique
  };
}

export interface WorkflowStep {
  type: WorkflowStepType;
  payload: WorkflowStepPayload;
}

export interface SavedWorkflow {
  id: string; // Unique identifier (timestamp or UUID)
  name: string; // User-provided name
  createdAt: number; // Timestamp
  updatedAt: number; // Timestamp
  steps: WorkflowStep[]; // Array of recorded steps
}

