/**
 * Universal Execution Orchestrator
 * 
 * Coordinates execution of workflow steps using the appropriate
 * action primitives based on detected component patterns.
 */

import type {
  UniversalStep,
  WorkflowResult,
  StepResult,
  WorkflowOptions,
  ComponentPattern,
  ElementSignature,
} from '../../types/universal-types';
import { resolveElement, resolveAcrossBoundaries } from './element-resolver';
import { waitForDOMStable } from './state-verifier';
import { executeClick } from './action-primitives/simple-click';
import { executeDropdownSelect } from './action-primitives/dropdown-select';
import { executeTextInput } from './action-primitives/text-input';
import { executeKeyboardAction } from './action-primitives/keyboard-action';
import { isDropdownPattern, isSimpleClickPattern, isTextInputPattern } from './component-detector';

// ============================================================================
// Main Orchestrator
// ============================================================================

/**
 * Execute a complete workflow
 */
export async function executeWorkflow(
  steps: UniversalStep[],
  options: WorkflowOptions = {}
): Promise<WorkflowResult> {
  const startTime = Date.now();
  const {
    stopOnFailure = true,
    stepTimeout = 10000,
    onStepProgress,
    onStepError,
    variableValues = {},
  } = options;

  const stepResults: StepResult[] = [];
  let stepsCompleted = 0;

  console.log(`[UniversalOrchestrator] Starting workflow with ${steps.length} steps`);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepStartTime = Date.now();

    // Notify progress
    onStepProgress?.(i, 'starting');

    try {
      // Wait for DOM to be stable before each step
      await waitForDOMStable(2000, 150);

      // Execute step
      const result = await executeStep(step, {
        timeout: stepTimeout,
        variableValues,
      });

      // Record result
      stepResults.push({
        ...result,
        stepIndex: i,
        patternType: step.pattern.type,
      });

      if (result.success) {
        stepsCompleted++;
        onStepProgress?.(i, 'completed');
        console.log(`[UniversalOrchestrator] Step ${i + 1}/${steps.length} completed: ${step.pattern.type}`);
      } else {
        onStepProgress?.(i, 'failed');
        onStepError?.(i, result.error || 'Unknown error');
        console.error(`[UniversalOrchestrator] Step ${i + 1}/${steps.length} failed: ${result.error}`);

        if (stopOnFailure) {
          break;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      stepResults.push({
        stepIndex: i,
        success: false,
        patternType: step.pattern.type,
        elapsedMs: Date.now() - stepStartTime,
        error: errorMessage,
      });

      onStepProgress?.(i, 'failed');
      onStepError?.(i, errorMessage);
      console.error(`[UniversalOrchestrator] Step ${i + 1}/${steps.length} threw error:`, error);

      if (stopOnFailure) {
        break;
      }
    }

    // Brief pause between steps
    await sleep(100);
  }

  const success = stepsCompleted === steps.length;
  const totalElapsedMs = Date.now() - startTime;

  console.log(`[UniversalOrchestrator] Workflow ${success ? 'completed' : 'failed'}: ${stepsCompleted}/${steps.length} steps`);

  return {
    success,
    stepsCompleted,
    totalSteps: steps.length,
    stepResults,
    totalElapsedMs,
    failureSummary: success ? undefined : generateFailureSummary(stepResults),
  };
}

// ============================================================================
// Step Execution
// ============================================================================

interface StepOptions {
  timeout: number;
  variableValues: Record<string, string>;
}

/**
 * Execute a single step based on its pattern type
 */
async function executeStep(
  step: UniversalStep,
  options: StepOptions
): Promise<Omit<StepResult, 'stepIndex' | 'patternType'>> {
  const startTime = Date.now();
  const { pattern, domPath, expectedOutcomes } = step;

  // Handle different pattern types
  switch (pattern.type) {
    case 'DROPDOWN_SELECT': {
      if (!isDropdownPattern(pattern)) {
        return {
          success: false,
          elapsedMs: Date.now() - startTime,
          error: 'Invalid dropdown pattern data',
        };
      }

      // Inject variables into option text if needed
      let optionText = pattern.data.selection.optionText;
      optionText = substituteVariables(optionText, options.variableValues);
      
      const modifiedPattern = {
        ...pattern.data,
        selection: {
          ...pattern.data.selection,
          optionText,
        },
      };

      const actionResult = await executeDropdownSelect(modifiedPattern);
      
      return {
        success: actionResult.success,
        action: actionResult,
        elapsedMs: Date.now() - startTime,
        error: actionResult.error,
      };
    }

    case 'SIMPLE_CLICK':
    case 'TOGGLE':
    case 'TAB_SELECT':
    case 'MODAL_TRIGGER': {
      if (!isSimpleClickPattern(pattern)) {
        return {
          success: false,
          elapsedMs: Date.now() - startTime,
          error: 'Invalid click pattern data',
        };
      }

      // Resolve element
      const resolution = domPath.boundaryType !== 'none'
        ? resolveAcrossBoundaries(domPath, pattern.data.target, { timeout: options.timeout })
        : await resolveElement(pattern.data.target, { timeout: options.timeout });

      if (resolution.status !== 'found') {
        return {
          success: false,
          resolution,
          elapsedMs: Date.now() - startTime,
          error: `Element not found: ${resolution.status === 'not_found' 
            ? resolution.lastError 
            : 'Ambiguous match'}`,
        };
      }

      const actionResult = await executeClick(resolution.element, pattern.data.target, {
        timeout: Math.max(options.timeout - (Date.now() - startTime), 1000),
        expectedOutcomes,
      });

      return {
        success: actionResult.success,
        resolution,
        action: actionResult,
        elapsedMs: Date.now() - startTime,
        error: actionResult.error,
      };
    }

    case 'TEXT_INPUT': {
      if (!isTextInputPattern(pattern)) {
        return {
          success: false,
          elapsedMs: Date.now() - startTime,
          error: 'Invalid text input pattern data',
        };
      }

      // Resolve element
      const resolution = domPath.boundaryType !== 'none'
        ? resolveAcrossBoundaries(domPath, pattern.data.input, { timeout: options.timeout })
        : await resolveElement(pattern.data.input, { timeout: options.timeout });

      if (resolution.status !== 'found') {
        return {
          success: false,
          resolution,
          elapsedMs: Date.now() - startTime,
          error: `Input element not found: ${resolution.status === 'not_found' 
            ? resolution.lastError 
            : 'Ambiguous match'}`,
        };
      }

      // Substitute variables in value
      let value = pattern.data.value;
      value = substituteVariables(value, options.variableValues);

      const actionResult = await executeTextInput(resolution.element, value, {
        timeout: Math.max(options.timeout - (Date.now() - startTime), 1000),
        clearFirst: pattern.data.clearFirst,
      });

      return {
        success: actionResult.success,
        resolution,
        action: actionResult,
        elapsedMs: Date.now() - startTime,
        error: actionResult.error,
      };
    }

    case 'AUTOCOMPLETE': {
      // Autocomplete is handled as: type + wait for suggestions + select
      // For now, treat as text input followed by dropdown select
      return {
        success: false,
        elapsedMs: Date.now() - startTime,
        error: 'Autocomplete pattern not yet implemented',
      };
    }

    case 'MENU_NAVIGATION': {
      // Menu navigation: sequence of hovers/clicks through nested menus
      return {
        success: false,
        elapsedMs: Date.now() - startTime,
        error: 'Menu navigation pattern not yet implemented',
      };
    }

    default:
      return {
        success: false,
        elapsedMs: Date.now() - startTime,
        error: `Unknown pattern type: ${(pattern as any).type}`,
      };
  }
}

// ============================================================================
// Variable Substitution
// ============================================================================

/**
 * Substitute {{variable}} patterns in a string
 */
function substituteVariables(
  text: string,
  variables: Record<string, string>
): string {
  if (!text || Object.keys(variables).length === 0) {
    return text;
  }

  return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    if (varName in variables) {
      return variables[varName];
    }
    return match; // Keep original if not found
  });
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Generate failure summary from step results
 */
function generateFailureSummary(stepResults: StepResult[]): string {
  const failedSteps = stepResults.filter(r => !r.success);
  
  if (failedSteps.length === 0) {
    return 'No failures';
  }

  const summaries = failedSteps.map(step => {
    const stepNum = step.stepIndex + 1;
    const pattern = step.patternType;
    const error = step.error || 'Unknown error';
    return `Step ${stepNum} (${pattern}): ${error}`;
  });

  return summaries.join('; ');
}

// ============================================================================
// Legacy Step Conversion
// ============================================================================

/**
 * Convert a legacy WorkflowStep to UniversalStep
 * This allows gradual migration to the new system
 */
export function convertLegacyStep(
  legacyStep: {
    type: string;
    payload: any;
    description?: string;
  }
): UniversalStep {
  const payload = legacyStep.payload;
  
  // Build a basic signature from legacy data
  const signature: ElementSignature = {
    identity: {
      testId: payload.context?.uniqueAttributes?.['data-testid'],
      ariaLabel: payload.aiEvidence?.semanticAnchors?.ariaLabel,
      role: payload.elementRole,
      name: payload.label,
    },
    text: {
      exact: payload.elementText,
      normalized: payload.elementText?.toLowerCase(),
    },
    structure: {
      tagName: payload.selector?.split(/[.#\[\s]/)[0]?.toUpperCase() || 'DIV',
    },
    visual: {
      landmark: payload.aiEvidence?.semanticAnchors?.nearbyText?.[0],
      formContext: payload.context?.formContext?.formId,
      nearbyLabels: payload.aiEvidence?.semanticAnchors?.nearbyText,
    },
    selectors: {
      stable: payload.selector,
      specific: payload.fallbackSelectors?.[0],
      xpath: payload.xpath,
    },
  };

  // Determine pattern based on step type and context
  let pattern: ComponentPattern;
  
  if (legacyStep.type === 'INPUT') {
    pattern = {
      type: 'TEXT_INPUT',
      data: {
        input: signature,
        value: payload.value || '',
        clearFirst: true,
        inputType: payload.inputDetails?.type || 'text',
      },
    };
  } else if (legacyStep.type === 'CLICK' && payload.elementRole === 'combobox') {
    // This might be a dropdown trigger
    pattern = {
      type: 'DROPDOWN_SELECT',
      data: {
        trigger: signature,
        selection: {
          optionText: payload.elementText || '',
        },
      },
    };
  } else {
    pattern = {
      type: 'SIMPLE_CLICK',
      data: {
        target: signature,
      },
    };
  }

  return {
    type: legacyStep.type,
    description: legacyStep.description,
    pattern,
    domPath: {
      boundaryType: payload.shadowPath?.length > 0 ? 'shadow' : 'none',
      steps: [],
    },
    metadata: {
      timestamp: payload.timestamp || Date.now(),
      url: payload.url || window.location.href,
      viewport: payload.viewport,
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

