/**
 * Reliable Replayer - State-Machine Replayer with Verification
 * 
 * This module exports all components of the reliable replayer system.
 * 
 * Architecture:
 * - Intent: Machine-readable goals that drive resolution strategy
 * - Scope: First-class container resolution
 * - LocatorBundle: Feature-based locators scored at runtime
 * - SuccessCondition: Compound conditions with AND/OR/NOT
 * - CandidateFinder: Finds candidates per strategy within scope
 * - Resolver: Scores, ranks, and decides on candidates
 * - StateWaitEngine: Deterministic state-based waits
 * - SuccessVerifier: Verifies compound conditions
 * - RecoveryEngine: Deterministic recovery actions
 * - StepInstrumentation: Metrics collection and analysis
 */

// Types
export type { Intent, StepGoal, KeyModifiers } from '../../types/intent';
export { 
  createClickIntent, 
  createTypeIntent, 
  createSelectDropdownIntent,
  createOpenRowActionsIntent,
  createSubmitFormIntent,
  createNavigateIntent,
  createToggleCheckboxIntent,
  createPressKeyIntent,
  describeIntent,
  isIntent,
} from '../../types/intent';

export type { Scope } from '../../types/scope';
export {
  createPageScope,
  createModalScope,
  createIframeScope,
  createSectionScope,
  createTableRowScope,
  createContainerScope,
  createWidgetScope,
  createShadowRootScope,
  resolveScopeContainer,
  describeScope,
  isScope,
} from '../../types/scope';

export type { 
  LocatorBundle, 
  LocatorStrategy, 
  LocatorFeatures,
  LocatorType,
} from '../../types/locator';
export {
  createEmptyBundle,
  createCSSLocator,
  createTextLocator,
  createAriaLocator,
  createRoleLocator,
  createTestIdLocator,
  createXPathLocator,
  createPositionLocator,
  getBestStrategy,
  hasStableLocator,
  hasDynamicParts,
  isLikelyDynamicText,
} from '../../types/locator';

export type {
  SuccessCondition,
  AllCondition,
  AnyCondition,
  NotCondition,
  ElementCondition,
  StateCondition,
  SuggestedCondition,
} from '../../types/conditions';
export {
  all,
  any,
  not,
  elementVisible,
  elementGone,
  elementEnabled,
  elementDisabled,
  elementHasText,
  urlChanged,
  urlContains,
  textAppeared,
  textGone,
  domStable,
  networkIdle,
  noLoaders,
  describeCondition,
  conditionTemplates,
  isAllCondition,
  isAnyCondition,
  isNotCondition,
  isElementCondition,
  isStateCondition,
} from '../../types/conditions';

// Core Modules
export { CandidateFinder } from '../candidate-finder';
export type { CandidateResult } from '../candidate-finder';

export { Resolver } from '../resolver';
export type { ResolveResult, ResolveMetrics } from '../resolver';

export { StateWaitEngine } from '../state-wait-engine';
export type { WaitResult } from '../state-wait-engine';

export { SuccessVerifier } from '../success-verifier';
export type { VerificationResult } from '../success-verifier';

export { RecoveryEngine } from '../recovery-engine';
export type { 
  RecoveryAction, 
  RecoveryStrategy, 
  RecoveryContext, 
  RecoveryResult 
} from '../recovery-engine';

export { StepInstrumentation } from '../../lib/step-instrumentation';
export type { 
  StepMetrics, 
  FailurePattern, 
  InstrumentationSummary 
} from '../../lib/step-instrumentation';

// Execution Engine
export { 
  VerifiedExecutionEngine, 
  createVerifiedExecutionEngine 
} from '../verified-execution-engine';
export type { 
  StepExecutionResult, 
  WorkflowExecutionResult, 
  VerifiedExecutionConfig 
} from '../verified-execution-engine';

// Builder Utilities
export { buildLocatorBundle } from '../../lib/locator-builder';
export { 
  inferClickIntent, 
  inferInputIntent, 
  inferKeyboardIntent,
  inferSuccessCondition,
  buildStepGoal,
} from '../../lib/intent-inference';

