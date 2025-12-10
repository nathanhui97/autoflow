/**
 * AIWorkflowAnalyzer - Analyzes workflows to understand intent and generate execution policies
 * Provider-agnostic design allows swapping AI providers
 */

import type { WorkflowStep, WorkflowIntent, Pattern } from '../types/workflow';
import { AIDataBuilder } from './ai-data-builder';

/**
 * Abstract AI provider interface
 */
export interface AIProvider {
  analyze(prompt: string): Promise<WorkflowIntent>;
}

/**
 * Placeholder AI provider (returns default intent)
 * Replace with actual OpenAI/Anthropic/etc. implementation
 */
class PlaceholderAIProvider implements AIProvider {
  async analyze(prompt: string): Promise<WorkflowIntent> {
    // Placeholder: Return default intent
    // TODO: Replace with actual LLM API call
    console.log('GhostWriter: AI analysis requested (placeholder implementation)');
    console.log('GhostWriter: Prompt length:', prompt.length);
    
    return {
      intent: 'Workflow execution',
      pattern: 'unique',
      mode: 'exact',
      confidence: 0.5,
    };
  }
}

export class AIWorkflowAnalyzer {
  private provider: AIProvider;

  constructor(provider?: AIProvider) {
    this.provider = provider || new PlaceholderAIProvider();
  }

  /**
   * Analyze workflow and determine intent
   */
  async analyzeWorkflow(steps: WorkflowStep[], pattern?: Pattern): Promise<WorkflowIntent> {
    const prompt = this.buildAnalysisPrompt(steps, pattern);
    return await this.provider.analyze(prompt);
  }

  /**
   * Build analysis prompt with semantic coordinates and pattern hints
   * Uses AIDataBuilder to structure data optimally for AI consumption
   */
  private buildAnalysisPrompt(steps: WorkflowStep[], pattern?: Pattern): string {
    // Use AIDataBuilder to create AI-optimized payloads
    const stepData = steps.map((step, index) => {
      const previousStep = index > 0 ? steps[index - 1] : undefined;
      const payload = AIDataBuilder.buildStepAnalysisPayload(step, previousStep);
      
      // Phase 1 Testing: Log first step to verify transformation
      if (index === 0) {
        console.group('🔍 Phase 1 Test - AI Data Builder');
        console.log('Original Step Type:', step.type);
        console.log('Original has gridCoordinates?', !!step.payload.context?.gridCoordinates);
        console.log('Original has formCoordinates?', !!step.payload.context?.formCoordinates);
        console.log('Original has decisionSpace?', !!step.payload.context?.decisionSpace);
        console.log('Transformed Payload:', payload);
        console.log('Has Semantic Context?', !!payload.semanticContext);
        if (payload.semanticContext) {
          console.log('Semantic Context:', payload.semanticContext);
        }
        console.log('Has Visual Snapshot?', !!payload.visualSnapshot);
        if (payload.visualSnapshot) {
          console.log('Visual Snapshot: viewport', payload.visualSnapshot.viewport?.substring(0, 50) || 'missing', '...');
        }
        console.log('Payload Size:', JSON.stringify(payload).length, 'bytes');
        console.groupEnd();
      }
      
      // Add step index for reference
      return {
        index: index + 1,
        ...payload,
      };
    });

    // Build prompt
    const prompt = `Analyze this workflow automation sequence and determine the user's intent.

Workflow Steps:
${JSON.stringify(stepData, null, 2)}

${pattern ? `Detected Pattern:
- Type: ${pattern.type}
- Sequence: ${pattern.sequenceType || 'none'}
- Steps: ${pattern.stepCount}
- Confidence: ${pattern.confidence}
- Data Variation: ${pattern.dataVariation.join(', ')}
` : ''}

Instructions:
1. Determine the user's intent (what are they trying to accomplish?)
2. Identify the pattern (repetitive, sequential, template, or unique)
3. Decide on execution mode:
   - "exact": Replay steps exactly as recorded (for unique workflows)
   - "adaptive": Adapt execution based on context (for repetitive/sequential patterns)
   - "hybrid": Mix of exact and adaptive
4. If adaptive mode, generate an ExecutionPolicy with:
   - strategy: "DYNAMIC_LOCATOR" (find elements dynamically) or "EXACT_REPLAY"
   - tool: Tool name from standard library (e.g., "find_grid_cell", "find_next_empty_row", "find_form_field")
   - params: Tool-specific parameters (e.g., { columnHeader: "Price", condition: "is_empty", searchDirection: "down" })

Available Tools:
- "find_grid_cell": Find cell in spreadsheet/grid (params: { columnHeader?, condition: "is_empty"|"is_filled", searchDirection: "down"|"up"|"right"|"left" })
- "find_next_empty_row": Find next empty row in grid (params: { startRow?, columnIndex? })
- "find_next_empty_column": Find next empty column in grid (params: { startColumn?, rowIndex? })
- "find_form_field": Find form field (params: { label?, fieldOrder? })
- "find_table_cell": Find table cell (params: { rowIndex?, columnIndex?, headerRow? })

Response Format (JSON):
{
  "intent": "Human-readable description of what the user is doing",
  "pattern": "repetitive" | "sequential" | "template" | "unique",
  "mode": "exact" | "adaptive" | "hybrid",
  "confidence": 0.0-1.0,
  "policy": {
    "strategy": "DYNAMIC_LOCATOR" | "EXACT_REPLAY" | "HYBRID",
    "tool": "tool_name",
    "params": { ... }
  }
}

Example for spreadsheet row entry:
{
  "intent": "Enter product data in spreadsheet rows",
  "pattern": "repetitive",
  "mode": "adaptive",
  "confidence": 0.9,
  "policy": {
    "strategy": "DYNAMIC_LOCATOR",
    "tool": "find_next_empty_row",
    "params": { "columnIndex": 0 }
  }
}`;

    return prompt;
  }

  /**
   * Set AI provider (allows swapping providers)
   */
  setProvider(provider: AIProvider): void {
    this.provider = provider;
  }
}

