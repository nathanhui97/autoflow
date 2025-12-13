/**
 * Snapshot Learning System (Read-Only)
 * 
 * Uses existing snapshots from recording phase to improve element finding accuracy.
 * Does NOT store new snapshots - all comparisons happen in-memory only.
 * 
 * CRITICAL: This is a read-only system to avoid chrome.storage limits.
 */

import type { WorkflowStep } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import { VisualAnalysisService } from './visual-analysis';

export interface SnapshotFingerprint {
  stepId: string;
  elementSnippet?: string;
  viewport?: string;
  elementBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  selector: string;
  elementText?: string;
}

export class SnapshotLearning {
  /**
   * Extract snapshot fingerprints from workflow steps (in-memory only)
   * Uses existing snapshots from recording phase
   */
  static extractFingerprints(steps: WorkflowStep[]): SnapshotFingerprint[] {
    const fingerprints: SnapshotFingerprint[] = [];

    for (const step of steps) {
      if (!isWorkflowStepPayload(step.payload)) {
        continue;
      }

      const snapshot = step.payload.visualSnapshot;
      if (!snapshot) {
        continue;
      }

      fingerprints.push({
        stepId: String(step.payload.timestamp),
        elementSnippet: snapshot.elementSnippet,
        viewport: snapshot.viewport,
        elementBounds: snapshot.elementBounds,
        selector: step.payload.selector,
        elementText: step.payload.elementText,
      });
    }

    return fingerprints;
  }

  /**
   * Find matching step by comparing current page state with recorded snapshots
   * Returns the best matching step fingerprint (in-memory comparison only)
   */
  static async findMatchingStep(
    currentSnapshot: string, // Base64 image of current page/element
    fingerprints: SnapshotFingerprint[],
    targetSelector?: string
  ): Promise<SnapshotFingerprint | null> {
    if (fingerprints.length === 0) {
      return null;
    }

    // If target selector is provided, try to find exact match first
    if (targetSelector) {
      const exactMatch = fingerprints.find(fp => fp.selector === targetSelector);
      if (exactMatch && exactMatch.elementSnippet) {
        // Use visual similarity to verify match
        try {
          // Use findVisualSimilarity to compare snapshots
          const candidates: import('../types/visual').VisualCandidate[] = [{
            screenshot: currentSnapshot,
            selector: '',
            visualDescription: '',
            importance: {
              sizeScore: 0.5,
              colorScore: 0.5,
              positionScore: 0.5,
              iconScore: 0.5,
              textStyleScore: 0.5,
              interactiveScore: 0.5,
              overallImportance: 0.5,
            },
            context: { nearbyElements: [], landmarks: [], visualPattern: 'unknown' as const },
            boundingBox: { x: 0, y: 0, width: 0, height: 0 }
          }];
          const result = await VisualAnalysisService.findVisualSimilarity(
            exactMatch.elementSnippet,
            candidates
          );
          const similarity = result?.similarity?.overallVisualMatch || 0;
          if (similarity > 0.7) {
            return exactMatch;
          }
        } catch (error) {
          console.warn('[SnapshotLearning] Visual similarity check failed:', error);
        }
      }
    }

    // Find best match by visual similarity
    let bestMatch: SnapshotFingerprint | null = null;
    let bestScore = 0;

    for (const fingerprint of fingerprints) {
      if (!fingerprint.elementSnippet) {
        continue;
      }

      try {
        // Use findVisualSimilarity to compare snapshots
        const candidates: import('../types/visual').VisualCandidate[] = [{
          screenshot: currentSnapshot,
          selector: '',
          visualDescription: '',
          importance: {
            sizeScore: 0.5,
            colorScore: 0.5,
            positionScore: 0.5,
            iconScore: 0.5,
            textStyleScore: 0.5,
            interactiveScore: 0.5,
            overallImportance: 0.5,
          },
          context: { nearbyElements: [], landmarks: [], visualPattern: 'unknown' as const },
          boundingBox: { x: 0, y: 0, width: 0, height: 0 }
        }];
        const result = await VisualAnalysisService.findVisualSimilarity(
          fingerprint.elementSnippet,
          candidates
        );
        const similarity = result?.similarity?.overallVisualMatch || 0;

        if (similarity > bestScore && similarity > 0.6) {
          bestScore = similarity;
          bestMatch = fingerprint;
        }
      } catch (error) {
        console.warn('[SnapshotLearning] Visual similarity comparison failed:', error);
      }
    }

    return bestMatch;
  }

  /**
   * Compare current element with recorded snapshot
   * Returns similarity score (0-1)
   */
  static async compareWithSnapshot(
    currentElementSnapshot: string,
    recordedSnapshot: string
  ): Promise<number> {
    try {
      // Use findVisualSimilarity to compare snapshots
      const candidates: import('../types/visual').VisualCandidate[] = [{
        screenshot: currentElementSnapshot,
        selector: '',
        visualDescription: '',
        importance: {
          sizeScore: 0.5,
          colorScore: 0.5,
          positionScore: 0.5,
          iconScore: 0.5,
          textStyleScore: 0.5,
          interactiveScore: 0.5,
          overallImportance: 0.5,
        },
        context: { nearbyElements: [], landmarks: [], visualPattern: 'unknown' as const },
        boundingBox: { x: 0, y: 0, width: 0, height: 0 }
      }];
      const result = await VisualAnalysisService.findVisualSimilarity(
        recordedSnapshot,
        candidates
      );
      return result?.similarity?.overallVisualMatch || 0;
    } catch (error) {
      console.warn('[SnapshotLearning] Snapshot comparison failed:', error);
      return 0;
    }
  }
}

