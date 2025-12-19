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
import { executeHumanClick } from './action-primitives/human-click';
import { executeDropdownSelect } from './action-primitives/dropdown-select';
import { executeTextInput } from './action-primitives/text-input';
import { isDropdownPattern, isSimpleClickPattern, isTextInputPattern } from './component-detector';
import { aiConfig } from '../../lib/ai-config';
import { AIVisualClickService, type WorkflowContext } from '../../lib/ai-visual-click';

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

      // Build workflow context for this step
      const workflowContext: WorkflowContext = {
        currentStepNumber: i + 1,
        totalSteps: steps.length,
        previousSteps: stepResults
          .filter(r => r.success)
          .map((r, idx) => ({
            stepNumber: idx + 1,
            description: steps[idx].description || `${steps[idx].pattern.type}`,
            success: r.success,
            resultUrl: window.location.href, // Current URL after step completed
            resultPageTitle: document.title,
          })),
        workflowGoal: inferWorkflowGoal(steps),
        isOptimized: steps.length < 5, // Heuristic: likely optimized if < 5 steps
      };
      
      // Execute step
      const result = await executeStep(step, {
        timeout: stepTimeout,
        variableValues,
      }, workflowContext);

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
  options: StepOptions,
  workflowContext?: WorkflowContext
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

      // ===================================================================
      // SMART PRIORITY: Check if we have annotated screenshot
      // If YES → Try AI Visual Click FIRST (95%+ accuracy)
      // If NO → Use standard selectors first
      // ===================================================================
      const visualSnapshotData = step.metadata?.visualSnapshot as any;
      const hasAnnotatedScreenshot = !!visualSnapshotData?.annotated;
      
      console.log(`[UniversalOrchestrator] Smart Priority - Has annotated screenshot: ${hasAnnotatedScreenshot}`);
      
      let resolution: any = null;
      
      // PRIORITY PATH: AI Visual Click First (if we have annotated screenshot)
      if (hasAnnotatedScreenshot && aiConfig.isEnabled()) {
        console.log(`[UniversalOrchestrator] 🎯 Trying AI Visual Click FIRST (annotated screenshot available)...`);
        console.log(`[UniversalOrchestrator] 📍 Current URL: ${window.location.href}`);
        console.log(`[UniversalOrchestrator] 📍 Recorded URL: ${step.metadata?.url || 'unknown'}`);
        
        // Log screenshot metadata to verify we're using the right step's screenshot
        console.log(`[UniversalOrchestrator] 📸 Screenshot from this step:`);
        console.log(`[UniversalOrchestrator]    - Timestamp: ${visualSnapshotData.timestamp ? new Date(visualSnapshotData.timestamp).toLocaleTimeString() : 'N/A'}`);
        console.log(`[UniversalOrchestrator]    - Has annotated: ${!!visualSnapshotData.annotated}`);
        console.log(`[UniversalOrchestrator]    - Has viewport: ${!!visualSnapshotData.viewport}`);
        console.log(`[UniversalOrchestrator]    - Click point: ${visualSnapshotData.clickPoint ? `(${visualSnapshotData.clickPoint.x}, ${visualSnapshotData.clickPoint.y})` : 'N/A'}`);
        console.log(`[UniversalOrchestrator]    - Action type: ${visualSnapshotData.actionType || 'N/A'}`);
        
        // Warn if URLs don't match - AI might fail due to different page state
        const currentUrl = window.location.href;
        const recordedUrl = step.metadata?.url || '';
        const urlsMatch = currentUrl === recordedUrl || 
                          currentUrl.split('?')[0] === recordedUrl.split('?')[0]; // Ignore query params
        
        if (!urlsMatch) {
          console.warn(`[UniversalOrchestrator] ⚠️ URL MISMATCH! Current page doesn't match recorded page.`);
          console.warn(`[UniversalOrchestrator] ⚠️ This means AI is comparing screenshots from DIFFERENT pages!`);
          console.warn(`[UniversalOrchestrator] ⚠️ Element may not exist on current page.`);
          console.warn(`[UniversalOrchestrator] ⚠️ Expected: ${recordedUrl}`);
          console.warn(`[UniversalOrchestrator] ⚠️ Current:  ${currentUrl}`);
        }
        
        try {
          const visualTarget = AIVisualClickService.targetFromSignature(
            pattern.data.target,
            step.description
          );
          
          console.log(`[UniversalOrchestrator] 🎯 Visual target for this step:`, {
            text: visualTarget.text,
            role: visualTarget.role,
            description: visualTarget.description,
          });
          
          const visualHints = AIVisualClickService.hintsFromMetadata(
            step.metadata?.coordinates,
            step.metadata?.elementBounds,
            pattern.data.target.visual?.nearbyLabels
          );
          
          // Add annotated screenshot info
          visualHints.annotatedScreenshot = visualSnapshotData.annotated;
          visualHints.recordedClickPoint = visualSnapshotData.clickPoint;
          visualHints.actionType = visualSnapshotData.actionType;
          
          console.log(`[UniversalOrchestrator] 📸 Sending to AI:`, {
            hasAnnotatedScreenshot: !!visualHints.annotatedScreenshot,
            clickPoint: visualHints.recordedClickPoint,
            actionType: visualHints.actionType,
            recordedBounds: visualHints.recordedBounds,
          });
          
          const recordedSnapshot = visualSnapshotData.annotated || visualSnapshotData.viewport;
          
          const visualResult = await AIVisualClickService.findAndClick(
            visualTarget,
            visualHints,
            recordedSnapshot,
            workflowContext
          );
          
          if (visualResult.success && visualResult.element) {
            console.log(`[UniversalOrchestrator] ✅ AI Visual Click succeeded (primary)! Confidence: ${Math.round(visualResult.confidence * 100)}%`);
            
            return {
              success: true,
              resolution: { 
                status: 'found', 
                element: visualResult.element,
                confidence: visualResult.confidence,
                method: 'ai-visual',
              },
              action: {
                success: true,
                actionType: 'ai-visual-click-primary',
                elapsedMs: visualResult.elapsedMs,
                successfulStrategy: visualResult.method,
                strategiesTried: [`ai-visual-primary-attempt-${visualResult.attempts}`],
              },
              elapsedMs: Date.now() - startTime,
              aiRecovery: {
                used: true,
                method: 'ai-visual',
                confidence: visualResult.confidence,
                reasoning: `Primary strategy (annotated screenshot): ${visualResult.reasoning}`,
              },
            };
          } else {
            console.log(`[UniversalOrchestrator] AI Visual Click failed, falling back to selectors...`);
          }
        } catch (visualError) {
          console.warn(`[UniversalOrchestrator] AI Visual Click error, falling back to selectors:`, visualError);
        }
      }
      
      // FALLBACK PATH: Standard selector resolution
      console.log(`[UniversalOrchestrator] Using standard selector resolution...`);
      resolution = domPath.boundaryType !== 'none'
        ? resolveAcrossBoundaries(domPath, pattern.data.target, { timeout: options.timeout })
        : await resolveElement(pattern.data.target, { timeout: options.timeout });

      // Check for zero-dimension elements (Salesforce Lightning issue)
      if (resolution.status === 'found') {
        const rect = resolution.element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          console.log(`[UniversalOrchestrator] Element found but has zero dimensions, waiting...`);
          
          const maxWait = 3000;
          const waitStart = Date.now();
          
          while (Date.now() - waitStart < maxWait) {
            await sleep(200);
            const newRect = resolution.element.getBoundingClientRect();
            if (newRect.width > 0 && newRect.height > 0) {
              console.log(`[UniversalOrchestrator] Element now has dimensions: ${newRect.width}x${newRect.height}`);
              break;
            }
          }
          
          const finalRect = resolution.element.getBoundingClientRect();
          if (finalRect.width === 0 || finalRect.height === 0) {
            console.warn(`[UniversalOrchestrator] ❌ Element still zero dimensions - treating as not found`);
            const previousMethod = resolution.method;
            resolution = { 
              status: 'not_found', 
              triedMethods: [previousMethod, 'dimension-check-failed'], 
              lastError: 'Element has zero dimensions (likely wrong element)' 
            };
          }
        }
      }

      // Try AI Visual Click as FALLBACK if element not found AND we didn't already try it as primary
      if (resolution.status !== 'found' && aiConfig.isEnabled() && !hasAnnotatedScreenshot) {
        console.log(`[UniversalOrchestrator] 🔍 Trying AI Visual Click as fallback (no annotated screenshot)...`);
        
        try {
          const visualTarget = AIVisualClickService.targetFromSignature(
            pattern.data.target,
            step.description
          );
          
          console.log('[UniversalOrchestrator] Visual target:', {
            text: visualTarget.text,
            role: visualTarget.role,
            description: visualTarget.description,
          });
          
          // Get visual snapshot with annotations from metadata
          const visualSnapshotData = step.metadata?.visualSnapshot as any;
          
          const visualHints = AIVisualClickService.hintsFromMetadata(
            step.metadata?.coordinates,
            step.metadata?.elementBounds,
            pattern.data.target.visual?.nearbyLabels
          );
          
          // Add annotated screenshot info to hints if available
          if (visualSnapshotData?.annotated) {
            visualHints.annotatedScreenshot = visualSnapshotData.annotated;
            console.log('[UniversalOrchestrator] Using annotated screenshot with visual markers');
          }
          if (visualSnapshotData?.clickPoint) {
            visualHints.recordedClickPoint = visualSnapshotData.clickPoint;
          }
          if (visualSnapshotData?.actionType) {
            visualHints.actionType = visualSnapshotData.actionType;
          }
          
          console.log('[UniversalOrchestrator] Visual hints:', {
            coords: visualHints.approximateCoordinates,
            bounds: visualHints.recordedBounds,
            hasAnnotated: !!visualHints.annotatedScreenshot,
            clickPoint: visualHints.recordedClickPoint,
          });
          
          // Use annotated or original viewport snapshot as reference
          const recordedSnapshot = visualSnapshotData?.annotated || 
                                    visualSnapshotData?.viewport ||
                                    (step.metadata?.viewport as any)?.screenshot;
          
          const visualResult = await AIVisualClickService.findAndClick(
            visualTarget,
            visualHints,
            recordedSnapshot,
            workflowContext
          );
          
          if (visualResult.success && visualResult.element) {
            console.log(`[UniversalOrchestrator] ✅ AI Visual Click succeeded! Confidence: ${Math.round(visualResult.confidence * 100)}%`);
            
            return {
              success: true,
              resolution: { 
                status: 'found', 
                element: visualResult.element,
                confidence: visualResult.confidence,
                method: `visual-ai-${visualResult.method}`,
              },
              action: {
                success: true,
                actionType: 'ai-visual-click',
                elapsedMs: visualResult.elapsedMs,
                successfulStrategy: visualResult.method,
                strategiesTried: [`visual-ai-attempt-${visualResult.attempts}`],
              },
              elapsedMs: Date.now() - startTime,
              aiRecovery: {
                used: true,
                method: 'ai-visual',
                confidence: visualResult.confidence,
                reasoning: visualResult.reasoning,
              },
            };
          }
        } catch (visualError) {
          console.warn(`[UniversalOrchestrator] AI Visual Click error:`, visualError);
        }
      }

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

      const actionResult = await executeHumanClick(resolution.element, pattern.data.target, {
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
      // Include coordinates for AI Visual Click fallback
      coordinates: payload.eventDetails?.coordinates,
      elementBounds: payload.elementBounds,
      // Include visual snapshot for AI Visual Click with annotations
      visualSnapshot: payload.visualSnapshot,
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Infer the overall workflow goal from step descriptions
 */
function inferWorkflowGoal(steps: UniversalStep[]): string | undefined {
  if (steps.length === 0) return undefined;
  
  // Look for common patterns in step descriptions
  const descriptions = steps.map(s => s.description || '').join(' ').toLowerCase();
  
  if (descriptions.includes('create') && descriptions.includes('account')) {
    return 'Create new account';
  }
  if (descriptions.includes('new account')) {
    return 'Create new account';
  }
  if (descriptions.includes('edit') || descriptions.includes('update')) {
    return 'Edit/update record';
  }
  if (descriptions.includes('delete')) {
    return 'Delete record';
  }
  if (descriptions.includes('search') || descriptions.includes('find')) {
    return 'Search for record';
  }
  
  // Generic goal based on first step
  const firstStep = steps[0].description;
  if (firstStep && firstStep.length > 0) {
    return firstStep;
  }
  
  return undefined;
}

