/**
 * ReplayerView Component
 * 
 * Displays workflow execution progress with real-time step-by-step visualization
 */

import { useEffect, useState } from 'react';
import type { SavedWorkflow } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';

interface ReplayerViewProps {
  workflow: SavedWorkflow;
  variableValues?: Record<string, string>;
  onClose?: () => void;
  onSavePatches?: (workflow: SavedWorkflow) => void;
}

interface StepStatus {
  status: 'pending' | 'executing' | 'completed' | 'failed';
  error?: string;
}

export function ReplayerView({
  workflow,
  variableValues,
  onClose,
  onSavePatches,
}: ReplayerViewProps) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);
  const [stepStatuses, setStepStatuses] = useState<Map<number, StepStatus>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [patchesCount, setPatchesCount] = useState(0);
  const [showSavePrompt, setShowSavePrompt] = useState(false);

  // Initialize step statuses
  useEffect(() => {
    const initialStatuses = new Map<number, StepStatus>();
    workflow.steps.forEach((_, index) => {
      initialStatuses.set(index, { status: 'pending' });
    });
    setStepStatuses(initialStatuses);
  }, [workflow]);

  // Listen for execution progress messages
  useEffect(() => {
    const handleMessage = (
      message: any,
      _sender: chrome.runtime.MessageSender
    ) => {
      if (message.type === 'EXECUTION_STARTED') {
        setIsExecuting(true);
        setError(null);
        setCurrentStepIndex(null);
        // Reset all step statuses to pending
        const newStatuses = new Map<number, StepStatus>();
        workflow.steps.forEach((_, index) => {
          newStatuses.set(index, { status: 'pending' });
        });
        setStepStatuses(newStatuses);
      } else if (message.type === 'EXECUTION_STEP_STARTED') {
        const stepIndex = message.payload.stepIndex;
        setCurrentStepIndex(stepIndex);
        setStepStatuses(prev => {
          const next = new Map(prev);
          next.set(stepIndex, { status: 'executing' });
          return next;
        });
      } else if (message.type === 'EXECUTION_STEP_COMPLETED') {
        const stepIndex = message.payload.stepIndex;
        setStepStatuses(prev => {
          const next = new Map(prev);
          next.set(stepIndex, { status: 'completed' });
          return next;
        });
      } else if (message.type === 'EXECUTION_STEP_FAILED') {
        const stepIndex = message.payload.stepIndex;
        setStepStatuses(prev => {
          const next = new Map(prev);
          next.set(stepIndex, { 
            status: 'failed',
            error: message.payload.error,
          });
          return next;
        });
        setError(message.payload.error);
      } else if (message.type === 'EXECUTION_COMPLETED') {
        setIsExecuting(false);
        setCurrentStepIndex(null);
        if (message.payload.patchesCount && message.payload.patchesCount > 0) {
          setPatchesCount(message.payload.patchesCount);
          setShowSavePrompt(true);
        }
      } else if (message.type === 'EXECUTION_ERROR') {
        setIsExecuting(false);
        setError(message.payload.error);
      }
    };

    // Register message listeners
    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [workflow]);

  const handleStart = async () => {
    try {
      setError(null);
      setIsExecuting(true);

      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('No active tab found');
      }

      let targetTabId = tab.id;
      let didNavigate = false;

      // Get starting URL from first step's URL
      const startingUrl = workflow.steps.length > 0 && isWorkflowStepPayload(workflow.steps[0].payload)
        ? workflow.steps[0].payload.url
        : undefined;

      // Navigate to starting URL if available and different from current URL
      if (startingUrl && tab.url !== startingUrl) {
        didNavigate = true;
        try {
          console.log(`[ReplayerView] Navigating to starting URL: ${startingUrl}`);
          await chrome.tabs.update(tab.id, { url: startingUrl });
          
          // Wait for page to load
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              reject(new Error('Navigation timeout'));
            }, 15000); // 15 second timeout

            const listener = (tabId: number, changeInfo: { status?: string; url?: string }) => {
              if (tabId === tab.id) {
                if (changeInfo.status === 'complete') {
                  clearTimeout(timeout);
                  chrome.tabs.onUpdated.removeListener(listener);
                  // Additional wait for page to be fully ready
                  setTimeout(() => resolve(), 1000);
                } else if (changeInfo.status === 'loading' && changeInfo.url) {
                  // URL changed, page is loading
                  console.log(`[ReplayerView] Page loading: ${changeInfo.url}`);
                }
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
          
          // Re-query tab to get updated tab (in case URL changed)
          const [updatedTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (updatedTab?.id) {
            targetTabId = updatedTab.id;
          }
          
          // Wait for content script to be ready (ping it)
          let contentScriptReady = false;
          for (let attempt = 0; attempt < 10; attempt++) {
            try {
              const pingResponse = await chrome.tabs.sendMessage(targetTabId, {
                type: 'PING',
                payload: { timestamp: Date.now() },
              });
              if (pingResponse?.success && pingResponse.data?.type === 'PONG') {
                contentScriptReady = true;
                console.log(`[ReplayerView] Content script ready after ${attempt + 1} attempt(s)`);
                break;
              }
            } catch (pingError) {
              // Content script not ready yet, wait and retry
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
          
          if (!contentScriptReady) {
            console.warn('[ReplayerView] Content script not ready after navigation, continuing anyway');
          }
        } catch (navError) {
          console.warn('[ReplayerView] Navigation error, continuing anyway:', navError);
          // Continue execution even if navigation fails
        }
      }

      // Use the target tab ID (may have changed after navigation)
      if (!targetTabId) {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!currentTab?.id) {
          throw new Error('No active tab found');
        }
        targetTabId = currentTab.id;
      }

      // Send execution message to content script
      // Progress messages will come via chrome.runtime.onMessage from content script
      const response = await chrome.tabs.sendMessage(targetTabId, {
        type: 'EXECUTE_WORKFLOW_ADAPTIVE',
        payload: {
          steps: workflow.steps,
          intent: workflow.analyzedIntent,
          variableValues,
          workflowVariables: workflow.variables,
          justNavigated: didNavigate, // Tell execution engine we just navigated
        },
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Failed to start execution');
      }
    } catch (err) {
      console.error('Start execution error:', err);
      setError(err instanceof Error ? err.message : 'Failed to start execution');
      setIsExecuting(false);
    }
  };

  const handleStop = async () => {
    // Send cancellation message (will be handled by execution engine)
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'EXECUTION_CANCELLED',
        });
      }
    } catch (err) {
      console.error('Stop execution error:', err);
    }
    setIsExecuting(false);
    setCurrentStepIndex(null);
  };

  const handleSavePatches = () => {
    if (onSavePatches) {
      onSavePatches(workflow);
    }
    setShowSavePrompt(false);
    setPatchesCount(0);
  };

  const handleDiscardPatches = () => {
    setShowSavePrompt(false);
    setPatchesCount(0);
  };

  const progress = workflow.steps.length > 0 && currentStepIndex !== null
    ? ((currentStepIndex + 1) / workflow.steps.length) * 100
    : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{workflow.name}</h2>
          <p className="text-sm text-muted-foreground">
            {workflow.steps.length} step{workflow.steps.length !== 1 ? 's' : ''}
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700"
            disabled={isExecuting}
          >
            Close
          </button>
        )}
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {currentStepIndex !== null ? `Step ${currentStepIndex + 1} of ${workflow.steps.length}` : 'Ready'}
          </span>
          <span className="text-muted-foreground">{Math.round(progress)}%</span>
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Execution Controls */}
      <div className="flex gap-2">
        {!isExecuting ? (
          <button
            onClick={handleStart}
            className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium"
          >
            Start Execution
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium"
          >
            Stop Execution
          </button>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Step List */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {workflow.steps.map((step, index) => {
          const status = stepStatuses.get(index) || { status: 'pending' as const };
          const isCurrent = currentStepIndex === index;
          const stepId = isWorkflowStepPayload(step.payload) 
            ? String(step.payload.timestamp) 
            : `step-${index}`;

          return (
            <div
              key={stepId}
              className={`p-3 rounded-md border-l-4 ${
                isCurrent
                  ? 'bg-blue-50 border-blue-500'
                  : status.status === 'completed'
                  ? 'bg-green-50 border-green-500'
                  : status.status === 'failed'
                  ? 'bg-red-50 border-red-500'
                  : 'bg-muted border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1">
                  <div className="flex-shrink-0">
                    {status.status === 'completed' ? (
                      <svg className="h-5 w-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    ) : status.status === 'failed' ? (
                      <svg className="h-5 w-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    ) : isCurrent ? (
                      <svg className="h-5 w-5 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <div className="h-5 w-5 rounded-full border-2 border-gray-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground">
                      {index + 1}. {step.type}
                      {isCurrent && <span className="ml-2 text-blue-600 text-sm">(Executing...)</span>}
                    </div>
                    {step.description && (
                      <div className="text-sm text-muted-foreground mt-1">{step.description}</div>
                    )}
                    {status.error && (
                      <div className="text-sm text-red-600 mt-1">{status.error}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Save Patches Prompt */}
      {showSavePrompt && patchesCount > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded-lg border border-border max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-2 text-card-foreground">
              Workflow Repaired
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              The workflow was repaired during execution ({patchesCount} selector{patchesCount !== 1 ? 's' : ''} updated).
              Would you like to save these changes?
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleSavePatches}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              >
                Save Changes
              </button>
              <button
                onClick={handleDiscardPatches}
                className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

