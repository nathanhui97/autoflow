/**
 * Message types for communication between Side Panel, Background, and Content Scripts
 */
export type MessageType = 
  | 'PING' 
  | 'PONG'
  | 'START_RECORDING' 
  | 'STOP_RECORDING' 
  | 'EXECUTE_STEP'
  | 'RECORDED_STEP'
  | 'UPDATE_STEP'
  | 'AI_VALIDATION_STARTED'
  | 'AI_VALIDATION_COMPLETED'
  | 'STEP_ENHANCED'
  | 'ANALYZE_WORKFLOW'
  | 'EXECUTE_WORKFLOW_ADAPTIVE'
  | 'CAPTURE_VIEWPORT'
  | 'CORRECTION_SAVED'
  | 'ELEMENT_FIND_FAILED'
  | 'CANCEL_CORRECTION';

/**
 * Base message interface for all extension messages
 */
export interface ExtensionMessage {
  type: MessageType;
  payload?: any;
}

/**
 * Response interface for message handlers
 */
export interface MessageResponse {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * PING message - used for handshake verification
 */
export interface PingMessage extends ExtensionMessage {
  type: 'PING';
  payload?: {
    timestamp: number;
  };
}

/**
 * PONG message - response to PING
 */
export interface PongMessage extends ExtensionMessage {
  type: 'PONG';
  payload: {
    timestamp: number;
    ready: boolean;
  };
}

/**
 * START_RECORDING message
 */
export interface StartRecordingMessage extends ExtensionMessage {
  type: 'START_RECORDING';
  payload?: {
    options?: Record<string, any>;
  };
}

/**
 * STOP_RECORDING message
 */
export interface StopRecordingMessage extends ExtensionMessage {
  type: 'STOP_RECORDING';
  payload?: {
    save?: boolean;
  };
}

/**
 * EXECUTE_STEP message
 */
export interface ExecuteStepMessage extends ExtensionMessage {
  type: 'EXECUTE_STEP';
  payload: {
    step: any;
    index?: number;
  };
}

/**
 * RECORDED_STEP message - sent from content script to side panel
 */
export interface RecordedStepMessage extends ExtensionMessage {
  type: 'RECORDED_STEP';
  payload: {
    step: import('./workflow').WorkflowStep;
  };
}

/**
 * UPDATE_STEP message - sent from content script to side panel to update an existing step
 */
export interface UpdateStepMessage extends ExtensionMessage {
  type: 'UPDATE_STEP';
  payload: {
    stepId: string;
    step: import('./workflow').WorkflowStep;
  };
}

/**
 * AI_VALIDATION_STARTED message - sent when AI validation begins for a step
 */
export interface AIValidationStartedMessage extends ExtensionMessage {
  type: 'AI_VALIDATION_STARTED';
  payload: {
    stepId: string;
  };
}

/**
 * AI_VALIDATION_COMPLETED message - sent when AI validation completes (with or without enhancements)
 */
export interface AIValidationCompletedMessage extends ExtensionMessage {
  type: 'AI_VALIDATION_COMPLETED';
  payload: {
    stepId: string;
    enhanced: boolean;
  };
}

/**
 * STEP_ENHANCED message - sent when a step has been enhanced with AI suggestions
 */
export interface StepEnhancedMessage extends ExtensionMessage {
  type: 'STEP_ENHANCED';
  payload: {
    stepId: string;
  };
}

/**
 * ANALYZE_WORKFLOW message - request AI analysis of workflow
 */
export interface AnalyzeWorkflowMessage extends ExtensionMessage {
  type: 'ANALYZE_WORKFLOW';
  payload: {
    steps: import('./workflow').WorkflowStep[];
  };
}

/**
 * EXECUTE_WORKFLOW_ADAPTIVE message - execute workflow with intent
 */
export interface ExecuteWorkflowAdaptiveMessage extends ExtensionMessage {
  type: 'EXECUTE_WORKFLOW_ADAPTIVE';
  payload: {
    steps: import('./workflow').WorkflowStep[];
    intent?: import('./workflow').WorkflowIntent;
    // Variable substitution support
    variableValues?: Record<string, string>;
    workflowVariables?: import('../lib/variable-detector').WorkflowVariables;
  };
}

/**
 * CORRECTION_SAVED message - sent when a user correction is saved
 */
export interface CorrectionSavedMessage extends ExtensionMessage {
  type: 'CORRECTION_SAVED';
  payload?: {
    correctionId?: string;
  };
}

/**
 * ELEMENT_FIND_FAILED message - sent when element finding fails
 */
export interface ElementFindFailedMessage extends ExtensionMessage {
  type: 'ELEMENT_FIND_FAILED';
  payload: {
    stepId: string;
  };
}

/**
 * CANCEL_CORRECTION message - sent to cancel correction mode
 */
export interface CancelCorrectionMessage extends ExtensionMessage {
  type: 'CANCEL_CORRECTION';
  payload?: {};
}

