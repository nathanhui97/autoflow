/**
 * Extension state machine states
 */
export type ExtensionState = 
  | 'IDLE'
  | 'CONNECTING'
  | 'RECORDING'
  | 'PROCESSING_AI'
  | 'EXECUTING';

/**
 * Connection status for content script
 */
export type ConnectionStatus = 
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/**
 * Extension state interface
 */
export interface ExtensionStateData {
  state: ExtensionState;
  connectionStatus: ConnectionStatus;
  error: string | null;
  lastPingTime: number | null;
}




