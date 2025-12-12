/**
 * PII Scrubber - Scrub sensitive data before AI calls to protect privacy
 * Preserves labels but scrubs values
 */

import type { WorkflowStep } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import type { FailureSnapshot } from './dom-distiller';

export class PIIScrubber {
  /**
   * Scrub PII from text before sending to AI
   * Preserves labels but scrubs values
   */
  static scrub(text: string): string {
    if (!text) return text;
    
    // Email pattern: preserve "Enter Email" but scrub "john@example.com"
    text = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
    
    // Phone numbers
    text = text.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
    text = text.replace(/\b\(\d{3}\)\s?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
    text = text.replace(/\b\+1\s?\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
    text = text.replace(/\b\d{3}\.\d{3}\.\d{4}\b/g, '[PHONE]');
    
    // Credit cards (optional, but good for enterprise)
    text = text.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CARD]');
    text = text.replace(/\b\d{13,19}\b/g, (match) => {
      // Only replace if it looks like a credit card (13-19 digits)
      if (match.length >= 13 && match.length <= 19) {
        return '[CARD]';
      }
      return match;
    });
    
    // SSN (optional)
    text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]');
    text = text.replace(/\b\d{9}\b/g, () => {
      // Only replace if it's exactly 9 digits (could be SSN)
      return '[SSN]';
    });
    
    return text;
  }
  
  /**
   * Scrub PII from element text
   */
  static scrubElement(element: Element): string {
    const text = element.textContent || '';
    return this.scrub(text);
  }
  
  /**
   * Scrub PII from failure snapshot
   */
  static scrubSnapshot(snapshot: FailureSnapshot): FailureSnapshot {
    return {
      targetDescription: this.scrub(snapshot.targetDescription),
      targetText: snapshot.targetText ? this.scrub(snapshot.targetText) : undefined,
      candidates: snapshot.candidates.map(c => ({
        ...c,
        text: this.scrub(c.text),
      })),
      context: this.scrub(snapshot.context),
    };
  }
  
  /**
   * Scrub PII from workflow step
   */
  static scrubStep(step: WorkflowStep): WorkflowStep {
    const scrubbed = { ...step };
    
    // Only scrub WorkflowStepPayload, not TabSwitchPayload
    if (!isWorkflowStepPayload(scrubbed.payload)) {
      return scrubbed;
    }
    
    // Scrub value but keep label
    if (scrubbed.payload.value) {
      scrubbed.payload.value = this.scrub(scrubbed.payload.value);
    }
    
    // Scrub element text
    if (scrubbed.payload.elementText) {
      scrubbed.payload.elementText = this.scrub(scrubbed.payload.elementText);
    }
    
    // Scrub context text
    if (scrubbed.payload.context?.surroundingText) {
      scrubbed.payload.context.surroundingText = this.scrub(
        scrubbed.payload.context.surroundingText
      );
    }
    
    // Scrub container text
    if (scrubbed.payload.context?.container?.text) {
      scrubbed.payload.context.container.text = this.scrub(
        scrubbed.payload.context.container.text
      );
    }
    
    // Scrub parent text
    if (scrubbed.payload.context?.parent?.text) {
      scrubbed.payload.context.parent.text = this.scrub(
        scrubbed.payload.context.parent.text
      );
    }
    
    // Scrub ancestor text
    if (scrubbed.payload.context?.ancestors) {
      scrubbed.payload.context.ancestors = scrubbed.payload.context.ancestors.map((ancestor) => {
        if (!ancestor.selector) {
          // If no selector, return as-is (invalid ancestor)
          return ancestor;
        }
        return {
          selector: ancestor.selector,
          text: ancestor.text ? this.scrub(ancestor.text) : undefined,
          role: ancestor.role,
        };
      });
    }
    
    // Scrub sibling text
    if (scrubbed.payload.context?.siblings) {
      if (scrubbed.payload.context.siblings.before) {
        scrubbed.payload.context.siblings.before = scrubbed.payload.context.siblings.before.map(
          (text: string) => this.scrub(text)
        );
      }
      if (scrubbed.payload.context.siblings.after) {
        scrubbed.payload.context.siblings.after = scrubbed.payload.context.siblings.after.map(
          (text: string) => this.scrub(text)
        );
      }
    }
    
    return scrubbed;
  }
}


