/**
 * StepInstrumentation - Metrics collection and failure pattern analysis
 * 
 * Every step produces metrics for continuous improvement.
 * Tracks: resolution strategies, recovery actions, verification results.
 */

import type { RecoveryAction } from '../content/recovery-engine';

/**
 * Metrics collected for a single step execution
 */
export interface StepMetrics {
  /** Unique step identifier */
  stepId: string;
  /** Workflow ID this step belongs to */
  workflowId: string;
  /** Timestamp when step started */
  timestamp: number;
  /** Step type (CLICK, TYPE, etc.) */
  stepType: string;
  
  /** Resolution metrics */
  resolution: {
    /** Number of strategies attempted */
    strategiesAttempted: number;
    /** Candidates found per strategy type */
    candidatesPerStrategy: Record<string, number>;
    /** Which strategy won (if found) */
    winningStrategy?: string;
    /** Whether result was ambiguous before disambiguation */
    wasAmbiguous: boolean;
    /** Whether disambiguation was applied */
    disambiguationUsed: boolean;
    /** Time taken for resolution in ms */
    resolveTimeMs: number;
  };
  
  /** Recovery metrics */
  recovery: {
    /** Actions that were used */
    actionsUsed: RecoveryAction[];
    /** Number of recovery attempts */
    attemptCount: number;
    /** Time taken for recovery in ms */
    recoveryTimeMs: number;
    /** Whether recovery was successful */
    recoverySucceeded: boolean;
  };
  
  /** Verification metrics */
  verification: {
    /** Type of condition verified */
    conditionType: string;
    /** Whether verification passed */
    passed: boolean;
    /** Reason for failure (if failed) */
    failureReason?: string;
    /** Time taken for verification in ms */
    verifyTimeMs: number;
  };
  
  /** Overall metrics */
  totalTimeMs: number;
  outcome: 'success' | 'failed' | 'user_intervention' | 'skipped';
  error?: string;
}

/**
 * Aggregated failure pattern
 */
export interface FailurePattern {
  /** Pattern identifier */
  id: string;
  /** Description of the failure pattern */
  description: string;
  /** Number of occurrences */
  count: number;
  /** Step types affected */
  affectedStepTypes: string[];
  /** Common failure reasons */
  failureReasons: string[];
  /** Suggested fixes */
  suggestedFixes: string[];
  /** Example step IDs */
  exampleStepIds: string[];
}

/**
 * Summary of instrumentation data
 */
export interface InstrumentationSummary {
  /** Total steps executed */
  totalSteps: number;
  /** Successful steps */
  successfulSteps: number;
  /** Failed steps */
  failedSteps: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Most common winning strategies */
  topStrategies: { strategy: string; count: number }[];
  /** Most common recovery actions */
  topRecoveryActions: { action: string; count: number }[];
  /** Average resolution time */
  avgResolveTimeMs: number;
  /** Average total time per step */
  avgTotalTimeMs: number;
}

/**
 * StepInstrumentation handles metrics collection and analysis
 */
export class StepInstrumentation {
  private static metrics: StepMetrics[] = [];
  private static readonly MAX_STORED_METRICS = 1000;
  private static readonly STORAGE_KEY = 'ghostwriter_step_metrics';
  
  /**
   * Initialize instrumentation (load from storage)
   */
  static async init(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(this.STORAGE_KEY);
      if (stored[this.STORAGE_KEY] && Array.isArray(stored[this.STORAGE_KEY])) {
        this.metrics = stored[this.STORAGE_KEY] as StepMetrics[];
      }
    } catch (e) {
      console.warn('StepInstrumentation: Could not load stored metrics', e);
    }
  }
  
  /**
   * Emit step metrics
   */
  static emit(metrics: StepMetrics): void {
    this.metrics.push(metrics);
    
    // Trim to max size
    if (this.metrics.length > this.MAX_STORED_METRICS) {
      this.metrics = this.metrics.slice(-this.MAX_STORED_METRICS);
    }
    
    // Log for debugging
    console.log(`📊 Step ${metrics.stepId}: ${metrics.outcome}`, {
      resolution: metrics.resolution.winningStrategy,
      time: `${metrics.totalTimeMs}ms`,
      recovery: metrics.recovery.attemptCount > 0 ? `${metrics.recovery.attemptCount} attempts` : 'none',
    });
    
    // Persist asynchronously
    this.persist();
  }
  
  /**
   * Create a new metrics object
   */
  static createMetrics(
    stepId: string,
    workflowId: string,
    stepType: string
  ): StepMetrics {
    return {
      stepId,
      workflowId,
      timestamp: Date.now(),
      stepType,
      resolution: {
        strategiesAttempted: 0,
        candidatesPerStrategy: {},
        wasAmbiguous: false,
        disambiguationUsed: false,
        resolveTimeMs: 0,
      },
      recovery: {
        actionsUsed: [],
        attemptCount: 0,
        recoveryTimeMs: 0,
        recoverySucceeded: false,
      },
      verification: {
        conditionType: '',
        passed: false,
        verifyTimeMs: 0,
      },
      totalTimeMs: 0,
      outcome: 'success',
    };
  }
  
  /**
   * Get top failure patterns
   */
  static getTopFailurePatterns(limit: number = 5): FailurePattern[] {
    const failedMetrics = this.metrics.filter(m => m.outcome === 'failed');
    
    // Group by failure reason
    const reasonGroups = new Map<string, StepMetrics[]>();
    
    for (const metric of failedMetrics) {
      const reason = metric.verification.failureReason || metric.error || 'unknown';
      const existing = reasonGroups.get(reason) || [];
      existing.push(metric);
      reasonGroups.set(reason, existing);
    }
    
    // Convert to patterns
    const patterns: FailurePattern[] = [];
    
    for (const [reason, metrics] of reasonGroups.entries()) {
      const stepTypes = [...new Set(metrics.map(m => m.stepType))];
      
      patterns.push({
        id: this.hashString(reason),
        description: this.describeFailurePattern(reason, metrics),
        count: metrics.length,
        affectedStepTypes: stepTypes,
        failureReasons: [reason],
        suggestedFixes: this.suggestFixes(reason, metrics),
        exampleStepIds: metrics.slice(0, 3).map(m => m.stepId),
      });
    }
    
    // Sort by count and return top N
    patterns.sort((a, b) => b.count - a.count);
    return patterns.slice(0, limit);
  }
  
  /**
   * Get instrumentation summary
   */
  static getSummary(): InstrumentationSummary {
    const total = this.metrics.length;
    const successful = this.metrics.filter(m => m.outcome === 'success').length;
    const failed = this.metrics.filter(m => m.outcome === 'failed').length;
    
    // Count winning strategies
    const strategyCounts = new Map<string, number>();
    for (const metric of this.metrics) {
      if (metric.resolution.winningStrategy) {
        const count = strategyCounts.get(metric.resolution.winningStrategy) || 0;
        strategyCounts.set(metric.resolution.winningStrategy, count + 1);
      }
    }
    
    const topStrategies = [...strategyCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([strategy, count]) => ({ strategy, count }));
    
    // Count recovery actions
    const actionCounts = new Map<string, number>();
    for (const metric of this.metrics) {
      for (const action of metric.recovery.actionsUsed) {
        const key = action.kind;
        const count = actionCounts.get(key) || 0;
        actionCounts.set(key, count + 1);
      }
    }
    
    const topRecoveryActions = [...actionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([action, count]) => ({ action, count }));
    
    // Calculate averages
    const resolveTimeSum = this.metrics.reduce((sum, m) => sum + m.resolution.resolveTimeMs, 0);
    const totalTimeSum = this.metrics.reduce((sum, m) => sum + m.totalTimeMs, 0);
    
    return {
      totalSteps: total,
      successfulSteps: successful,
      failedSteps: failed,
      successRate: total > 0 ? successful / total : 0,
      topStrategies,
      topRecoveryActions,
      avgResolveTimeMs: total > 0 ? resolveTimeSum / total : 0,
      avgTotalTimeMs: total > 0 ? totalTimeSum / total : 0,
    };
  }
  
  /**
   * Get metrics for a specific workflow
   */
  static getWorkflowMetrics(workflowId: string): StepMetrics[] {
    return this.metrics.filter(m => m.workflowId === workflowId);
  }
  
  /**
   * Get recent metrics
   */
  static getRecentMetrics(count: number = 100): StepMetrics[] {
    return this.metrics.slice(-count);
  }
  
  /**
   * Clear all metrics
   */
  static async clear(): Promise<void> {
    this.metrics = [];
    await this.persist();
  }
  
  /**
   * Export metrics as JSON
   */
  static export(): string {
    return JSON.stringify(this.metrics, null, 2);
  }
  
  /**
   * Import metrics from JSON
   */
  static async import(json: string): Promise<void> {
    try {
      const imported = JSON.parse(json);
      if (Array.isArray(imported)) {
        this.metrics = imported;
        await this.persist();
      }
    } catch (e) {
      console.error('StepInstrumentation: Failed to import metrics', e);
    }
  }
  
  // ============ Private methods ============
  
  private static async persist(): Promise<void> {
    try {
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: this.metrics,
      });
    } catch (e) {
      console.warn('StepInstrumentation: Could not persist metrics', e);
    }
  }
  
  private static describeFailurePattern(reason: string, metrics: StepMetrics[]): string {
    const stepTypes = [...new Set(metrics.map(m => m.stepType))];
    
    if (reason.includes('not found')) {
      return `Element not found in ${stepTypes.join(', ')} steps`;
    }
    
    if (reason.includes('timeout')) {
      return `Timeout waiting for condition in ${stepTypes.join(', ')} steps`;
    }
    
    if (reason.includes('ambiguous')) {
      return `Ambiguous element match in ${stepTypes.join(', ')} steps`;
    }
    
    return `${reason} (${stepTypes.join(', ')} steps)`;
  }
  
  private static suggestFixes(reason: string, metrics: StepMetrics[]): string[] {
    const fixes: string[] = [];
    
    if (reason.includes('not found')) {
      fixes.push('Add more stable selectors (data-testid, aria-label)');
      fixes.push('Increase wait timeout for dynamic content');
      fixes.push('Check if element is inside iframe or shadow DOM');
    }
    
    if (reason.includes('timeout')) {
      fixes.push('Increase timeout for slow-loading content');
      fixes.push('Add explicit wait conditions for preceding steps');
      fixes.push('Check for infinite loading states');
    }
    
    if (reason.includes('ambiguous')) {
      fixes.push('Add more disambiguators (nearby text)');
      fixes.push('Use container scope to narrow search');
      fixes.push('Add unique identifiers to elements');
    }
    
    // Check if recovery was attempted but failed
    const usedRecovery = metrics.some(m => m.recovery.attemptCount > 0);
    if (usedRecovery && metrics.some(m => !m.recovery.recoverySucceeded)) {
      fixes.push('Review and customize recovery strategy for this step type');
    }
    
    return fixes;
  }
  
  private static hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
}

