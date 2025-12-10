/**
 * Visual Snapshot Service - Captures viewport and element snippets using Chrome API
 * Uses native Chrome captureVisibleTab API + Canvas cropping to avoid html2canvas limitations
 * (html2canvas fails on Google Sheets canvas elements and cross-origin iframes)
 */

export class VisualSnapshotService {
  /**
   * Capture viewport and element snippet using Chrome API + Canvas crop
   * This avoids html2canvas limitations with Google Sheets canvas elements
   */
  static async capture(element: Element): Promise<{ viewport: string; elementSnippet: string } | null> {
    try {
      // Step A: Get Coordinates BEFORE the async call (in case DOM shifts)
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        console.warn('📸 GhostWriter: Element has zero dimensions, skipping snapshot');
        return null;
      }

      console.log('📸 GhostWriter: Requesting viewport screenshot from service worker');
      // Step B: Get the Master Screenshot via Chrome API
      // This handles the "Google Sheets Canvas" problem because it captures pixels, not DOM
      const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_VIEWPORT' });
      if (!response || !response.data?.snapshot) {
        console.warn('📸 GhostWriter: No snapshot received from service worker');
        return null;
      }
      
      const fullScreenshot = response.data.snapshot;
      console.log('📸 GhostWriter: Viewport screenshot captured, size:', fullScreenshot.length, 'chars');

      // Step C: Crop it (Handling Retina Displays)
      const snippet = await this.cropImage(fullScreenshot, rect);
      console.log('📸 GhostWriter: Element snippet cropped, size:', snippet.length, 'chars');

      return {
        viewport: fullScreenshot,
        elementSnippet: snippet
      };
    } catch (err) {
      console.warn("📸 GhostWriter Visual Capture Failed:", err);
      return null;
    }
  }

  private static cropImage(base64: string, rect: DOMRect): Promise<string> {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          resolve(base64); // Fallback to full screenshot if canvas context fails
          return;
        }
        
        // CRITICAL: Handle Device Pixel Ratio (MacBooks/High-DPI)
        const dpr = window.devicePixelRatio || 1;
        const padding = 50; // Context padding for AI

        // Calculate Crop Dimensions (clamp to image bounds)
        const sourceX = Math.max(0, (rect.left - padding) * dpr);
        const sourceY = Math.max(0, (rect.top - padding) * dpr);
        const sourceWidth = Math.min(
          (rect.width + (padding * 2)) * dpr,
          image.width - sourceX
        );
        const sourceHeight = Math.min(
          (rect.height + (padding * 2)) * dpr,
          image.height - sourceY
        );

        // Ensure valid dimensions
        if (sourceWidth <= 0 || sourceHeight <= 0) {
          resolve(base64); // Fallback to full screenshot
          return;
        }

        canvas.width = sourceWidth;
        canvas.height = sourceHeight;

        ctx.drawImage(
          image,
          sourceX, sourceY, sourceWidth, sourceHeight, // Source Rect
          0, 0, sourceWidth, sourceHeight              // Dest Rect
        );

        // Compress for Token Efficiency (JPEG 60% quality)
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      image.onerror = () => {
        // Fallback to full screenshot if image load fails
        resolve(base64);
      };
      image.src = base64;
    });
  }
}

