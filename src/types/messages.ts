/**
 * Message types for communication between Side Panel, Background, and Content Scripts
 */
export type MessageType = 
  | 'PING' 
  | 'PONG'
  | 'START_RECORDING' 
  | 'STOP_RECORDING' 
  | 'EXECUTE_STEP'
  | 'RECORDED_STEP';

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

