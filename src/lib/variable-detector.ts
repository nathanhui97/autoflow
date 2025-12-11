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
  selector?: string;           // Element selector (for detecting dropdowns)
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

    console.log(`[VariableDetector] Starting detection for ${steps.length} total steps`);
    console.log(`[VariableDetector] Step types:`, steps.map(s => s.type));

    // Filter steps to only those that could contain variables
    const stepsForAnalysis = this.filterStepsForAnalysis(steps);

    if (stepsForAnalysis.length === 0) {
      console.log('[VariableDetector] No steps to analyze for variables');
      console.log('[VariableDetector] Reasons: Steps may be missing visual snapshots or are not INPUT/selectable CLICK steps');
      return {
        variables: [],
        detectedAt: Date.now(),
        analysisCount: 0,
      };
    }

    console.log(`[VariableDetector] Analyzing ${stepsForAnalysis.length} steps for variables (filtered from ${steps.length} total)`);
    console.log(`[VariableDetector] Steps to analyze:`, stepsForAnalysis.map(s => ({
      type: s.metadata.stepType,
      hasBefore: !!s.beforeSnapshot,
      hasAfter: !!s.afterSnapshot,
      isDropdown: s.metadata.isDropdown,
    })));

    try {
      // Call Edge Function
      const response = await this.callEdgeFunction(stepsForAnalysis, steps);
      
      // Filter to only confirmed variables
      const confirmedVariables = response.variables.filter(v => v.isVariable && v.confidence >= 0.5);

      console.log(`[VariableDetector] Edge Function response:`, {
        totalVariables: response.variables.length,
        confirmedVariables: confirmedVariables.length,
        analysisCount: response.analysisCount,
        allVariables: response.variables.map(v => ({
          fieldName: v.fieldName,
          isVariable: v.isVariable,
          confidence: v.confidence,
        })),
      });

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

      // Always include INPUT steps (primary variable source)
      // INPUT steps are important even without snapshots - the value is what matters
      if (step.type === 'INPUT') {
        // Include if it has a value (what user typed) OR a label (field name)
        const hasValue = !!payload.value;
        const hasLabel = !!payload.label;
        const hasSnapshot = !!(payload.visualSnapshot?.viewport || payload.visualSnapshot?.elementSnippet);
        
        if (hasValue || hasLabel) {
          console.log(`[VariableDetector] Including INPUT step ${i}: value="${payload.value || '(empty)'}", label="${payload.label || '(none)'}", hasSnapshot=${hasSnapshot}`);
          result.push(this.createStepForAnalysis(i, step, steps));
        } else {
          console.log(`[VariableDetector] Skipping INPUT step ${i}: no value and no label`);
        }
        continue;
      }

      // Include KEYBOARD steps that have a value (text input via keyboard)
      if (step.type === 'KEYBOARD' && payload.value) {
        // KEYBOARD steps can work without snapshots if they have a value
        console.log(`[VariableDetector] Including KEYBOARD step ${i}: value="${payload.value}", hasSnapshot=${!!(payload.visualSnapshot?.viewport || payload.visualSnapshot?.elementSnippet)}`);
        result.push(this.createStepForAnalysis(i, step, steps));
        continue;
      }

      // For CLICK steps, only include if it's a selectable option (not navigation)
      if (step.type === 'CLICK') {
        const isSelectable = this.isSelectableOption(payload);
        console.log(`[VariableDetector] CLICK step ${i} check:`, {
          isSelectable,
          elementText: payload.elementText?.substring(0, 50),
          label: payload.label?.substring(0, 50),
          hasContext: !!payload.context,
          hasDecisionSpace: !!payload.context?.decisionSpace,
          decisionSpaceType: payload.context?.decisionSpace?.type,
          decisionSpaceOptions: payload.context?.decisionSpace?.options,
          decisionSpaceOptionsLength: payload.context?.decisionSpace?.options?.length || 0,
        });
        
        if (isSelectable) {
          // For dropdowns, include even without snapshot if we have decisionSpace data
          const hasSnapshot = payload.visualSnapshot?.viewport || payload.visualSnapshot?.elementSnippet;
          const hasDecisionSpace = payload.context?.decisionSpace?.type === 'LIST_SELECTION' && 
                                    payload.context.decisionSpace.options && 
                                    payload.context.decisionSpace.options.length > 0;
          
          // Also check if it's a dropdown by checking if the element has role="option" or is in a listbox
          // Check both single and double quotes in selector (XPath can use either)
          const selectorLower = (payload.selector || '').toLowerCase();
          const isLikelyDropdown = payload.elementRole === 'option' || 
                                   payload.context?.decisionSpace?.type === 'LIST_SELECTION' ||
                                   selectorLower.includes('role="option"') ||
                                   selectorLower.includes("role='option'") ||
                                   selectorLower.includes('role=\'option\'') ||
                                   selectorLower.includes('listbox') ||
                                   selectorLower.includes('[role="option"]') ||
                                   selectorLower.includes("[role='option']");
          
          // Also check if this is the step immediately after a dropdown trigger
          const isAfterDropdownTrigger = i > 0 && 
                                         steps[i - 1]?.type === 'CLICK' &&
                                         (steps[i - 1].payload.label?.toLowerCase().includes('select') ||
                                          steps[i - 1].payload.label?.toLowerCase().includes('choose') ||
                                          steps[i - 1].payload.elementText?.toLowerCase().includes('select') ||
                                          steps[i - 1].payload.selector?.toLowerCase().includes('promotion type'));
          
          const shouldInclude = hasSnapshot || hasDecisionSpace || isLikelyDropdown || isAfterDropdownTrigger;
          
          console.log(`[VariableDetector] CLICK step ${i} inclusion check:`, {
            hasSnapshot,
            hasDecisionSpace,
            isLikelyDropdown,
            isAfterDropdownTrigger,
            elementRole: payload.elementRole,
            selector: payload.selector?.substring(0, 100),
            willInclude: shouldInclude,
          });
          
          if (shouldInclude) {
            console.log(`[VariableDetector] ✅ Including CLICK step ${i}: hasSnapshot=${hasSnapshot}, hasDecisionSpace=${hasDecisionSpace}, isLikelyDropdown=${isLikelyDropdown}, isAfterDropdownTrigger=${isAfterDropdownTrigger}`);
            result.push(this.createStepForAnalysis(i, step, steps));
          } else {
            console.log(`[VariableDetector] ❌ Skipping CLICK step ${i}: no snapshot, no decisionSpace, and not a dropdown`);
          }
        } else {
          console.log(`[VariableDetector] ❌ Skipping CLICK step ${i}: not a selectable option (likely navigation)`);
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
    // For dropdowns without snapshots, try to use the previous step's snapshot (dropdown trigger)
    let afterSnapshot = payload.visualSnapshot?.viewport || 
                        payload.visualSnapshot?.elementSnippet;
    
    // If no snapshot, try to use previous step's snapshot (for dropdowns or INPUT steps)
    if (!afterSnapshot && (step.type === 'CLICK' || step.type === 'INPUT')) {
      if (stepIndex > 0) {
        const prevStep = allSteps[stepIndex - 1];
        afterSnapshot = prevStep.payload.visualSnapshot?.viewport || 
                       prevStep.payload.visualSnapshot?.elementSnippet;
        if (afterSnapshot) {
          console.log(`[VariableDetector] Using previous step's snapshot for ${step.type} step ${stepIndex}`);
        }
      }
    }

    // Check if this is a dropdown and extract options
    const isDropdown = this.isDropdownStep(payload);
    let dropdownOptions = isDropdown ? this.extractDropdownOptions(payload) : undefined;
    
    // Log decisionSpace data for debugging
    if (step.type === 'CLICK') {
      console.log(`[VariableDetector] CLICK step ${stepIndex} decisionSpace check:`, {
        hasDecisionSpace: !!payload.context?.decisionSpace,
        decisionSpaceType: payload.context?.decisionSpace?.type,
        decisionSpaceOptions: payload.context?.decisionSpace?.options,
        decisionSpaceOptionsLength: payload.context?.decisionSpace?.options?.length || 0,
        selectedText: payload.context?.decisionSpace?.selectedText,
      });
    }
    
    // If no options extracted but we have decisionSpace, use those options
    if (isDropdown && (!dropdownOptions || dropdownOptions.length === 0)) {
      if (payload.context?.decisionSpace?.options && Array.isArray(payload.context.decisionSpace.options)) {
        dropdownOptions = payload.context.decisionSpace.options;
        console.log(`[VariableDetector] ✅ Using decisionSpace options for dropdown step ${stepIndex}:`, dropdownOptions);
      } else {
        console.log(`[VariableDetector] ⚠️ Dropdown step ${stepIndex} has no options extracted and no decisionSpace data`);
      }
    }

    // Extract value - try multiple sources
    let extractedValue = payload.value || payload.context?.decisionSpace?.selectedText;
    
    // For dropdown options without value, try to extract from selector
    // Example: //*[@role='option'][contains(normalize-space(.), 'BOGO')] -> extract "BOGO"
    if (!extractedValue && isDropdown && payload.selector) {
      const valueMatch = payload.selector.match(/contains\([^,]+,\s*['"]([^'"]+)['"]\)/);
      if (valueMatch && valueMatch[1]) {
        extractedValue = valueMatch[1];
        console.log(`[VariableDetector] Extracted value from selector for step ${stepIndex}: "${extractedValue}"`);
      }
    }

    // Extract metadata
    const metadata: StepMetadata = {
      stepIndex,
      stepId: `${payload.timestamp}`,
      stepType: step.type as 'INPUT' | 'CLICK' | 'SELECT' | 'KEYBOARD',
      value: extractedValue,
      label: payload.label,
      inputType: payload.inputDetails?.type,
      elementRole: payload.elementRole,
      elementTag: this.extractTagFromSelector(payload.selector),
      placeholder: this.extractPlaceholder(payload),
      isSelectableOption: step.type === 'CLICK' ? this.isSelectableOption(payload) : undefined,
      isDropdown,
      dropdownOptions,
      selector: payload.selector, // Include selector for Edge Function to detect dropdowns
    };
    
    // Log metadata for dropdown CLICK steps
    if (step.type === 'CLICK' && isDropdown) {
      console.log(`[VariableDetector] Dropdown CLICK step ${stepIndex} metadata:`, {
        isDropdown,
        hasDropdownOptions: !!dropdownOptions,
        dropdownOptionsCount: dropdownOptions?.length || 0,
        value: metadata.value,
        label: metadata.label,
        hasDecisionSpace: !!payload.context?.decisionSpace,
      });
    }

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
    if (role === 'combobox' || role === 'listbox' || role === 'option') {
      return true;
    }

    // Check if selector contains role="option" or role='option' (dropdown option)
    const selector = (payload.selector || '').toLowerCase();
    if (selector.includes('role="option"') || 
        selector.includes("role='option'") ||
        selector.includes('[role="option"]') ||
        selector.includes("[role='option']") ||
        selector.includes('listbox')) {
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

    console.log(`[VariableDetector] Calling Edge Function: ${url}`);
    console.log(`[VariableDetector] Sending ${stepsForAnalysis.length} steps for analysis`);
    
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
      console.error(`[VariableDetector] Edge Function error ${response.status}:`, errorText);
      throw new Error(`Edge Function error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`[VariableDetector] Edge Function response received:`, {
      variablesCount: result.variables?.length || 0,
      analysisCount: result.analysisCount || 0,
      hasError: !!result.error,
    });
    
    return result;
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
