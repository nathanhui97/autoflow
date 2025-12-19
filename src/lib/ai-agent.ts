/**
 * AI Agent Controller
 * 
 * The brain of the automation system. Uses an observe-act loop where:
 * 1. Agent observes the current page state (screenshot + metadata)
 * 2. Agent thinks about what action to take based on goal and hints
 * 3. Agent instructs the extension to execute the action
 * 4. Agent observes the result and repeats
 * 
 * The extension is just a "tool" - the AI makes all decisions.
 */

import { aiConfig } from './ai-config';
import { VisualSnapshotService } from '../content/visual-snapshot';
import type { WorkflowStepPayload, SavedWorkflow } from '../types/workflow';

// ============================================================================
// Types
// ============================================================================

/** Actions the agent can take */
export type AgentActionType = 'click' | 'type' | 'scroll' | 'navigate' | 'wait' | 'done' | 'fail';

/** Semantic target for clicks - Extended for v2 */
export interface SemanticTarget {
  // Text matching
  text?: string;
  textMatch?: 'exact' | 'contains' | 'startsWith' | 'endsWith' | 'fuzzy';
  
  // Element identity
  role?: string;
  tagName?: string;
  ariaLabel?: string;
  testId?: string;
  title?: string;
  placeholder?: string;
  name?: string;
  
  // Context
  nearbyText?: string[];
  region?: string;
  parentText?: string;
  
  // Disambiguation
  index?: number;
  className?: string;
  
  // Timing
  waitTimeout?: number;
  
  // Canvas/Grid fallback (for Excel, Airtable)
  fallbackCoordinates?: { x: number; y: number };
}

/** Parameters for each action type */
export interface AgentActionParams {
  // For click (semantic targeting)
  target?: SemanticTarget;
  // For type
  text?: string;
  // For scroll
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  // For navigate
  url?: string;
  // For wait
  duration?: number;
  // For fail
  reason?: string;
}

/** An action decided by the agent */
export interface AgentAction {
  type: AgentActionType;
  params: AgentActionParams;
  reasoning: string;
  confidence: number;
  /** Which hint step this action corresponds to (if any) */
  hintStepIndex?: number;
}

/** A hint derived from recorded workflow steps */
export interface AgentHint {
  stepNumber: number;
  description: string;
  actionType: 'click' | 'type' | 'navigate' | 'other';
  targetText?: string;
  targetRole?: string;
  value?: string;
  completed: boolean;
  /** Screenshot from recording time (with annotation) */
  referenceScreenshot?: string;
  /** Click coordinates from recording */
  clickPoint?: { x: number; y: number };
}

/** Current observation of the page */
export interface AgentObservation {
  screenshot: string;
  url: string;
  title: string;
  viewportSize: { width: number; height: number };
  timestamp: number;
}

/** A single entry in action history */
export interface ActionHistoryEntry {
  stepNumber: number;
  action: AgentAction;
  observation: AgentObservation;
  result: 'success' | 'failed' | 'pending';
  error?: string;
  timestamp: number;
}

/** Agent state during execution */
export interface AgentState {
  workflowId?: string;
  goal: string;
  hints: AgentHint[];
  history: ActionHistoryEntry[];
  currentHintIndex: number;
  status: 'running' | 'completed' | 'failed' | 'paused';
  startTime: number;
  variableValues?: Record<string, string>;
}

/** Result of agent execution */
export interface AgentResult {
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  history: ActionHistoryEntry[];
  elapsedMs: number;
  finalStatus: AgentState['status'];
  error?: string;
}

/** Progress callback */
export type AgentProgressCallback = (
  stepNumber: number,
  action: AgentAction,
  status: 'thinking' | 'acting' | 'completed' | 'failed'
) => void;

// ============================================================================
// AI Agent Class
// ============================================================================

export class AIAgent {
  private state: AgentState;
  private maxSteps: number;
  // @ts-ignore - stepTimeout is stored for potential future use in API timeout
  private stepTimeout: number;
  private onProgress?: AgentProgressCallback;

  constructor(options: {
    maxSteps?: number;
    stepTimeout?: number;
    onProgress?: AgentProgressCallback;
  } = {}) {
    this.maxSteps = options.maxSteps ?? 50;
    this.stepTimeout = options.stepTimeout ?? 30000; // Used for API timeout
    this.onProgress = options.onProgress;
    
    this.state = {
      goal: '',
      hints: [],
      history: [],
      currentHintIndex: 0,
      status: 'paused',
      startTime: 0,
    };
  }

  /**
   * Run the agent to complete a workflow
   */
  async run(workflow: SavedWorkflow, variableValues?: Record<string, string>): Promise<AgentResult> {
    console.log('[AIAgent] Starting workflow execution');
    
    // Initialize state
    this.state = {
      workflowId: workflow.id,
      goal: this.inferGoal(workflow),
      hints: this.extractHints(workflow, variableValues),
      history: [],
      currentHintIndex: 0,
      status: 'running',
      startTime: Date.now(),
      variableValues,
    };

    console.log(`[AIAgent] Goal: ${this.state.goal}`);
    console.log(`[AIAgent] Hints: ${this.state.hints.length} steps`);
    
    return this.continueExecution();
  }
  
  /**
   * Resume execution from saved state
   */
  async resume(savedState: AgentState): Promise<AgentResult> {
    console.log('[AIAgent] Resuming from saved state');
    this.state = savedState;
    this.state.status = 'running';
    
    // Move to next hint after navigation
    if (this.state.currentHintIndex < this.state.hints.length - 1) {
      this.state.currentHintIndex++;
    }
    
    return this.continueExecution();
  }
  
  /**
   * Continue execution loop
   */
  private async continueExecution(): Promise<AgentResult> {
    console.log('[AIAgent] Continuing execution');

    try {
      // Main observe-act loop
      while (this.state.status === 'running') {
        // Safety check
        if (this.state.history.length >= this.maxSteps) {
          console.warn('[AIAgent] Max steps reached');
          this.state.status = 'failed';
          break;
        }

        // 1. Observe
        const observation = await this.observe();
        console.log(`[AIAgent] Observed: ${observation.url}`);

        // 2. Think
        this.onProgress?.(this.state.currentHintIndex, { type: 'wait', params: {}, reasoning: 'Thinking...', confidence: 0 }, 'thinking');
        const action = await this.think(observation);
        console.log(`[AIAgent] Action: ${action.type}`, action.params);
        console.log(`[AIAgent] Reasoning: ${action.reasoning}`);

        // 3. Check if done
        if (action.type === 'done') {
          console.log('[AIAgent] Goal achieved!');
          this.state.status = 'completed';
          break;
        }

        if (action.type === 'fail') {
          console.error('[AIAgent] Agent decided to fail:', action.params.reason);
          this.state.status = 'failed';
          break;
        }
        
        // 4. Handle navigation specially
        if (action.type === 'navigate') {
          console.log('[AIAgent] Saving state before navigation');
          await this.saveStateBeforeNavigation();
          
          // Execute navigation
          this.onProgress?.(this.state.currentHintIndex, action, 'acting');
          await this.act(action);
          
          // Navigation will reload page, so return early
          // The agent will resume after reload
          return {
            success: true,
            stepsCompleted: this.state.history.filter(h => h.result === 'success').length,
            totalSteps: this.state.hints.length,
            history: this.state.history,
            elapsedMs: Date.now() - this.state.startTime,
            finalStatus: 'running',
          };
        }

        // 4. Act (non-navigation actions)
        this.onProgress?.(this.state.currentHintIndex, action, 'acting');
        const result = await this.act(action);

        // 5. Record history
        const historyEntry: ActionHistoryEntry = {
          stepNumber: this.state.history.length + 1,
          action,
          observation,
          result: result.success ? 'success' : 'failed',
          error: result.error,
          timestamp: Date.now(),
        };
        this.state.history.push(historyEntry);

        // 6. Update hint progress
        if (result.success && action.hintStepIndex !== undefined) {
          this.state.hints[action.hintStepIndex].completed = true;
          this.state.currentHintIndex = Math.min(
            action.hintStepIndex + 1,
            this.state.hints.length - 1
          );
        }

        this.onProgress?.(
          this.state.currentHintIndex,
          action,
          result.success ? 'completed' : 'failed'
        );

        // Brief pause between actions
        await this.sleep(500);
      }
    } catch (error) {
      console.error('[AIAgent] Error:', error);
      this.state.status = 'failed';
    }

    return {
      success: this.state.status === 'completed',
      stepsCompleted: this.state.history.filter(h => h.result === 'success').length,
      totalSteps: this.state.hints.length,
      history: this.state.history,
      elapsedMs: Date.now() - this.state.startTime,
      finalStatus: this.state.status,
      error: this.state.status === 'failed' 
        ? this.state.history[this.state.history.length - 1]?.error 
        : undefined,
    };
  }
  
  /**
   * Save state before navigation
   */
  private async saveStateBeforeNavigation(): Promise<void> {
    const stateToSave = {
      workflowId: this.state.workflowId,
      goal: this.state.goal,
      hints: this.state.hints,
      history: this.state.history,
      currentHintIndex: this.state.currentHintIndex,
      status: 'running' as const,
      startTime: this.state.startTime,
      variableValues: this.state.variableValues,
    };
    
    await chrome.storage.local.set({ agentState: stateToSave });
    console.log('[AIAgent] State saved for resumption after navigation');
  }


  /**
   * Observe the current page state
   */
  private async observe(): Promise<AgentObservation> {
    // Capture screenshot
    const capture = await VisualSnapshotService.captureFullPage(0.8);
    
    return {
      screenshot: capture?.screenshot || '',
      url: window.location.href,
      title: document.title,
      viewportSize: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Think about what action to take
   */
  private async think(observation: AgentObservation): Promise<AgentAction> {
    const config = aiConfig.getConfig();
    const url = `${config.supabaseUrl}/functions/v1/visual_agent`;

    // Find current hint to focus on
    const currentHint = this.state.hints[this.state.currentHintIndex];
    const nextIncompleteHint = this.state.hints.find(h => !h.completed);

    // Build request payload
    const payload = {
      screenshot: observation.screenshot,
      goal: this.state.goal,
      hints: this.state.hints.map(h => ({
        stepNumber: h.stepNumber,
        description: h.description,
        actionType: h.actionType,
        targetText: h.targetText,
        value: h.value,
        completed: h.completed,
      })),
      currentHintIndex: nextIncompleteHint 
        ? this.state.hints.indexOf(nextIncompleteHint)
        : this.state.currentHintIndex,
      history: this.state.history.slice(-5).map(h => ({
        stepNumber: h.stepNumber,
        action: h.action.type,
        params: h.action.params,
        result: h.result,
      })),
      pageContext: {
        url: observation.url,
        title: observation.title,
        viewportSize: observation.viewportSize,
      },
      // Include reference screenshot if available
      referenceScreenshot: currentHint?.referenceScreenshot,
      referenceClickPoint: currentHint?.clickPoint,
    };

    try {
      console.log('[AIAgent] Calling visual_agent Edge Function...');
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify(payload),
      });

      console.log('[AIAgent] Response status:', response.status);

      if (!response.ok) {
        const error = await response.text();
        console.error('[AIAgent] API error:', response.status, error);
        return {
          type: 'fail',
          params: { reason: `API error: ${response.status}` },
          reasoning: error,
          confidence: 0,
        };
      }

      const responseText = await response.text();
      console.log('[AIAgent] Raw response:', responseText.substring(0, 500));
      
      let result;
      try {
        result = JSON.parse(responseText);
        console.log('[AIAgent] Parsed result:', result);
      } catch (parseError) {
        console.error('[AIAgent] JSON parse error:', parseError);
        console.error('[AIAgent] Response was:', responseText);
        return {
          type: 'fail',
          params: { reason: 'Failed to parse AI response' },
          reasoning: `JSON parse error: ${parseError instanceof Error ? parseError.message : 'Unknown'}`,
          confidence: 0,
        };
      }
      
      return {
        type: result.action || 'fail',
        params: result.params || {},
        reasoning: result.reasoning || 'No reasoning provided',
        confidence: result.confidence || 0,
        hintStepIndex: result.hintStepIndex,
      };
    } catch (error) {
      console.error('[AIAgent] Think error:', error);
      return {
        type: 'fail',
        params: { reason: error instanceof Error ? error.message : 'Unknown error' },
        reasoning: 'Failed to communicate with AI',
        confidence: 0,
      };
    }
  }

  /**
   * Execute an action
   */
  private async act(action: AgentAction): Promise<{ success: boolean; error?: string }> {
    // Import executor dynamically to avoid circular deps
    const { AgentExecutor } = await import('./agent-executor');
    
    try {
      const result = await AgentExecutor.execute(action);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Infer the goal from workflow
   */
  private inferGoal(workflow: SavedWorkflow): string {
    // Use workflow name as primary goal
    if (workflow.name) {
      return workflow.name;
    }

    // Try to infer from step descriptions
    const descriptions = workflow.steps
      .map(s => s.description)
      .filter(Boolean)
      .join(' → ');
    
    if (descriptions) {
      return `Complete workflow: ${descriptions}`;
    }

    return 'Complete the recorded workflow';
  }

  /**
   * Extract hints from workflow steps
   */
  private extractHints(workflow: SavedWorkflow, variableValues?: Record<string, string>): AgentHint[] {
    const steps = workflow.optimizedSteps || workflow.steps;
    
    return steps.map((step, index) => {
      const payload = step.payload as WorkflowStepPayload;
      
      // Determine action type
      let actionType: AgentHint['actionType'] = 'other';
      if (step.type === 'CLICK') actionType = 'click';
      else if (step.type === 'INPUT') actionType = 'type';
      else if (step.type === 'NAVIGATION') actionType = 'navigate';

      // Substitute variables in value
      let value = payload.value;
      if (value && variableValues) {
        value = value.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
          return variableValues[varName] ?? match;
        });
      }

      return {
        stepNumber: index + 1,
        description: step.description || `${step.type} on ${payload.elementText || payload.selector}`,
        actionType,
        targetText: payload.elementText,
        targetRole: payload.elementRole,
        value,
        completed: false,
        referenceScreenshot: payload.visualSnapshot?.annotated || payload.visualSnapshot?.viewport,
        clickPoint: payload.visualSnapshot?.clickPoint,
      };
    });
  }

  /**
   * Get current state (for debugging/UI)
   */
  getState(): AgentState {
    return { ...this.state };
  }

  /**
   * Pause execution
   */
  pause(): void {
    if (this.state.status === 'running') {
      this.state.status = 'paused';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton for easy access
export const aiAgent = new AIAgent();

