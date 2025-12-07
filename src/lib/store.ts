import { create } from 'zustand';
import type { ExtensionState, ExtensionStateData, ConnectionStatus } from '../types/state';
import type { WorkflowStep, SavedWorkflow } from '../types/workflow';

interface ExtensionStore extends ExtensionStateData {
  // Workflow state
  workflowSteps: WorkflowStep[];
  savedWorkflows: SavedWorkflow[];
  currentWorkflowName: string | null;
  isRecording: boolean;

  // Actions
  setState: (state: ExtensionState) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setError: (error: string | null) => void;
  setLastPingTime: (timestamp: number | null) => void;
  addWorkflowStep: (step: WorkflowStep) => void;
  clearWorkflowSteps: () => void;
  loadWorkflow: (workflow: SavedWorkflow) => void;
  setSavedWorkflows: (workflows: SavedWorkflow[]) => void;
  addSavedWorkflow: (workflow: SavedWorkflow) => void;
  removeSavedWorkflow: (id: string) => void;
  setCurrentWorkflowName: (name: string | null) => void;
  setIsRecording: (recording: boolean) => void;
  reset: () => void;
}

const initialState: ExtensionStateData = {
  state: 'IDLE',
  connectionStatus: 'disconnected',
  error: null,
  lastPingTime: null,
};

export const useExtensionStore = create<ExtensionStore>((set) => ({
  ...initialState,

  // Workflow state
  workflowSteps: [],
  savedWorkflows: [],
  currentWorkflowName: null,
  isRecording: false,

  setState: (state: ExtensionState) => {
    set({ state, error: null }); // Clear error when state changes
  },

  setConnectionStatus: (status: ConnectionStatus) => {
    set({ connectionStatus: status });
  },

  setError: (error: string | null) => {
    set({ error });
  },

  setLastPingTime: (timestamp: number | null) => {
    set({ lastPingTime: timestamp });
  },

  addWorkflowStep: (step: WorkflowStep) => {
    set((state) => ({
      workflowSteps: [...state.workflowSteps, step],
    }));
  },

  clearWorkflowSteps: () => {
    set({ workflowSteps: [], currentWorkflowName: null });
  },

  loadWorkflow: (workflow: SavedWorkflow) => {
    set({
      workflowSteps: workflow.steps,
      currentWorkflowName: workflow.name,
    });
  },

  setSavedWorkflows: (workflows: SavedWorkflow[]) => {
    set({ savedWorkflows: workflows });
  },

  addSavedWorkflow: (workflow: SavedWorkflow) => {
    set((state) => {
      const existing = state.savedWorkflows.findIndex((w) => w.id === workflow.id);
      if (existing >= 0) {
        // Update existing
        const updated = [...state.savedWorkflows];
        updated[existing] = workflow;
        return { savedWorkflows: updated };
      }
      // Add new
      return { savedWorkflows: [...state.savedWorkflows, workflow] };
    });
  },

  removeSavedWorkflow: (id: string) => {
    set((state) => ({
      savedWorkflows: state.savedWorkflows.filter((w) => w.id !== id),
    }));
  },

  setCurrentWorkflowName: (name: string | null) => {
    set({ currentWorkflowName: name });
  },

  setIsRecording: (recording: boolean) => {
    set({ isRecording: recording });
  },

  reset: () => {
    set({
      ...initialState,
      workflowSteps: [],
      savedWorkflows: [],
      currentWorkflowName: null,
      isRecording: false,
    });
  },
}));

