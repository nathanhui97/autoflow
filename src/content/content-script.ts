/**
 * Content Script for GhostWriter Extension
 * Runs on all URLs and handles DOM interaction recording/replay
 */

// IMMEDIATE LOG - This should appear if script loads at all
// Version identifier for debugging - update this when making significant changes
const EXTENSION_VERSION = 'v0.1.1-starting-page-validation';
const BUILD_TIMESTAMP = new Date().toISOString();
console.log(`🚀 GhostWriter: Content script loaded (${EXTENSION_VERSION}) - ${BUILD_TIMESTAMP}`);

// Dynamically detect build hash from script URL
try {
  const scripts = document.querySelectorAll('script[src*="content-script"]');
  if (scripts.length > 0) {
    const src = scripts[scripts.length - 1].getAttribute('src') || '';
    const hashMatch = src.match(/content-script\.ts-([A-Za-z0-9]+)\.js/);
    if (hashMatch) {
      console.log(`📦 Build hash: content-script.ts-${hashMatch[1]}.js`);
    }
  }
} catch (e) {
  // Fallback: try to get from chrome.runtime.getURL if available
  try {
    const url = chrome.runtime.getURL('assets/content-script.ts-loader-eLd2ZhJw.js');
    console.log(`📦 Loader script: ${url}`);
  } catch {}
}

// Set up message listener IMMEDIATELY, before any imports
// This ensures we can respond to PING even if imports fail
let isReady = false;
let recordingManager: any = null;

// Now do imports
import type { ExtensionMessage, MessageResponse, PongMessage } from '../types/messages';
import { RecordingManager } from './recording-manager';
import { AIWorkflowAnalyzer } from './ai-workflow-analyzer';
import { PatternDetector } from './pattern-detector';
import { AIDataBuilder } from './ai-data-builder';
import { VisualSnapshotService } from './visual-snapshot';
import type { WorkflowStep } from '../types/workflow';
// Universal Execution Engine - the new reliable execution engine
import { executeWorkflow as executeUniversalWorkflow, convertLegacyStep } from './universal-execution';

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

      case 'START_RECORDING_IN_TAB': {
        // Internal message from service worker to start recording in this tab
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
            data: { message: 'Recording started in tab' },
          });
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to start recording in tab',
          });
        }
        return false;
      }

      case 'STOP_RECORDING_IN_TAB': {
        // Internal message from service worker to stop recording in this tab
        if (!recordingManager) {
          sendResponse({
            success: false,
            error: 'RecordingManager not initialized',
          });
          return false;
        }
        // Handle async stop() method
        (async () => {
          try {
            await recordingManager.stop();
            sendResponse({
              success: true,
              data: { message: 'Recording stopped in tab' },
            });
          } catch (error) {
            sendResponse({
              success: false,
              error: error instanceof Error ? error.message : 'Failed to stop recording in tab',
            });
          }
        })();
        return true; // Keep channel open for async response
      }

      case 'STOP_RECORDING': {
        if (!recordingManager) {
          sendResponse({
            success: false,
            error: 'RecordingManager not initialized',
          });
          return false;
        }
        // Handle async stop() method
        (async () => {
          try {
            await recordingManager.stop();
            // Include initial full page snapshot if available (for spreadsheet column headers)
            // Use async version to wait for capture to complete if still in progress
            const initialSnapshot = await recordingManager.getInitialFullPageSnapshotAsync();
            sendResponse({
              success: true,
              data: { 
                message: 'Recording stopped',
                initialFullPageSnapshot: initialSnapshot || undefined,
              },
            });
          } catch (error) {
            sendResponse({
              success: false,
              error: error instanceof Error ? error.message : 'Failed to stop recording',
            });
          }
        })();
        return true; // Keep channel open for async response
      }

      case 'GET_INITIAL_SNAPSHOT': {
        if (!recordingManager) {
          sendResponse({
            success: false,
            error: 'RecordingManager not initialized',
          });
          return false;
        }
        const snapshot = recordingManager.getInitialFullPageSnapshot();
        sendResponse({
          success: true,
          data: { initialFullPageSnapshot: snapshot || null },
        });
        return false;
      }

      case 'REFRESH_PAGE': {
        // Check if current page is a spreadsheet domain
        const isSpreadsheet = VisualSnapshotService.isSpreadsheetDomain();
        
        if (!isSpreadsheet) {
          sendResponse({
            success: false,
            error: 'Refresh is only available for spreadsheet domains',
          });
          return false;
        }

        try {
          console.log('📸 GhostWriter: Refreshing page to capture headers...');
          
          // Set flag in sessionStorage to auto-start recording after refresh
          sessionStorage.setItem('ghostwriter_auto_start_recording', 'true');
          
          // Ensure scroll is at (0, 0) before refresh
          window.scrollTo(0, 0);
          
          // Small delay to ensure scroll completes, then refresh
          setTimeout(() => {
            window.location.reload();
          }, 100);
          
          // Send immediate response (page will reload, so async response won't work)
          sendResponse({
            success: true,
            data: { message: 'Page refresh initiated' },
          });
        } catch (error) {
          console.error('📸 GhostWriter: Refresh failed:', error);
          sessionStorage.removeItem('ghostwriter_auto_start_recording');
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to refresh page',
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

      case 'ANALYZE_WORKFLOW': {
        if (!message.payload?.steps) {
          sendResponse({
            success: false,
            error: 'ANALYZE_WORKFLOW requires steps in payload',
          });
          return false;
        }

        // Analyze workflow asynchronously
        (async () => {
          try {
            const steps = message.payload.steps as WorkflowStep[];
            
            // Detect pattern first
            const pattern = PatternDetector.detectPattern(steps);
            
            // Analyze with AI
            const analyzer = new AIWorkflowAnalyzer();
            const intent = await analyzer.analyzeWorkflow(steps, pattern || undefined);
            
            // Send response back
            chrome.runtime.sendMessage({
              type: 'ANALYZE_WORKFLOW_RESPONSE',
              payload: { intent },
            });
          } catch (error) {
            console.error('GhostWriter: Error analyzing workflow:', error);
            chrome.runtime.sendMessage({
              type: 'ANALYZE_WORKFLOW_RESPONSE',
              payload: {
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            });
          }
        })();

        // Return immediately (async response will be sent separately)
        sendResponse({
          success: true,
          data: { message: 'Analysis started' },
        });
        return false;
      }

      // All workflow execution now uses the Universal Execution Engine
      case 'EXECUTE_WORKFLOW':
      case 'EXECUTE_WORKFLOW_ADAPTIVE':  // @deprecated - redirects to Universal Engine
      case 'EXECUTE_WORKFLOW_VERIFIED':  // @deprecated - redirects to Universal Engine
      case 'EXECUTE_WORKFLOW_UNIVERSAL': {
        if (!message.payload?.steps) {
          sendResponse({
            success: false,
            error: 'EXECUTE_WORKFLOW requires steps in payload',
          });
          return false;
        }

        // Execute workflow with new Universal Engine
        (async () => {
          try {
            const steps = message.payload.steps as WorkflowStep[];
            const workflowId = message.payload.workflowId as string || 'unknown';
            const variableValues = message.payload.variableValues as Record<string, string> || {};
            
            console.log('GhostWriter: Starting UNIVERSAL execution for workflow:', workflowId);
            
            // Notify execution started
            chrome.runtime.sendMessage({
              type: 'VERIFIED_EXECUTION_STARTED',
              payload: { workflowId },
            });
            
            // Convert legacy steps to universal format
            const universalSteps = steps.map(step => convertLegacyStep(step));
            
            // Execute with universal engine
            const result = await executeUniversalWorkflow(universalSteps, {
              stopOnFailure: true,
              stepTimeout: 10000,
              variableValues,
              onStepProgress: (stepIndex, status) => {
                chrome.runtime.sendMessage({
                  type: status === 'starting' ? 'VERIFIED_STEP_STARTED' :
                        status === 'completed' ? 'VERIFIED_STEP_COMPLETED' : 'VERIFIED_STEP_FAILED',
                  payload: { stepIndex },
                });
              },
              onStepError: (stepIndex, error) => {
                console.error(`GhostWriter: Universal step ${stepIndex} error:`, error);
              },
            });
            
            // Notify execution completed
            chrome.runtime.sendMessage({
              type: 'VERIFIED_EXECUTION_COMPLETED',
              payload: {
                success: result.success,
                stepsExecuted: result.stepsCompleted,
                totalSteps: result.totalSteps,
                totalTimeMs: result.totalElapsedMs,
                error: result.success ? undefined : result.failureSummary,
              },
            });
            
          } catch (error) {
            console.error('GhostWriter: Error in universal execution:', error);
            chrome.runtime.sendMessage({
              type: 'VERIFIED_EXECUTION_COMPLETED',
              payload: {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            });
          }
        })();

        sendResponse({
          success: true,
          data: { message: 'Universal execution started' },
        });
        return false;
      }

      case 'VERIFIED_EXECUTION_CANCEL': {
        // TODO: Add proper cancellation support in universal engine
        console.log('GhostWriter: Execution cancellation requested');
        sendResponse({ success: true });
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
  
  // Check if we should auto-start recording after page refresh
  const shouldAutoStart = sessionStorage.getItem('ghostwriter_auto_start_recording') === 'true';
  if (shouldAutoStart) {
    console.log('📸 GhostWriter: Auto-starting recording after page refresh');
    sessionStorage.removeItem('ghostwriter_auto_start_recording');
    
    // Wait for page to fully load and spreadsheet to render
    const startRecording = async () => {
      // Wait for page to be fully loaded
      if (document.readyState !== 'complete') {
        await new Promise(resolve => {
          if (document.readyState === 'complete') {
            resolve(undefined);
          } else {
            window.addEventListener('load', () => resolve(undefined), { once: true });
          }
        });
      }
      
      // Additional wait for spreadsheet to fully render
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Ensure scroll is at (0, 0) to guarantee header row is visible
      window.scrollTo(0, 0);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify scroll position
      const scrollY = window.scrollY || window.pageYOffset || 0;
      if (scrollY !== 0) {
        console.warn('📸 GhostWriter: Scroll position not at top after refresh, forcing scroll');
        window.scrollTo(0, 0);
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      console.log('📸 GhostWriter: Page refreshed, scroll position:', { x: window.scrollX, y: window.scrollY });
      
      // Start recording
      if (recordingManager) {
        recordingManager.start();
      }
    };
    
    startRecording().catch((error) => {
      console.error('📸 GhostWriter: Failed to auto-start recording after refresh:', error);
    });
  }
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
    
    // Expose test function for Phase 1 testing (dev only)
    (window as any).testPhase1 = (steps: WorkflowStep[]) => {
      AIDataBuilder.testPhase1(steps);
    };
    console.log('GhostWriter: Phase 1 test function available: window.testPhase1(steps)');
    
    // Expose test function for snapshot testing (dev only)
    (window as any).testSnapshot = async (selector?: string) => {
      const element = selector 
        ? document.querySelector(selector)
        : document.body?.querySelector('button, a, input, [role="button"]') || document.body;
      
      if (!element) {
        console.error('📸 Test: No element found');
        return;
      }
      
      console.log('📸 Test: Testing snapshot capture on element:', element);
      console.log('📸 Test: Element bounds:', element.getBoundingClientRect());
      
      try {
        const result = await VisualSnapshotService.capture(element);
        if (result) {
          console.log('✅ Test: Snapshot captured successfully!');
          console.log('📸 Test: Viewport size:', result.viewport.length, 'chars');
          console.log('📸 Test: Element snippet size:', result.elementSnippet.length, 'chars');
          console.log('📸 Test: Viewport preview:', result.viewport.substring(0, 100) + '...');
          console.log('📸 Test: Snippet preview:', result.elementSnippet.substring(0, 100) + '...');
          
          // Create a test image to verify it works
          const img = document.createElement('img');
          img.src = result.elementSnippet;
          img.style.maxWidth = '300px';
          img.style.border = '2px solid green';
          img.style.margin = '10px';
          document.body.appendChild(img);
          console.log('📸 Test: Image element added to page for visual verification');
        } else {
          console.error('❌ Test: Snapshot returned null');
        }
      } catch (error) {
        console.error('❌ Test: Snapshot capture failed:', error);
      }
    };
    console.log('GhostWriter: Snapshot test function available: window.testSnapshot(selector?)');
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

