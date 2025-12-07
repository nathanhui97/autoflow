/**
 * Content Script for GhostWriter Extension
 * Runs on all URLs and handles DOM interaction recording/replay
 */

// IMMEDIATE LOG - This should appear if script loads at all
console.log('GhostWriter: Content script file is executing...', new Date().toISOString());

// Set up message listener IMMEDIATELY, before any imports
// This ensures we can respond to PING even if imports fail
let isReady = false;
let recordingManager: any = null;

// Now do imports
import type { ExtensionMessage, MessageResponse, PongMessage } from '../types/messages';
import { RecordingManager } from './recording-manager';

// Full message handler with all message types
function handleFullMessage(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
): boolean {
  try {
    switch (message.type) {
      case 'PING': {
        const pongResponse: PongMessage = {
          type: 'PONG',
          payload: {
            timestamp: Date.now(),
            ready: isReady,
          },
        };
        sendResponse({
          success: true,
          data: pongResponse,
        });
        return false;
      }

      case 'START_RECORDING': {
        if (!recordingManager) {
          sendResponse({
            success: false,
            error: 'RecordingManager not initialized. Please wait a moment and try again.',
          });
          return false;
        }
        try {
          recordingManager.start();
          sendResponse({
            success: true,
            data: { message: 'Recording started' },
          });
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to start recording',
          });
        }
        return false;
      }

      case 'STOP_RECORDING': {
        if (!recordingManager) {
          sendResponse({
            success: false,
            error: 'RecordingManager not initialized',
          });
          return false;
        }
        try {
          recordingManager.stop();
          sendResponse({
            success: true,
            data: { message: 'Recording stopped' },
          });
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to stop recording',
          });
        }
        return false;
      }

      case 'EXECUTE_STEP': {
        console.log('Execute step requested', message.payload);
        sendResponse({
          success: true,
          data: { message: 'Step executed (placeholder)' },
        });
        return false;
      }

      default: {
        sendResponse({
          success: false,
          error: `Unknown message type: ${(message as ExtensionMessage).type}`,
        });
        return false;
      }
    }
  } catch (error) {
    console.error('GhostWriter: Error in message handler:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

// Register the message listener (single handler that works for both early and full)
// We'll update handleMessage to use the full handler after imports
const messageListener = (
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: any) => void
): boolean => {
  // Handle PING immediately (doesn't need imports)
  if (message?.type === 'PING') {
    try {
      sendResponse({
        success: true,
        data: {
          type: 'PONG',
          payload: {
            timestamp: Date.now(),
            ready: isReady,
          },
        },
      });
      return false;
    } catch (error) {
      console.error('GhostWriter: Error handling PING:', error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }
  
  // For other messages, use the full handler (which will be available after imports)
  try {
    return handleFullMessage(message as ExtensionMessage, sender, sendResponse);
  } catch (error) {
    console.error('GhostWriter: Error in full handler:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
};

// Register the message listener
try {
  chrome.runtime.onMessage.addListener(messageListener);
  console.log('GhostWriter: Message listener registered');
} catch (error) {
  console.error('GhostWriter: Failed to register message listener:', error);
}

// Initialize recording manager with error handling
try {
  recordingManager = new RecordingManager();
  console.log('GhostWriter: RecordingManager initialized successfully');
} catch (error) {
  console.error('GhostWriter: Failed to initialize RecordingManager:', error);
  if (error instanceof Error) {
    console.error('GhostWriter: Error message:', error.message);
    console.error('GhostWriter: Error stack:', error.stack);
  }
}


// Initialize content script
function initialize() {
  try {
    isReady = true;
    console.log('GhostWriter: Content script loaded and ready');
    console.log('GhostWriter: Current URL:', window.location.href);
    console.log('GhostWriter: Message listener registered:', !!chrome.runtime.onMessage.hasListeners());
    console.log('GhostWriter: RecordingManager available:', !!recordingManager);
    console.log('GhostWriter: Document ready state:', document.readyState);
    console.log('GhostWriter: Body exists:', !!document.body);
  } catch (error) {
    console.error('GhostWriter: Error initializing content script:', error);
    if (error instanceof Error) {
      console.error('GhostWriter: Error stack:', error.stack);
    }
  }
}

// Initialize immediately with error handling
try {
  initialize();
} catch (error) {
  console.error('GhostWriter: Failed to initialize content script:', error);
  if (error instanceof Error) {
    console.error('GhostWriter: Error stack:', error.stack);
  }
  // Still mark as ready so ping can work
  isReady = true;
}

// Inject a marker to identify that content script is loaded
if (document.body) {
  document.body.setAttribute('data-ghostwriter-ready', 'true');
} else {
  // Wait for DOM to be ready
  document.addEventListener('DOMContentLoaded', () => {
    document.body?.setAttribute('data-ghostwriter-ready', 'true');
  });
}

