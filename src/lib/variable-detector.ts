/**
 * Variable Detector Service
 * 
 * Analyzes workflow steps to detect which values should be parameterized as variables.
 * Uses AI vision analysis of snapshots to determine variable vs static values.
 * 
 * Filtering strategy (cost optimization):
 * - Primary focus: INPUT and TEXTAREA steps (most common variable sources)
 * - CLICK steps: Only analyze if element is a selectable option (dropdown, radio, checkbox)
 * - Exclude: Navigation CLICK steps (Next, Submit, tabs, links)
 */

import { aiConfig } from './ai-config';
import type { WorkflowStep, WorkflowStepPayload } from '../types/workflow';

/**
 * Definition of a detected variable in a workflow
 */
export interface VariableDefinition {
  stepIndex: number;
  stepId: string;
  fieldName: string;        // Human-readable field name (e.g., "Email", "Client Name")
  fieldLabel?: string;      // Original label from the element
  variableName: string;     // camelCase variable name (e.g., "email", "clientName")
  defaultValue: string;     // The recorded value (used as default)
  inputType?: string;       // Input type (text, email, password, etc.)
  isVariable: boolean;      // Whether AI confirmed this is a variable
  confidence: number;       // AI confidence score (0-1)
  reasoning?: string;       // AI explanation for the classification
  // For dropdowns/selects: all available options
  options?: string[];       // Available options for dropdown/select variables
  isDropdown?: boolean;     // Whether this is a dropdown/select variable
}

/**
 * Container for workflow variables
 */
export interface WorkflowVariables {
  variables: VariableDefinition[];
  detectedAt: number;       // Timestamp of detection
  analysisCount: number;    // Number of steps analyzed
}

  /**
   * Step metadata for AI analysis
   */
interface StepMetadata {
  stepIndex: number;
  stepId: string;
  stepType: 'INPUT' | 'CLICK' | 'SELECT' | 'KEYBOARD';
  value?: string;
  label?: string;
  inputType?: string;
  elementRole?: string;
  elementTag?: string;
  placeholder?: string;
  isSelectableOption?: boolean;
  isDropdown?: boolean;        // Whether this is a dropdown/select
  dropdownOptions?: string[];  // Available options in dropdown (if known)
}

/**
 * Step data to send to Edge Function
 */
interface StepForAnalysis {
  metadata: StepMetadata;
  beforeSnapshot?: string;
  afterSnapshot?: string;
}

/**
 * Response from Edge Function
 */
interface DetectVariablesResponse {
  variables: VariableDefinition[];
  analysisCount: number;
  error?: string;
}

// Navigation button text patterns (case-insensitive)
const NAVIGATION_BUTTON_PATTERNS = [
  'next', 'previous', 'prev', 'back', 'forward',
  'submit', 'save', 'cancel', 'close', 'done',
  'continue', 'proceed', 'finish', 'complete',
  'ok', 'yes', 'no', 'confirm', 'apply',
  'search', 'filter', 'reset', 'clear',
  'add', 'create', 'new', 'edit', 'delete', 'remove',
  'login', 'logout', 'sign in', 'sign out', 'sign up',
  'expand', 'collapse', 'show', 'hide', 'toggle',
  'refresh', 'reload', 'update',
];

// Roles that indicate selectable options
const SELECTABLE_ROLES = [
  'option', 'radio', 'checkbox', 'menuitemradio', 'menuitemcheckbox',
  'listitem', 'treeitem', 'tab', 'switch',
];

export class VariableDetector {
  /**
   * Detect variables in workflow steps
   * Filters steps before sending to AI for cost optimization
   */
  static async detectVariables(steps: WorkflowStep[]): Promise<WorkflowVariables> {
    const config = aiConfig.getConfig();
    
    if (!config.enabled) {
      console.log('[VariableDetector] AI is disabled, skipping variable detection');
      return {
        variables: [],
        detectedAt: Date.now(),
        analysisCount: 0,
      };
    }

    // Filter steps to only those that could contain variables
    const stepsForAnalysis = this.filterStepsForAnalysis(steps);

    if (stepsForAnalysis.length === 0) {
      console.log('[VariableDetector] No steps to analyze for variables');
      return {
        variables: [],
        detectedAt: Date.now(),
        analysisCount: 0,
      };
    }

    console.log(`[VariableDetector] Analyzing ${stepsForAnalysis.length} steps for variables (filtered from ${steps.length} total)`);

    try {
      // Call Edge Function
      const response = await this.callEdgeFunction(stepsForAnalysis, steps);
      
      // Filter to only confirmed variables
      const confirmedVariables = response.variables.filter(v => v.isVariable && v.confidence >= 0.5);

      console.log(`[VariableDetector] Detected ${confirmedVariables.length} variables from ${response.analysisCount} analyzed steps`);

      return {
        variables: confirmedVariables,
        detectedAt: Date.now(),
        analysisCount: response.analysisCount,
      };
    } catch (error) {
      console.error('[VariableDetector] Error detecting variables:', error);
      return {
        variables: [],
        detectedAt: Date.now(),
        analysisCount: 0,
      };
    }
  }

  /**
   * Filter steps to only those that could contain variables
   * This is the key cost optimization - only send relevant steps to AI
   */
  private static filterStepsForAnalysis(steps: WorkflowStep[]): StepForAnalysis[] {
    const result: StepForAnalysis[] = [];
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const payload = step.payload;

      // Skip steps without snapshots (can't do visual analysis)
      if (!payload.visualSnapshot?.viewport && !payload.visualSnapshot?.elementSnippet) {
        continue;
      }

      // Always include INPUT steps (primary variable source)
      if (step.type === 'INPUT') {
        result.push(this.createStepForAnalysis(i, step, steps));
        continue;
      }

      // Include KEYBOARD steps that have a value (text input via keyboard)
      if (step.type === 'KEYBOARD' && payload.value) {
        result.push(this.createStepForAnalysis(i, step, steps));
        continue;
      }

      // For CLICK steps, only include if it's a selectable option (not navigation)
      if (step.type === 'CLICK') {
        if (this.isSelectableOption(payload)) {
          result.push(this.createStepForAnalysis(i, step, steps));
        }
        // Skip navigation clicks
      }
    }

    return result;
  }

  /**
   * Determine if a CLICK step is a selectable option (dropdown, radio, checkbox)
   * vs a navigation button (Next, Submit, etc.)
   */
  private static isSelectableOption(payload: WorkflowStepPayload): boolean {
    const elementText = (payload.elementText || '').toLowerCase().trim();
    const label = (payload.label || '').toLowerCase().trim();
    const role = (payload.elementRole || '').toLowerCase();
    const selector = (payload.selector || '').toLowerCase();

    // Check if it's a navigation button by text
    if (this.isNavigationButton(elementText) || this.isNavigationButton(label)) {
      return false;
    }

    // Check if element has a selectable role
    if (SELECTABLE_ROLES.includes(role)) {
      return true;
    }

    // Check if it's inside a select dropdown
    if (selector.includes('select') || selector.includes('option')) {
      return true;
    }

    // Check for radio/checkbox input types
    if (payload.inputDetails?.type === 'radio' || payload.inputDetails?.type === 'checkbox') {
      return true;
    }

    // Check context for decision space (indicates a list selection)
    if (payload.context?.decisionSpace?.type === 'LIST_SELECTION') {
      return true;
    }

    // Check if parent/container suggests a dropdown or list
    const containerType = payload.context?.container?.type?.toLowerCase() || '';
    if (containerType.includes('dropdown') || containerType.includes('select') || containerType.includes('list')) {
      return true;
    }

    // Default: not a selectable option
    return false;
  }

  /**
   * Check if text indicates a navigation button
   */
  private static isNavigationButton(text: string): boolean {
    if (!text) return false;
    
    const normalizedText = text.toLowerCase().trim();
    
    // Check against navigation patterns
    return NAVIGATION_BUTTON_PATTERNS.some(pattern => 
      normalizedText === pattern || 
      normalizedText.startsWith(pattern + ' ') ||
      normalizedText.endsWith(' ' + pattern)
    );
  }

  /**
   * Create step data for AI analysis
   */
  private static createStepForAnalysis(
    stepIndex: number,
    step: WorkflowStep,
    allSteps: WorkflowStep[]
  ): StepForAnalysis {
    const payload = step.payload;

    // Get "before" snapshot from previous step if available
    let beforeSnapshot: string | undefined;
    if (stepIndex > 0) {
      const prevStep = allSteps[stepIndex - 1];
      beforeSnapshot = prevStep.payload.visualSnapshot?.viewport || 
                       prevStep.payload.visualSnapshot?.elementSnippet;
    }

    // Get "after" snapshot from current step
    const afterSnapshot = payload.visualSnapshot?.viewport || 
                          payload.visualSnapshot?.elementSnippet;

    // Check if this is a dropdown and extract options
    const isDropdown = this.isDropdownStep(payload);
    const dropdownOptions = isDropdown ? this.extractDropdownOptions(payload) : undefined;

    // Extract metadata
    const metadata: StepMetadata = {
      stepIndex,
      stepId: `${payload.timestamp}`,
      stepType: step.type as 'INPUT' | 'CLICK' | 'SELECT' | 'KEYBOARD',
      value: payload.value,
      label: payload.label,
      inputType: payload.inputDetails?.type,
      elementRole: payload.elementRole,
      elementTag: this.extractTagFromSelector(payload.selector),
      placeholder: this.extractPlaceholder(payload),
      isSelectableOption: step.type === 'CLICK' ? this.isSelectableOption(payload) : undefined,
      isDropdown,
      dropdownOptions,
    };

    return {
      metadata,
      beforeSnapshot,
      afterSnapshot,
    };
  }

  /**
   * Extract tag name from selector
   */
  private static extractTagFromSelector(selector: string): string | undefined {
    if (!selector) return undefined;
    
    // Match tag at start of selector (e.g., "input#email" -> "input")
    const match = selector.match(/^([a-z]+)/i);
    return match ? match[1].toLowerCase() : undefined;
  }

  /**
   * Extract placeholder from payload
   */
  private static extractPlaceholder(payload: WorkflowStepPayload): string | undefined {
    // Try to find placeholder in unique attributes
    if (payload.context?.uniqueAttributes?.placeholder) {
      return payload.context.uniqueAttributes.placeholder;
    }
    return undefined;
  }

  /**
   * Check if this step is a dropdown/select
   */
  private static isDropdownStep(payload: WorkflowStepPayload): boolean {
    // Check if it's a SELECT element
    if (payload.selector?.toLowerCase().includes('select')) {
      return true;
    }

    // Check if decisionSpace indicates a list selection (dropdown)
    if (payload.context?.decisionSpace?.type === 'LIST_SELECTION') {
      return true;
    }

    // Check if element role suggests dropdown
    const role = (payload.elementRole || '').toLowerCase();
    if (role === 'combobox' || role === 'listbox') {
      return true;
    }

    return false;
  }

  /**
   * Extract dropdown options from step payload
   * Uses decisionSpace if available, otherwise returns undefined (AI will extract from snapshot)
   */
  private static extractDropdownOptions(payload: WorkflowStepPayload): string[] | undefined {
    // If decisionSpace has options, use them
    if (payload.context?.decisionSpace?.options && Array.isArray(payload.context.decisionSpace.options)) {
      return payload.context.decisionSpace.options;
    }

    // Return undefined - AI will extract from snapshot
    return undefined;
  }

  /**
   * Call the detect_variables Edge Function
   */
  private static async callEdgeFunction(
    stepsForAnalysis: StepForAnalysis[],
    allSteps: WorkflowStep[]
  ): Promise<DetectVariablesResponse> {
    const config = aiConfig.getConfig();
    const url = aiConfig.getEdgeFunctionUrl(config.detectVariablesEdgeFunctionName);

    // Build page context from first step
    const firstStep = allSteps[0];
    const pageContext = firstStep ? {
      url: firstStep.payload.url,
      title: document.title || '',
      pageType: firstStep.payload.pageType?.type,
    } : undefined;

    const requestPayload = {
      steps: stepsForAnalysis,
      pageContext,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.supabaseAnonKey}`,
      },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Edge Function error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Generate a camelCase variable name from a field name
   */
  static generateVariableName(fieldName: string): string {
    if (!fieldName) return 'field';
    
    return fieldName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 0)
      .map((word, index) => 
        index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
      )
      .join('') || 'field';
  }
}
