/**
 * AI Self-Healing Service
 * 
 * Intelligent element recovery that uses AI to:
 * 1. Analyze DOM changes and find the "same" element on different website states
 * 2. Self-debug failures and suggest fixes
 * 3. Auto-adjust workflow JSON based on what it learns
 * 4. Provide confidence-ranked alternatives when unsure
 */

import { DOMDistiller, type CandidateElement } from './dom-distiller';
import { aiConfig } from './ai-config';
import { CorrectionMemory } from './correction-memory';
import type { WorkflowStep, WorkflowStepPayload } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import type { ElementSignature } from '../types/universal-types';

// ============================================================================
// Types
// ============================================================================

export interface AIRecoveryContext {
  /** Original workflow step (if available) */
  step?: WorkflowStep;
  /** Element signature for finding the element */
  signature?: ElementSignature;
  /** Current DOM document */
  currentDOM: Document;
  /** Why resolution failed */
  failureReason?: string;
  /** Methods already tried */
  triedMethods?: string[];
  /** Original click coordinates */
  coordinates?: { x: number; y: number };
  /** Step type (CLICK, INPUT, etc.) */
  stepType?: string;
  /** Step description */
  description?: string;
}

export interface AIRecoveryResult {
  success: boolean;
  element?: Element;
  selector?: string;
  confidence: number;
  method: 'ai-visual' | 'ai-semantic' | 'ai-structural' | 'learned-pattern' | 'coordinate-enhanced';
  reasoning: string;
  suggestedFix?: SuggestedFix;
}

export interface SuggestedFix {
  type: 'selector' | 'coordinate' | 'wait' | 'scroll' | 'workflow';
  description: string;
  newValue?: string;
  newWorkflowStep?: Partial<WorkflowStep>;
}

export interface DebugAnalysis {
  failureReason: string;
  rootCause: 'element_moved' | 'element_removed' | 'timing' | 'dynamic_content' | 'framework_change' | 'unknown';
  suggestions: SuggestedFix[];
  confidence: number;
  domState: {
    similarElements: CandidateElement[];
    pageChanged: boolean;
    dynamicContentDetected: boolean;
  };
}

// ============================================================================
// Main AI Self-Healing Service
// ============================================================================

export class AISelfHealingService {
  
  /**
   * Attempt AI-powered recovery when standard resolution fails
   * This is the main entry point called by the orchestrator
   */
  static async recover(context: AIRecoveryContext): Promise<AIRecoveryResult> {
    console.log('[AI-SelfHeal] Starting AI recovery...');
    
    if (!aiConfig.isEnabled()) {
      console.log('[AI-SelfHeal] AI is disabled');
      return {
        success: false,
        confidence: 0,
        method: 'ai-semantic',
        reasoning: 'AI features are disabled',
      };
    }

    const { step, signature, currentDOM, coordinates, stepType } = context;
    
    // Check if we have a valid workflow step with payload
    const hasValidPayload = step && isWorkflowStepPayload(step.payload);
    
    // Strategy 1: Coordinate-based search (most reliable fallback)
    if (coordinates) {
      console.log(`[AI-SelfHeal] Trying coordinate-based recovery at (${coordinates.x}, ${coordinates.y})`);
      const coordResult = await this.tryCoordinateEnhancedSearch(
        step, 
        currentDOM, 
        coordinates,
        stepType,
        signature
      );
      if (coordResult.success) {
        console.log('[AI-SelfHeal] Found via coordinate-enhanced search');
        return coordResult;
      }
    }

    // Strategy 2: Check correction memory (only if we have a valid step)
    if (hasValidPayload && step) {
      const learnedResult = await this.tryLearnedPatterns(step, currentDOM);
      if (learnedResult.success) {
        console.log('[AI-SelfHeal] Found via learned pattern');
        return learnedResult;
      }
    }

    // Strategy 3: Try semantic matching with AI (only if we have a valid step)
    if (hasValidPayload && step) {
      const semanticResult = await this.trySemanticMatching(step, currentDOM);
      if (semanticResult.success && semanticResult.confidence > 0.7) {
        console.log('[AI-SelfHeal] Found via semantic AI matching');
        return semanticResult;
      }
    }

    // Strategy 4: Try visual AI matching (if we have screenshots)
    if (hasValidPayload && step && step.payload && 'visualSnapshot' in step.payload && step.payload.visualSnapshot) {
      const visualResult = await this.tryVisualMatching(step, currentDOM);
      if (visualResult.success && visualResult.confidence > 0.6) {
        console.log('[AI-SelfHeal] Found via visual AI matching');
        return visualResult;
      }
    }

    // Strategy 5: Signature-based text search (if we have signature)
    if (signature?.text?.exact) {
      console.log(`[AI-SelfHeal] Trying text-based search for: "${signature.text.exact}"`);
      const textResult = this.tryTextBasedSearch(signature, currentDOM, stepType);
      if (textResult.success) {
        console.log('[AI-SelfHeal] Found via text-based search');
        return textResult;
      }
    }

    // All strategies failed
    console.log('[AI-SelfHeal] All recovery strategies failed');
    return {
      success: false,
      confidence: 0,
      method: 'ai-semantic',
      reasoning: context.failureReason || 'All AI recovery strategies failed',
    };
  }

  /**
   * Simple text-based element search using signature
   */
  private static tryTextBasedSearch(
    signature: ElementSignature,
    doc: Document,
    stepType?: string
  ): AIRecoveryResult {
    const targetText = signature.text?.exact || signature.text?.normalized;
    if (!targetText) {
      return {
        success: false,
        confidence: 0,
        method: 'ai-semantic',
        reasoning: 'No text to search for',
      };
    }

    // Find elements with matching text
    const interactiveSelectors = stepType === 'INPUT'
      ? 'input, textarea, [contenteditable="true"]'
      : 'button, a, [role="button"], [role="menuitem"], [role="option"], [role="listbox"], div[tabindex], span[tabindex]';
    
    const elements = doc.querySelectorAll(interactiveSelectors);
    
    for (const el of elements) {
      const elText = el.textContent?.trim() || '';
      if (elText === targetText || elText.includes(targetText)) {
        if (this.isElementVisible(el)) {
          return {
            success: true,
            element: el,
            confidence: elText === targetText ? 0.8 : 0.6,
            method: 'ai-semantic',
            reasoning: `Found element with matching text: "${targetText}"`,
          };
        }
      }
    }

    return {
      success: false,
      confidence: 0,
      method: 'ai-semantic',
      reasoning: `No element found with text: "${targetText}"`,
    };
  }

  /**
   * Try learned patterns from correction memory
   */
  private static async tryLearnedPatterns(
    step: WorkflowStep,
    doc: Document
  ): Promise<AIRecoveryResult> {
    try {
      const corrections = await CorrectionMemory.findSimilarCorrections(step, 5);
      
      for (const correction of corrections) {
        // Try the corrected selector
        if (correction.correctedSelector) {
          try {
            const element = doc.querySelector(correction.correctedSelector);
            if (element && this.isElementVisible(element)) {
              // Record success for this correction
              await CorrectionMemory.recordSuccess(correction.id);
              
              return {
                success: true,
                element,
                selector: correction.correctedSelector,
                confidence: 0.85,
                method: 'learned-pattern',
                reasoning: `Found via learned correction from previous fix`,
              };
            }
          } catch {
            // Invalid selector, continue
          }
        }

        // Try applying the learned pattern
        if (correction.learnedPattern) {
          const generatedSelector = CorrectionMemory.applyLearnedPattern(step, correction.learnedPattern);
          if (generatedSelector) {
            try {
              const element = doc.querySelector(generatedSelector);
              if (element && this.isElementVisible(element)) {
                return {
                  success: true,
                  element,
                  selector: generatedSelector,
                  confidence: 0.8,
                  method: 'learned-pattern',
                  reasoning: `Found via pattern learned from ${correction.pageUrl}`,
                };
              }
            } catch {
              // Invalid selector, continue
            }
          }
        }
      }
    } catch (error) {
      console.warn('[AI-SelfHeal] Error checking learned patterns:', error);
    }

    return {
      success: false,
      confidence: 0,
      method: 'learned-pattern',
      reasoning: 'No matching learned patterns found',
    };
  }

  /**
   * Try semantic matching using AI
   */
  private static async trySemanticMatching(
    step: WorkflowStep,
    doc: Document
  ): Promise<AIRecoveryResult> {
    if (!isWorkflowStepPayload(step.payload)) {
      return {
        success: false,
        confidence: 0,
        method: 'ai-semantic',
        reasoning: 'Invalid step payload',
      };
    }

    try {
      // Build semantic description of what we're looking for
      const targetDescription = this.buildTargetDescription(step.payload);
      
      // Get candidates from DOM
      const snapshot = DOMDistiller.createFailureSnapshot(step, doc);
      
      if (snapshot.candidates.length === 0) {
        return {
          success: false,
          confidence: 0,
          method: 'ai-semantic',
          reasoning: 'No candidate elements found in DOM',
        };
      }

      // Call AI to find best match
      const result = await this.callAIForElementMatch(targetDescription, snapshot.candidates, step);
      
      if (result.candidateIndex !== undefined && result.confidence > 0.6) {
        const candidate = snapshot.candidates[result.candidateIndex];
        const element = doc.querySelector(candidate.selector);
        
        if (element && this.isElementVisible(element)) {
          return {
            success: true,
            element,
            selector: candidate.selector,
            confidence: result.confidence,
            method: 'ai-semantic',
            reasoning: result.reasoning,
          };
        }
      }

      return {
        success: false,
        confidence: result.confidence || 0,
        method: 'ai-semantic',
        reasoning: result.reasoning || 'AI could not find a confident match',
      };
    } catch (error) {
      console.error('[AI-SelfHeal] Semantic matching error:', error);
      return {
        success: false,
        confidence: 0,
        method: 'ai-semantic',
        reasoning: `Semantic matching failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Try visual matching using AI (uses screenshots)
   */
  private static async tryVisualMatching(
    step: WorkflowStep,
    doc: Document
  ): Promise<AIRecoveryResult> {
    if (!isWorkflowStepPayload(step.payload)) {
      return {
        success: false,
        confidence: 0,
        method: 'ai-visual',
        reasoning: 'Invalid step payload',
      };
    }

    try {
      // Use the existing visual analysis edge function
      const config = aiConfig.getConfig();
      const url = `${config.supabaseUrl}/functions/v1/recover_element`;
      
      const snapshot = DOMDistiller.createFailureSnapshot(step, doc);
      
      const payload = {
        action: {
          type: step.type,
          url: step.payload.url,
        },
        elementContext: {
          text: step.payload.elementText,
          role: step.payload.elementRole,
          label: step.payload.label,
        },
        visualSnapshot: step.payload.visualSnapshot,
        failureSnapshot: snapshot,
        pageContext: {
          title: doc.title,
          url: window.location.href,
        },
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Visual AI error: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.selector || result.candidateIndex !== undefined) {
        let element: Element | null = null;
        let selector = result.selector;
        
        if (result.candidateIndex !== undefined && snapshot.candidates[result.candidateIndex]) {
          selector = snapshot.candidates[result.candidateIndex].selector;
        }
        
        if (selector) {
          try {
            element = doc.querySelector(selector);
          } catch {
            // Invalid selector
          }
        }
        
        if (element && this.isElementVisible(element)) {
          return {
            success: true,
            element,
            selector,
            confidence: result.confidence || 0.7,
            method: 'ai-visual',
            reasoning: result.reasoning || 'Found via visual AI matching',
          };
        }
      }

      return {
        success: false,
        confidence: result.confidence || 0,
        method: 'ai-visual',
        reasoning: result.reasoning || 'Visual AI could not find element',
      };
    } catch (error) {
      console.error('[AI-SelfHeal] Visual matching error:', error);
      return {
        success: false,
        confidence: 0,
        method: 'ai-visual',
        reasoning: `Visual matching failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Try coordinate-enhanced search
   * Uses original click coordinates to narrow down search area
   */
  private static async tryCoordinateEnhancedSearch(
    step: WorkflowStep | undefined,
    doc: Document,
    coords: { x: number; y: number },
    stepType?: string,
    signature?: ElementSignature
  ): Promise<AIRecoveryResult> {
    try {
      // Get element at original coordinates
      const elementAtPoint = doc.elementFromPoint(coords.x, coords.y);
      
      if (!elementAtPoint) {
        return {
          success: false,
          confidence: 0,
          method: 'coordinate-enhanced',
          reasoning: 'No element at recorded coordinates',
        };
      }

      // For INPUT steps, try to find the input element
      if (stepType === 'INPUT') {
        const inputElement = elementAtPoint.closest('input, textarea, [contenteditable="true"]') ||
          (elementAtPoint.matches('input, textarea, [contenteditable="true"]') ? elementAtPoint : null);
        
        if (inputElement && this.isElementVisible(inputElement)) {
          return {
            success: true,
            element: inputElement,
            confidence: 0.7,
            method: 'coordinate-enhanced',
            reasoning: 'Found input element at coordinates',
          };
        }
      }

      // Check if we have a payload to match against
      const hasPayload = step && isWorkflowStepPayload(step.payload);
      
      if (hasPayload && step) {
        // Check if this element matches our expectations
        const matchScore = this.calculateElementMatchScore(elementAtPoint, step.payload as WorkflowStepPayload);
        
        if (matchScore > 0.5) {
          return {
            success: true,
            element: elementAtPoint,
            confidence: matchScore,
            method: 'coordinate-enhanced',
            reasoning: `Found element at original coordinates with ${Math.round(matchScore * 100)}% confidence`,
          };
        }
      } else if (signature) {
        // Use signature for matching
        const matchScore = this.calculateSignatureMatchScore(elementAtPoint, signature);
        
        if (matchScore > 0.4) {
          return {
            success: true,
            element: elementAtPoint,
            confidence: matchScore,
            method: 'coordinate-enhanced',
            reasoning: `Found element at coordinates matching signature (${Math.round(matchScore * 100)}% confidence)`,
          };
        }
      } else {
        // No payload or signature - just return the element at coordinates if it's interactive
        if (this.isInteractiveElement(elementAtPoint)) {
          return {
            success: true,
            element: elementAtPoint,
            confidence: 0.5,
            method: 'coordinate-enhanced',
            reasoning: 'Found interactive element at recorded coordinates',
          };
        }
      }

      // Search nearby elements (within 100px radius)
      const nearbyElements = this.findElementsNearCoordinates(doc, coords, 100);
      
      let bestMatch: { element: Element; score: number } | null = null;
      
      for (const el of nearbyElements) {
        let score = 0;
        
        if (hasPayload && step) {
          score = this.calculateElementMatchScore(el, step.payload as WorkflowStepPayload);
        } else if (signature) {
          score = this.calculateSignatureMatchScore(el, signature);
        } else if (this.isInteractiveElement(el)) {
          score = 0.3; // Low score for just being interactive
        }
        
        if (score > (bestMatch?.score || 0.4)) {
          bestMatch = { element: el, score };
        }
      }

      if (bestMatch) {
        return {
          success: true,
          element: bestMatch.element,
          confidence: bestMatch.score,
          method: 'coordinate-enhanced',
          reasoning: `Found similar element near original coordinates`,
        };
      }

      return {
        success: false,
        confidence: 0,
        method: 'coordinate-enhanced',
        reasoning: 'No matching element found near coordinates',
      };
    } catch (error) {
      console.error('[AI-SelfHeal] Coordinate search error:', error);
      return {
        success: false,
        confidence: 0,
        method: 'coordinate-enhanced',
        reasoning: `Coordinate search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Analyze failure and suggest fixes
   */
  static async analyzeAndSuggestFix(context: AIRecoveryContext): Promise<DebugAnalysis> {
    const { step, currentDOM, failureReason } = context;
    
    // Check if we have a valid step with payload
    if (!step || !isWorkflowStepPayload(step.payload)) {
      return {
        failureReason: failureReason || 'Step information not available',
        rootCause: 'unknown',
        suggestions: [{
          type: 'wait',
          description: 'Try adding a wait before this step',
          newValue: '1500',
        }],
        confidence: 0.3,
        domState: {
          similarElements: [],
          pageChanged: false,
          dynamicContentDetected: this.detectDynamicContent(currentDOM),
        },
      };
    }

    // Gather debug information
    const snapshot = DOMDistiller.createFailureSnapshot(step, currentDOM);
    const pageChanged = this.detectPageChanges(step.payload, currentDOM);
    const dynamicContent = this.detectDynamicContent(currentDOM);

    // Determine root cause
    let rootCause: DebugAnalysis['rootCause'] = 'unknown';
    const suggestions: SuggestedFix[] = [];

    if (snapshot.candidates.length === 0) {
      rootCause = 'element_removed';
      suggestions.push({
        type: 'wait',
        description: 'Element may be dynamically loaded. Try adding a wait.',
        newValue: '2000',
      });
    } else if (pageChanged) {
      rootCause = 'element_moved';
      suggestions.push({
        type: 'selector',
        description: 'Page structure changed. Use a more flexible selector.',
        newValue: this.suggestFlexibleSelector(snapshot.candidates[0]),
      });
    } else if (dynamicContent) {
      rootCause = 'dynamic_content';
      suggestions.push({
        type: 'wait',
        description: 'Dynamic content detected. Wait for element to stabilize.',
        newValue: '1500',
      });
    } else {
      rootCause = 'timing';
      suggestions.push({
        type: 'scroll',
        description: 'Element may be out of viewport. Try scrolling to it first.',
      });
    }

    // If we found candidates, suggest updating the selector
    if (snapshot.candidates.length > 0) {
      const bestCandidate = snapshot.candidates[0];
      suggestions.push({
        type: 'workflow',
        description: `Update workflow to use new selector: ${bestCandidate.selector}`,
        newWorkflowStep: {
          payload: {
            ...step.payload,
            selector: bestCandidate.selector,
          },
        },
      });
    }

    return {
      failureReason: failureReason || 'Element could not be found',
      rootCause,
      suggestions,
      confidence: snapshot.candidates.length > 0 ? 0.6 : 0.3,
      domState: {
        similarElements: snapshot.candidates,
        pageChanged,
        dynamicContentDetected: dynamicContent,
      },
    };
  }

  /**
   * Auto-adjust workflow JSON based on AI analysis
   */
  static adjustWorkflowStep(
    step: WorkflowStep,
    analysis: DebugAnalysis
  ): WorkflowStep {
    if (!isWorkflowStepPayload(step.payload)) {
      return step;
    }

    const workflowFix = analysis.suggestions.find(s => s.type === 'workflow');
    
    if (workflowFix?.newWorkflowStep) {
      return {
        ...step,
        payload: {
          ...step.payload,
          ...workflowFix.newWorkflowStep.payload,
        },
      } as WorkflowStep;
    }

    // Add more resilient selectors
    if (analysis.domState.similarElements.length > 0) {
      const newSelectors = analysis.domState.similarElements
        .slice(0, 3)
        .map(c => c.selector);
      
      if (isWorkflowStepPayload(step.payload)) {
        return {
          ...step,
          payload: {
            ...step.payload,
            fallbackSelectors: [
              ...(step.payload.fallbackSelectors || []),
              ...newSelectors,
            ],
          },
        } as WorkflowStep;
      }
    }

    return step;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private static buildTargetDescription(payload: WorkflowStepPayload): string {
    const parts: string[] = [];
    
    if (payload.elementText) {
      parts.push(`text: "${payload.elementText}"`);
    }
    if (payload.label) {
      parts.push(`label: "${payload.label}"`);
    }
    if (payload.elementRole) {
      parts.push(`role: ${payload.elementRole}`);
    }
    if (payload.context?.buttonContext?.label) {
      parts.push(`button: "${payload.context.buttonContext.label}"`);
    }
    if (payload.context?.formCoordinates?.label) {
      parts.push(`form field: "${payload.context.formCoordinates.label}"`);
    }
    
    return parts.length > 0 
      ? parts.join(', ') 
      : 'interactive element';
  }

  private static async callAIForElementMatch(
    targetDescription: string,
    candidates: CandidateElement[],
    step: WorkflowStep
  ): Promise<{ candidateIndex?: number; confidence: number; reasoning: string }> {
    const config = aiConfig.getConfig();
    const url = `${config.supabaseUrl}/functions/v1/recover_element`;
    
    const payload = {
      action: {
        type: step.type,
        url: isWorkflowStepPayload(step.payload) ? step.payload.url : '',
      },
      failureSnapshot: {
        targetDescription,
        candidates: candidates.map((c, i) => ({
          ...c,
          index: i,
        })),
      },
      pageContext: {
        title: document.title,
        url: window.location.href,
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`AI API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[AI-SelfHeal] AI call failed:', error);
      return {
        confidence: 0,
        reasoning: `AI call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private static calculateElementMatchScore(
    element: Element,
    payload: WorkflowStepPayload
  ): number {
    let score = 0;
    let factors = 0;

    // Text match
    const elText = element.textContent?.trim() || '';
    if (payload.elementText) {
      factors++;
      if (elText === payload.elementText) {
        score += 1;
      } else if (elText.includes(payload.elementText) || payload.elementText.includes(elText)) {
        score += 0.6;
      } else if (elText.toLowerCase().includes(payload.elementText.toLowerCase())) {
        score += 0.4;
      }
    }

    // Role match
    const role = element.getAttribute('role');
    if (payload.elementRole) {
      factors++;
      if (role === payload.elementRole) {
        score += 1;
      }
    }

    // Tag match (from selector)
    if (payload.selector) {
      factors++;
      const expectedTag = payload.selector.split(/[.#\[\s]/)[0]?.toUpperCase();
      if (expectedTag && element.tagName === expectedTag) {
        score += 0.8;
      }
    }

    // ARIA label match
    const ariaLabel = element.getAttribute('aria-label');
    if (payload.label && ariaLabel) {
      factors++;
      if (ariaLabel === payload.label) {
        score += 1;
      } else if (ariaLabel.includes(payload.label)) {
        score += 0.6;
      }
    }

    return factors > 0 ? score / factors : 0;
  }

  /**
   * Calculate match score using signature (when step payload is not available)
   */
  private static calculateSignatureMatchScore(
    element: Element,
    signature: ElementSignature
  ): number {
    let score = 0;
    let factors = 0;

    // Text match
    const elText = element.textContent?.trim() || '';
    if (signature.text?.exact) {
      factors++;
      if (elText === signature.text.exact) {
        score += 1;
      } else if (elText.includes(signature.text.exact) || signature.text.exact.includes(elText)) {
        score += 0.6;
      }
    }

    // Role match
    const role = element.getAttribute('role');
    if (signature.identity?.role && role) {
      factors++;
      if (role === signature.identity.role) {
        score += 1;
      }
    }

    // Tag match
    if (signature.structure?.tagName) {
      factors++;
      if (element.tagName === signature.structure.tagName) {
        score += 0.8;
      }
    }

    // ARIA label match
    const ariaLabel = element.getAttribute('aria-label');
    if (signature.identity?.ariaLabel && ariaLabel) {
      factors++;
      if (ariaLabel === signature.identity.ariaLabel) {
        score += 1;
      }
    }

    // Name match
    if (signature.identity?.name) {
      const name = element.getAttribute('name');
      if (name) {
        factors++;
        if (name === signature.identity.name) {
          score += 1;
        }
      }
    }

    return factors > 0 ? score / factors : 0;
  }

  /**
   * Check if an element is interactive
   */
  private static isInteractiveElement(element: Element): boolean {
    const interactiveTags = ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'];
    const interactiveRoles = ['button', 'link', 'menuitem', 'option', 'checkbox', 'radio', 'tab', 'combobox', 'listbox'];
    
    if (interactiveTags.includes(element.tagName)) {
      return true;
    }
    
    const role = element.getAttribute('role');
    if (role && interactiveRoles.includes(role)) {
      return true;
    }
    
    const tabindex = element.getAttribute('tabindex');
    if (tabindex && tabindex !== '-1') {
      return true;
    }
    
    // Check for click handlers (heuristic)
    if (element.hasAttribute('onclick') || element.hasAttribute('ng-click') || element.hasAttribute('@click')) {
      return true;
    }
    
    return false;
  }

  private static findElementsNearCoordinates(
    doc: Document,
    coords: { x: number; y: number },
    radius: number
  ): Element[] {
    const elements: Element[] = [];
    const seen = new Set<Element>();

    // Sample points in a grid around the coordinates
    for (let dx = -radius; dx <= radius; dx += 20) {
      for (let dy = -radius; dy <= radius; dy += 20) {
        const x = coords.x + dx;
        const y = coords.y + dy;
        
        // Check if point is within circular radius
        if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
        
        const el = doc.elementFromPoint(x, y);
        if (el && !seen.has(el) && this.isElementVisible(el)) {
          seen.add(el);
          elements.push(el);
        }
      }
    }

    return elements;
  }

  private static detectPageChanges(
    payload: WorkflowStepPayload,
    currentDOM: Document
  ): boolean {
    // Check if URL path changed significantly
    try {
      const recordedUrl = new URL(payload.url);
      const currentUrl = new URL(window.location.href);
      
      if (recordedUrl.pathname !== currentUrl.pathname) {
        return true;
      }
    } catch {
      // Invalid URLs
    }

    // Check if the original selector structure exists
    if (payload.selector) {
      try {
        const parentParts = payload.selector.split(' ');
        if (parentParts.length > 1) {
          const parentSelector = parentParts.slice(0, -1).join(' ');
          const parent = currentDOM.querySelector(parentSelector);
          if (!parent) {
            return true;
          }
        }
      } catch {
        // Invalid selector
      }
    }

    return false;
  }

  private static detectDynamicContent(doc: Document): boolean {
    // Check for common dynamic content indicators
    const indicators = [
      '[data-loading]',
      '[aria-busy="true"]',
      '.loading',
      '.spinner',
      '[data-skeleton]',
    ];

    for (const selector of indicators) {
      if (doc.querySelector(selector)) {
        return true;
      }
    }

    return false;
  }

  private static suggestFlexibleSelector(candidate: CandidateElement): string {
    // Build a more flexible selector using stable attributes
    const { attributes, tag, role, text } = candidate;

    // Prefer data-testid
    if (attributes['data-testid']) {
      return `[data-testid="${attributes['data-testid']}"]`;
    }

    // Then aria-label
    if (attributes['aria-label']) {
      return `[aria-label="${attributes['aria-label']}"]`;
    }

    // Then role + text
    if (role && text) {
      return `${tag}[role="${role}"]`;
    }

    // Fallback to original selector
    return candidate.selector;
  }

  private static isElementVisible(element: Element): boolean {
    if (!(element instanceof HTMLElement)) {
      return true;
    }

    const style = window.getComputedStyle(element);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    return true;
  }
}

// Export singleton for easy access
export const aiSelfHealing = AISelfHealingService;

