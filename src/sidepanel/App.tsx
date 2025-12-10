import { useEffect, useState } from 'react';
import { useExtensionStore } from '../lib/store';
import { runtimeBridge } from '../lib/bridge';
import { WorkflowStorage } from '../lib/storage';
import type { ExtensionState } from '../types/state';
import type { WorkflowStep, SavedWorkflow } from '../types/workflow';
import type { 
  RecordedStepMessage, 
  UpdateStepMessage,
  AIValidationStartedMessage,
  AIValidationCompletedMessage,
  StepEnhancedMessage
} from '../types/messages';

function App() {
  const { 
    state, 
    connectionStatus, 
    error, 
    lastPingTime,
    workflowSteps,
    savedWorkflows,
    currentWorkflowName,
    isRecording,
    pendingAIValidations,
    enhancedSteps,
    setState,
    setConnectionStatus,
    setError,
    setLastPingTime,
    addWorkflowStep,
    updateWorkflowStep,
    clearWorkflowSteps,
    loadWorkflow,
    setSavedWorkflows,
    addSavedWorkflow,
    removeSavedWorkflow,
    setCurrentWorkflowName,
    setIsRecording,
    setAIValuationPending,
    setStepEnhanced,
  } = useExtensionStore();

  const [isPinging, setIsPinging] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [workflowName, setWorkflowName] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  // Ping content script on mount
  useEffect(() => {
    const performPing = async () => {
      setIsPinging(true);
      setConnectionStatus('connecting');
      setState('CONNECTING');
      setError(null);

      try {
        // Check what page we're on first
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentUrl = tab?.url || 'unknown';
        
        // Check if it's a restricted page
        if (currentUrl.startsWith('chrome://') || 
            currentUrl.startsWith('chrome-extension://') || 
            currentUrl.startsWith('about:') ||
            currentUrl.startsWith('edge://')) {
          setConnectionStatus('error');
          setState('IDLE');
          setError(`Content scripts cannot run on this page type: ${currentUrl}. Please navigate to a regular website (like google.com).`);
          setIsPinging(false);
          return;
        }

        const isReady = await runtimeBridge.ping();
        if (isReady) {
          setConnectionStatus('connected');
          setState('IDLE');
          setLastPingTime(Date.now());
        } else {
          setConnectionStatus('error');
          setState('IDLE'); // Make sure to set state to IDLE even on failure
          setError(`Content script not ready on ${currentUrl}. Try refreshing the page.`);
        }
      } catch (err) {
        console.error('Ping error:', err);
        setConnectionStatus('error');
        setState('IDLE'); // Make sure to set state to IDLE on error
        const errorMsg = err instanceof Error ? err.message : 'Failed to connect';
        setError(`${errorMsg}. Make sure you are on a regular web page and the extension is reloaded.`);
      } finally {
        setIsPinging(false);
      }
    };

    performPing();
  }, [setState, setConnectionStatus, setError, setLastPingTime]);

  // Load saved workflows on mount
  useEffect(() => {
    const loadSavedWorkflows = async () => {
      try {
        const workflows = await WorkflowStorage.loadWorkflows();
        setSavedWorkflows(workflows);
      } catch (err) {
        console.error('Error loading saved workflows:', err);
      }
    };

    loadSavedWorkflows();
  }, [setSavedWorkflows]);

  // Listen for RECORDED_STEP, UPDATE_STEP, and AI validation messages from content script
  useEffect(() => {
    const handleMessage = (
      message: RecordedStepMessage | UpdateStepMessage | AIValidationStartedMessage | AIValidationCompletedMessage | StepEnhancedMessage,
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (response?: any) => void
    ) => {
      if (message.type === 'RECORDED_STEP' && message.payload?.step) {
        addWorkflowStep(message.payload.step);
      } else if (message.type === 'UPDATE_STEP' && message.payload?.stepId && message.payload?.step) {
        updateWorkflowStep(message.payload.stepId, message.payload.step);
        // Mark as enhanced when step is updated with AI suggestions
        if (message.payload.step.payload.fallbackSelectors?.length > 0) {
          setStepEnhanced(message.payload.stepId);
        }
      } else if (message.type === 'AI_VALIDATION_STARTED' && message.payload?.stepId) {
        setAIValuationPending(message.payload.stepId, true);
      } else if (message.type === 'AI_VALIDATION_COMPLETED' && message.payload?.stepId) {
        setAIValuationPending(message.payload.stepId, false);
        if (message.payload.enhanced) {
          setStepEnhanced(message.payload.stepId);
        }
      } else if (message.type === 'STEP_ENHANCED' && message.payload?.stepId) {
        setAIValuationPending(message.payload.stepId, false);
        setStepEnhanced(message.payload.stepId);
      }
      return false;
    };

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener(handleMessage);

    // Cleanup listener on unmount
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [addWorkflowStep, updateWorkflowStep, setAIValuationPending, setStepEnhanced]);

  const handleStartRecording = async () => {
    try {
      clearWorkflowSteps();
      setCurrentWorkflowName(null);
      setIsRecording(true);
      setState('RECORDING');
      
      // Get the active tab to send message to its content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('No active tab found');
      }
      
      const response = await runtimeBridge.sendMessage(
        {
          type: 'START_RECORDING',
        },
        tab.id
      );
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to start recording');
      }
    } catch (err) {
      console.error('Start recording error:', err);
      setError(err instanceof Error ? err.message : 'Failed to start recording. Make sure you are on a regular web page.');
      setIsRecording(false);
      setState('IDLE');
    }
  };

  const handleStopRecording = async () => {
    try {
      setIsRecording(false);
      setState('IDLE');
      
      // Get the active tab to send message to its content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('No active tab found');
      }
      
      const response = await runtimeBridge.sendMessage(
        {
          type: 'STOP_RECORDING',
        },
        tab.id
      );
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to stop recording');
      }
    } catch (err) {
      console.error('Stop recording error:', err);
      setError(err instanceof Error ? err.message : 'Failed to stop recording');
    }
  };

  const handleSaveWorkflow = async () => {
    if (!workflowName.trim() || workflowSteps.length === 0) {
      return;
    }

    try {
      const workflow: SavedWorkflow = {
        id: `workflow-${Date.now()}`,
        name: workflowName.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: workflowSteps,
      };

      await WorkflowStorage.saveWorkflow(workflow);
      addSavedWorkflow(workflow);
      setCurrentWorkflowName(workflow.name);
      setShowSaveDialog(false);
      setWorkflowName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow');
    }
  };

  const handleLoadWorkflow = (workflow: SavedWorkflow) => {
    loadWorkflow(workflow);
    setState('IDLE');
  };

  const handleDeleteWorkflow = async (id: string) => {
    try {
      await WorkflowStorage.deleteWorkflow(id);
      removeSavedWorkflow(id);
      setShowDeleteConfirm(null);
      
      // Clear current workflow if it was deleted
      if (currentWorkflowName && savedWorkflows.find(w => w.id === id)?.name === currentWorkflowName) {
        clearWorkflowSteps();
        setCurrentWorkflowName(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workflow');
    }
  };

  const handleExportJSON = (steps: WorkflowStep[] = workflowSteps) => {
    const json = JSON.stringify(steps, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = `ghostwriter-workflow-${Date.now()}.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getStateColor = (currentState: ExtensionState) => {
    switch (currentState) {
      case 'IDLE':
        return 'bg-gray-500';
      case 'CONNECTING':
        return 'bg-yellow-500';
      case 'RECORDING':
        return 'bg-red-500';
      case 'PROCESSING_AI':
        return 'bg-blue-500';
      case 'EXECUTING':
        return 'bg-green-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'text-green-600';
      case 'connecting':
        return 'text-yellow-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-foreground">GhostWriter</h1>
        
        {/* Connection Status */}
        <div className="mb-6 p-4 bg-card rounded-lg border border-border">
          <h2 className="text-lg font-semibold mb-2 text-card-foreground">Connection Status</h2>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              connectionStatus === 'connected' ? 'bg-green-500' :
              connectionStatus === 'connecting' ? 'bg-yellow-500' :
              'bg-red-500'
            }`} />
            <span className={`font-medium ${getConnectionStatusColor()}`}>
              {connectionStatus.toUpperCase()}
            </span>
            {isPinging && (
              <span className="text-sm text-muted-foreground">(Pinging...)</span>
            )}
          </div>
          {lastPingTime && (
            <p className="text-sm text-muted-foreground mt-2">
              Last ping: {new Date(lastPingTime).toLocaleTimeString()}
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive mt-2">{error}</p>
          )}
        </div>

        {/* Extension State */}
        <div className="mb-6 p-4 bg-card rounded-lg border border-border">
          <h2 className="text-lg font-semibold mb-2 text-card-foreground">Extension State</h2>
          <div className="flex items-center gap-3">
            <div className={`w-4 h-4 rounded-full ${getStateColor(state)} animate-pulse`} />
            <span className="font-medium text-foreground">{state}</span>
          </div>
          {currentWorkflowName && (
            <p className="text-sm text-muted-foreground mt-2">
              Current workflow: {currentWorkflowName}
            </p>
          )}
          {pendingAIValidations.size > 0 && (
            <div className="mt-2 flex items-center gap-2 text-sm text-yellow-600">
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>AI validating {pendingAIValidations.size} step{pendingAIValidations.size > 1 ? 's' : ''}...</span>
            </div>
          )}
          {enhancedSteps.size > 0 && pendingAIValidations.size === 0 && (
            <div className="mt-2 flex items-center gap-2 text-sm text-blue-600">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>{enhancedSteps.size} step{enhancedSteps.size > 1 ? 's' : ''} enhanced with AI</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mb-6 p-4 bg-card rounded-lg border border-border">
          <h2 className="text-lg font-semibold mb-4 text-card-foreground">Actions</h2>
          <div className="space-y-2">
            <button
              onClick={handleStartRecording}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={state === 'RECORDING' || state === 'CONNECTING'}
            >
              Start Recording
            </button>
            <button
              onClick={handleStopRecording}
              className="w-full px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={state !== 'RECORDING'}
            >
              Stop Recording
            </button>
            <button
              onClick={() => setShowSaveDialog(true)}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={workflowSteps.length === 0 || isRecording}
            >
              Save Workflow
            </button>
            <button
              onClick={() => handleExportJSON()}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={workflowSteps.length === 0 || isRecording}
            >
              Export JSON
            </button>
            <button
              onClick={clearWorkflowSteps}
              className="w-full px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={workflowSteps.length === 0 || isRecording}
            >
              Clear Steps
            </button>
          </div>
        </div>

        {/* Recorded Steps */}
        {workflowSteps.length > 0 && (
          <div className="mb-6 p-4 bg-card rounded-lg border border-border">
            <h2 className="text-lg font-semibold mb-4 text-card-foreground">
              Recorded Steps ({workflowSteps.length})
            </h2>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {workflowSteps.map((step, index) => {
                const stepId = step.payload.timestamp.toString();
                const isPending = pendingAIValidations.has(stepId);
                const isEnhanced = enhancedSteps.has(stepId);
                const aiFallbackCount = step.payload.fallbackSelectors?.filter((s: string) => 
                  !s.includes('nth-of-type') && !s.includes('ng-star-inserted')
                ).length || 0;
                
                return (
                  <div 
                    key={index} 
                    className={`p-3 bg-muted rounded-md text-sm border-l-4 ${
                      isEnhanced ? 'border-blue-500' : 
                      isPending ? 'border-yellow-500 animate-pulse' : 
                      'border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-foreground">
                          {index + 1}. {step.type}
                        </div>
                        {step.description && (
                          <div className="text-sm text-blue-600 mt-1 font-medium">
                            {step.description}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {isPending && (
                          <div className="flex items-center gap-1 text-yellow-600 text-xs">
                            <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span>AI analyzing...</span>
                          </div>
                        )}
                        {isEnhanced && !isPending && (
                          <div className="flex items-center gap-1 text-blue-600 text-xs">
                            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            <span>AI enhanced</span>
                          </div>
                        )}
                      </div>
                    </div>
                    {step.payload.label && (
                      <div className="text-muted-foreground">Label: {step.payload.label}</div>
                    )}
                    {step.payload.value && (
                      <div className="text-muted-foreground">Value: {step.payload.value}</div>
                    )}
                    <div className="text-muted-foreground text-xs mt-1">
                      Selector: {step.payload.selector}
                    </div>
                    {isEnhanced && aiFallbackCount > 0 && (
                      <div className="text-blue-600 text-xs mt-1">
                        ✨ {aiFallbackCount} AI-enhanced fallback selector{aiFallbackCount > 1 ? 's' : ''} added
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Saved Workflows */}
        <div className="mb-6 p-4 bg-card rounded-lg border border-border">
          <h2 className="text-lg font-semibold mb-4 text-card-foreground">
            Saved Workflows ({savedWorkflows.length})
          </h2>
          {savedWorkflows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved workflows yet</p>
          ) : (
            <div className="space-y-3">
              {savedWorkflows.map((workflow) => (
                <div key={workflow.id} className="p-3 bg-muted rounded-md">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-medium text-foreground">{workflow.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatDate(workflow.updatedAt)} • {workflow.steps.length} steps
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleLoadWorkflow(workflow)}
                      className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                      disabled={isRecording}
                    >
                      Load
                    </button>
                    <button
                      onClick={() => handleExportJSON(workflow.steps)}
                      className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                    >
                      Export
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(workflow.id)}
                      className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                      disabled={isRecording}
                    >
                      Delete
                    </button>
                  </div>
                  {showDeleteConfirm === workflow.id && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
                      <p className="text-sm text-red-800 mb-2">Are you sure you want to delete this workflow?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDeleteWorkflow(workflow.id)}
                          className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                        >
                          Confirm Delete
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(null)}
                          className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Save Dialog */}
        {showSaveDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-card p-6 rounded-lg border border-border max-w-md w-full mx-4">
              <h2 className="text-xl font-semibold mb-4 text-card-foreground">Save Workflow</h2>
              <input
                type="text"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                placeholder={`Workflow ${new Date().toLocaleString()}`}
                className="w-full px-3 py-2 border border-border rounded-md mb-4 bg-background text-foreground"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveWorkflow();
                  } else if (e.key === 'Escape') {
                    setShowSaveDialog(false);
                  }
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveWorkflow}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                  disabled={!workflowName.trim()}
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setShowSaveDialog(false);
                    setWorkflowName('');
                  }}
                  className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
