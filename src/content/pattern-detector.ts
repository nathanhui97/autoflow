/**
 * PatternDetector - Detects patterns in recorded workflows using semantic coordinates
 * Uses gridCoordinates, formCoordinates, tableCoordinates (not just CSS selectors)
 */

import type { WorkflowStep, Pattern } from '../types/workflow';

export class PatternDetector {
  /**
   * Detect pattern in workflow steps using semantic coordinates
   */
  static detectPattern(steps: WorkflowStep[]): Pattern | null {
    if (steps.length < 2) {
      return null; // Need at least 2 steps to detect a pattern
    }

    // Try to detect different pattern types
    const repetitivePattern = this.detectRepetitivePattern(steps);
    if (repetitivePattern) {
      return repetitivePattern;
    }

    const sequentialPattern = this.detectSequentialPattern(steps);
    if (sequentialPattern) {
      return sequentialPattern;
    }

    const templatePattern = this.detectTemplatePattern(steps);
    if (templatePattern) {
      return templatePattern;
    }

    return null;
  }

  /**
   * Detect repetitive pattern (same action, different data, sequential coordinates)
   */
  private static detectRepetitivePattern(steps: WorkflowStep[]): Pattern | null {
    // Group steps by type
    const inputSteps = steps.filter(s => s.type === 'INPUT');
    const clickSteps = steps.filter(s => s.type === 'CLICK');

    // Check for repetitive INPUT steps with sequential grid coordinates
    if (inputSteps.length >= 2) {
      const gridPattern = this.detectGridRepetition(inputSteps);
      if (gridPattern) {
        return gridPattern;
      }
    }

    // Check for repetitive CLICK steps with sequential coordinates
    if (clickSteps.length >= 2) {
      const clickPattern = this.detectClickRepetition(clickSteps);
      if (clickPattern) {
        return clickPattern;
      }
    }

    return null;
  }

  /**
   * Detect grid-based repetition (spreadsheet rows/columns)
   */
  private static detectGridRepetition(steps: WorkflowStep[]): Pattern | null {
    const gridSteps = steps.filter(s => s.payload.context?.gridCoordinates);
    if (gridSteps.length < 2) {
      return null;
    }

    // Check if steps have sequential row indices
    const rowIndices: number[] = [];
    const columnIndices: number[] = [];
    const values: string[] = [];

    for (const step of gridSteps) {
      const coords = step.payload.context?.gridCoordinates;
      if (coords?.rowIndex !== undefined) {
        rowIndices.push(coords.rowIndex);
      }
      if (coords?.columnIndex !== undefined) {
        columnIndices.push(coords.columnIndex);
      }
      if (step.payload.value) {
        values.push(step.payload.value);
      }
    }

    // Check for sequential row progression
    if (rowIndices.length >= 2) {
      const isSequentialRows = this.isSequential(rowIndices);
      if (isSequentialRows && this.hasDataVariation(values)) {
        return {
          type: 'repetitive',
          sequenceType: 'row',
          stepCount: gridSteps.length,
          dataVariation: values,
          confidence: this.calculateConfidence(rowIndices, values),
        };
      }
    }

    // Check for sequential column progression
    if (columnIndices.length >= 2) {
      const isSequentialCols = this.isSequential(columnIndices);
      if (isSequentialCols && this.hasDataVariation(values)) {
        return {
          type: 'repetitive',
          sequenceType: 'column',
          stepCount: gridSteps.length,
          dataVariation: values,
          confidence: this.calculateConfidence(columnIndices, values),
        };
      }
    }

    return null;
  }

  /**
   * Detect click repetition (same action, different targets)
   */
  private static detectClickRepetition(steps: WorkflowStep[]): Pattern | null {
    // Check if clicks have similar selectors but different coordinates
    const selectors = steps.map(s => s.payload.selector);
    const isSimilarSelectors = this.areSimilarSelectors(selectors);

    if (isSimilarSelectors && steps.length >= 2) {
      const values: string[] = [];
      for (const step of steps) {
        if (step.payload.elementText) {
          values.push(step.payload.elementText);
        }
      }

      if (this.hasDataVariation(values)) {
        return {
          type: 'repetitive',
          sequenceType: 'none',
          stepCount: steps.length,
          dataVariation: values,
          confidence: 0.6, // Lower confidence for click repetition
        };
      }
    }

    return null;
  }

  /**
   * Detect sequential pattern (form fields, table navigation)
   */
  private static detectSequentialPattern(steps: WorkflowStep[]): Pattern | null {
    // Check for form field sequence
    const formSteps = steps.filter(s => s.payload.context?.formCoordinates);
    if (formSteps.length >= 2) {
      const fieldOrders = formSteps
        .map(s => s.payload.context?.formCoordinates?.fieldOrder)
        .filter((order): order is number => order !== undefined);

      if (fieldOrders.length >= 2 && this.isSequential(fieldOrders)) {
        return {
          type: 'sequential',
          sequenceType: 'none',
          stepCount: formSteps.length,
          dataVariation: formSteps.map(s => s.payload.value || '').filter(v => v),
          confidence: 0.7,
        };
      }
    }

    // Check for table cell sequence
    const tableSteps = steps.filter(s => s.payload.context?.tableCoordinates);
    if (tableSteps.length >= 2) {
      const rowIndices: number[] = [];
      const colIndices: number[] = [];

      for (const step of tableSteps) {
        const coords = step.payload.context?.tableCoordinates;
        if (coords?.rowIndex !== undefined) {
          rowIndices.push(coords.rowIndex);
        }
        if (coords?.columnIndex !== undefined) {
          colIndices.push(coords.columnIndex);
        }
      }

      if (rowIndices.length >= 2 && this.isSequential(rowIndices)) {
        return {
          type: 'sequential',
          sequenceType: 'row',
          stepCount: tableSteps.length,
          dataVariation: tableSteps.map(s => s.payload.value || '').filter(v => v),
          confidence: 0.7,
        };
      }

      if (colIndices.length >= 2 && this.isSequential(colIndices)) {
        return {
          type: 'sequential',
          sequenceType: 'column',
          stepCount: tableSteps.length,
          dataVariation: tableSteps.map(s => s.payload.value || '').filter(v => v),
          confidence: 0.7,
        };
      }
    }

    return null;
  }

  /**
   * Detect template pattern (similar structure, different values)
   */
  private static detectTemplatePattern(steps: WorkflowStep[]): Pattern | null {
    // Check if steps have similar structure but different values
    if (steps.length < 3) {
      return null;
    }

    // Group steps by type
    const stepTypes = steps.map(s => s.type);
    const uniqueTypes = new Set(stepTypes);

    // If all steps are same type and have different values
    if (uniqueTypes.size === 1) {
      const values = steps.map(s => s.payload.value || s.payload.elementText || '').filter(v => v);
      if (values.length >= 3 && this.hasDataVariation(values)) {
        // Check if selectors are similar
        const selectors = steps.map(s => s.payload.selector);
        if (this.areSimilarSelectors(selectors)) {
          return {
            type: 'template',
            sequenceType: 'none',
            stepCount: steps.length,
            dataVariation: values,
            confidence: 0.6,
          };
        }
      }
    }

    return null;
  }

  /**
   * Check if array of numbers is sequential (incrementing by 1)
   */
  private static isSequential(numbers: number[]): boolean {
    if (numbers.length < 2) {
      return false;
    }

    // Check if all differences are 1
    for (let i = 1; i < numbers.length; i++) {
      if (numbers[i] - numbers[i - 1] !== 1) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if values have variation (not all the same)
   */
  private static hasDataVariation(values: string[]): boolean {
    if (values.length < 2) {
      return false;
    }

    const uniqueValues = new Set(values);
    return uniqueValues.size > 1;
  }

  /**
   * Check if selectors are similar (same base structure)
   */
  private static areSimilarSelectors(selectors: string[]): boolean {
    if (selectors.length < 2) {
      return false;
    }

    // Extract base parts (remove indices, IDs, etc.)
    const baseParts = selectors.map(s => {
      // Remove nth-child, nth-of-type, IDs, etc.
      return s
        .replace(/:\d+/g, '') // Remove :nth-child(1), etc.
        .replace(/\[id="[^"]+"\]/g, '') // Remove IDs
        .replace(/#[a-zA-Z0-9_-]+/g, '') // Remove ID selectors
        .replace(/\[data-[^=]+="[^"]+"\]/g, ''); // Remove data attributes
    });

    // Check if all base parts are similar (at least 70% similarity)
    const firstBase = baseParts[0];
    for (let i = 1; i < baseParts.length; i++) {
      const similarity = this.calculateStringSimilarity(firstBase, baseParts[i]);
      if (similarity < 0.7) {
        return false;
      }
    }

    return true;
  }

  /**
   * Calculate string similarity (simple Jaccard-like)
   */
  private static calculateStringSimilarity(str1: string, str2: string): number {
    if (str1 === str2) {
      return 1.0;
    }

    const words1 = new Set(str1.split(/\s+/));
    const words2 = new Set(str2.split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Calculate confidence score for pattern
   */
  private static calculateConfidence(indices: number[], values: string[]): number {
    let confidence = 0.5; // Base confidence

    // Increase confidence if sequence is perfect
    if (this.isSequential(indices)) {
      confidence += 0.2;
    }

    // Increase confidence if values vary
    if (this.hasDataVariation(values)) {
      confidence += 0.2;
    }

    // Increase confidence if we have more steps
    if (indices.length >= 3) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }
}




