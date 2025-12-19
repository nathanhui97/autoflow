/**
 * Visual Annotation Service
 * 
 * Provides canvas-based drawing of markers on screenshots to help AI
 * identify the exact location of user actions (clicks, typing, etc.)
 * 
 * Marker Styles:
 * - Click: Red circle (16px radius) + crosshair
 * - Double-click: Red double circle
 * - Type/Input: Blue rectangle around field
 * - Select (dropdown): Orange highlight on selected option
 */

export type ActionType = 'click' | 'double-click' | 'type' | 'select' | 'scroll';

export interface AnnotationPoint {
  x: number;
  y: number;
}

export interface AnnotationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnnotationOptions {
  /** The action type determines the marker style */
  actionType: ActionType;
  /** Click point (center of the marker) */
  clickPoint: AnnotationPoint;
  /** Element bounding box (optional, for bounding box overlay) */
  elementBounds?: AnnotationBounds;
  /** Label text to display (e.g., input value, button text) */
  label?: string;
  /** Whether to draw a bounding box around the element */
  drawBoundingBox?: boolean;
  /** Circle radius for click markers (default: 20) */
  circleRadius?: number;
  /** Line width for markers (default: 3) */
  lineWidth?: number;
}

export interface AnnotationResult {
  /** Original screenshot (unchanged) */
  original: string;
  /** Annotated screenshot with markers */
  annotated: string;
  /** Click point coordinates */
  clickPoint: AnnotationPoint;
  /** Action type used */
  actionType: ActionType;
}

// Color palette for different action types
const COLORS = {
  click: {
    primary: '#FF0000',      // Bright red
    secondary: '#FF6666',    // Light red
    outline: '#FFFFFF',      // White outline for visibility
  },
  'double-click': {
    primary: '#FF0000',
    secondary: '#FF3333',
    outline: '#FFFFFF',
  },
  type: {
    primary: '#0066FF',      // Blue
    secondary: '#66AAFF',
    outline: '#FFFFFF',
  },
  select: {
    primary: '#FF9900',      // Orange
    secondary: '#FFCC66',
    outline: '#FFFFFF',
  },
  scroll: {
    primary: '#00CC00',      // Green
    secondary: '#66FF66',
    outline: '#FFFFFF',
  },
};

export class VisualAnnotationService {
  /**
   * Draw visual markers on a screenshot to indicate where an action occurred
   * 
   * @param screenshot - Base64 encoded screenshot (data URL)
   * @param options - Annotation options (action type, click point, etc.)
   * @returns Promise with original and annotated screenshots
   */
  static async annotate(
    screenshot: string,
    options: AnnotationOptions
  ): Promise<AnnotationResult> {
    return new Promise((resolve) => {
      const image = new Image();
      
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          if (!ctx) {
            resolve({
              original: screenshot,
              annotated: screenshot,
              clickPoint: options.clickPoint,
              actionType: options.actionType,
            });
            return;
          }

          // Set canvas size to match image
          canvas.width = image.width;
          canvas.height = image.height;

          // Draw the original screenshot
          ctx.drawImage(image, 0, 0);

          // Apply DPR scaling for coordinates (screenshots are captured at device pixel ratio)
          const dpr = window.devicePixelRatio || 1;
          const scaledPoint = {
            x: options.clickPoint.x * dpr,
            y: options.clickPoint.y * dpr,
          };
          const scaledBounds = options.elementBounds ? {
            x: options.elementBounds.x * dpr,
            y: options.elementBounds.y * dpr,
            width: options.elementBounds.width * dpr,
            height: options.elementBounds.height * dpr,
          } : undefined;
          const scaledRadius = (options.circleRadius || 20) * dpr;
          const scaledLineWidth = (options.lineWidth || 3) * dpr;

          // Draw markers based on action type
          switch (options.actionType) {
            case 'click':
              this.drawClickMarker(ctx, scaledPoint, scaledRadius, scaledLineWidth);
              break;
            case 'double-click':
              this.drawDoubleClickMarker(ctx, scaledPoint, scaledRadius, scaledLineWidth);
              break;
            case 'type':
              this.drawTypeMarker(ctx, scaledPoint, scaledBounds, scaledLineWidth, options.label);
              break;
            case 'select':
              this.drawSelectMarker(ctx, scaledPoint, scaledBounds, scaledLineWidth);
              break;
            case 'scroll':
              this.drawScrollMarker(ctx, scaledPoint, scaledLineWidth);
              break;
          }

          // Draw bounding box if requested
          if (options.drawBoundingBox && scaledBounds) {
            this.drawBoundingBox(ctx, scaledBounds, options.actionType, scaledLineWidth);
          }

          // Convert to base64
          const annotated = canvas.toDataURL('image/jpeg', 0.85);

          resolve({
            original: screenshot,
            annotated,
            clickPoint: options.clickPoint,
            actionType: options.actionType,
          });
        } catch (error) {
          console.error('[VisualAnnotation] Error annotating screenshot:', error);
          resolve({
            original: screenshot,
            annotated: screenshot,
            clickPoint: options.clickPoint,
            actionType: options.actionType,
          });
        }
      };

      image.onerror = () => {
        console.error('[VisualAnnotation] Failed to load screenshot for annotation');
        resolve({
          original: screenshot,
          annotated: screenshot,
          clickPoint: options.clickPoint,
          actionType: options.actionType,
        });
      };

      image.src = screenshot;
    });
  }

  /**
   * Draw a click marker: hollow red circle with corner brackets (doesn't cover the element)
   */
  private static drawClickMarker(
    ctx: CanvasRenderingContext2D,
    point: AnnotationPoint,
    radius: number,
    lineWidth: number
  ): void {
    const colors = COLORS.click;
    const bracketSize = radius * 0.4;

    // Draw outer white circle for visibility
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius + lineWidth, 0, Math.PI * 2);
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = lineWidth + 2;
    ctx.stroke();

    // Draw main red HOLLOW circle (no fill - keeps element visible!)
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // Draw corner brackets at the four corners (top-left, top-right, bottom-left, bottom-right)
    // This helps guide the eye without obscuring the center
    const bracketOffset = radius * 0.7; // Position brackets at ~70% of radius
    
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = lineWidth + 2;
    
    // Top-left bracket
    ctx.beginPath();
    ctx.moveTo(point.x - bracketOffset, point.y - bracketOffset + bracketSize);
    ctx.lineTo(point.x - bracketOffset, point.y - bracketOffset);
    ctx.lineTo(point.x - bracketOffset + bracketSize, point.y - bracketOffset);
    ctx.stroke();
    
    // Top-right bracket
    ctx.beginPath();
    ctx.moveTo(point.x + bracketOffset - bracketSize, point.y - bracketOffset);
    ctx.lineTo(point.x + bracketOffset, point.y - bracketOffset);
    ctx.lineTo(point.x + bracketOffset, point.y - bracketOffset + bracketSize);
    ctx.stroke();
    
    // Bottom-left bracket
    ctx.beginPath();
    ctx.moveTo(point.x - bracketOffset, point.y + bracketOffset - bracketSize);
    ctx.lineTo(point.x - bracketOffset, point.y + bracketOffset);
    ctx.lineTo(point.x - bracketOffset + bracketSize, point.y + bracketOffset);
    ctx.stroke();
    
    // Bottom-right bracket
    ctx.beginPath();
    ctx.moveTo(point.x + bracketOffset, point.y + bracketOffset - bracketSize);
    ctx.lineTo(point.x + bracketOffset, point.y + bracketOffset);
    ctx.lineTo(point.x + bracketOffset - bracketSize, point.y + bracketOffset);
    ctx.stroke();

    // Draw red corner brackets
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = lineWidth;
    
    // Top-left bracket
    ctx.beginPath();
    ctx.moveTo(point.x - bracketOffset, point.y - bracketOffset + bracketSize);
    ctx.lineTo(point.x - bracketOffset, point.y - bracketOffset);
    ctx.lineTo(point.x - bracketOffset + bracketSize, point.y - bracketOffset);
    ctx.stroke();
    
    // Top-right bracket
    ctx.beginPath();
    ctx.moveTo(point.x + bracketOffset - bracketSize, point.y - bracketOffset);
    ctx.lineTo(point.x + bracketOffset, point.y - bracketOffset);
    ctx.lineTo(point.x + bracketOffset, point.y - bracketOffset + bracketSize);
    ctx.stroke();
    
    // Bottom-left bracket
    ctx.beginPath();
    ctx.moveTo(point.x - bracketOffset, point.y + bracketOffset - bracketSize);
    ctx.lineTo(point.x - bracketOffset, point.y + bracketOffset);
    ctx.lineTo(point.x - bracketOffset + bracketSize, point.y + bracketOffset);
    ctx.stroke();
    
    // Bottom-right bracket
    ctx.beginPath();
    ctx.moveTo(point.x + bracketOffset, point.y + bracketOffset - bracketSize);
    ctx.lineTo(point.x + bracketOffset, point.y + bracketOffset);
    ctx.lineTo(point.x + bracketOffset - bracketSize, point.y + bracketOffset);
    ctx.stroke();

    // Draw small center dot (minimal coverage)
    ctx.beginPath();
    ctx.arc(point.x, point.y, lineWidth * 1, 0, Math.PI * 2);
    ctx.fillStyle = colors.primary;
    ctx.fill();
    
    // Add white center dot for contrast
    ctx.beginPath();
    ctx.arc(point.x, point.y, lineWidth * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
  }

  /**
   * Draw a double-click marker: two concentric HOLLOW circles (no fill)
   */
  private static drawDoubleClickMarker(
    ctx: CanvasRenderingContext2D,
    point: AnnotationPoint,
    radius: number,
    lineWidth: number
  ): void {
    const colors = COLORS['double-click'];

    // Outer circle (white outline)
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 1.5 + lineWidth, 0, Math.PI * 2);
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = lineWidth + 2;
    ctx.stroke();

    // Outer circle (red) - HOLLOW
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // Inner circle (white outline)
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius + lineWidth, 0, Math.PI * 2);
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = lineWidth + 2;
    ctx.stroke();

    // Inner circle (red) - HOLLOW, NO FILL
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // Small center dot
    ctx.beginPath();
    ctx.arc(point.x, point.y, lineWidth * 1, 0, Math.PI * 2);
    ctx.fillStyle = colors.primary;
    ctx.fill();
    
    // White center for contrast
    ctx.beginPath();
    ctx.arc(point.x, point.y, lineWidth * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
  }

  /**
   * Draw a type/input marker: blue rectangle around the input field
   */
  private static drawTypeMarker(
    ctx: CanvasRenderingContext2D,
    point: AnnotationPoint,
    bounds: AnnotationBounds | undefined,
    lineWidth: number,
    label?: string
  ): void {
    const colors = COLORS.type;

    if (bounds) {
      // Draw rectangle around input field
      const padding = lineWidth * 2;
      
      // White outline
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = lineWidth + 2;
      ctx.strokeRect(
        bounds.x - padding,
        bounds.y - padding,
        bounds.width + padding * 2,
        bounds.height + padding * 2
      );

      // Blue rectangle
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = lineWidth;
      ctx.strokeRect(
        bounds.x - padding,
        bounds.y - padding,
        bounds.width + padding * 2,
        bounds.height + padding * 2
      );

      // Very light semi-transparent fill (barely visible to keep text readable)
      ctx.fillStyle = 'rgba(0, 102, 255, 0.05)';
      ctx.fillRect(
        bounds.x - padding,
        bounds.y - padding,
        bounds.width + padding * 2,
        bounds.height + padding * 2
      );

      // Draw cursor indicator at click point
      this.drawTextCursor(ctx, point, bounds.height * 0.6, lineWidth, colors.primary);
    } else {
      // No bounds, just draw a text cursor at the point
      this.drawTextCursor(ctx, point, 30, lineWidth, colors.primary);
    }

    // Draw label if provided
    if (label && bounds) {
      this.drawLabel(ctx, label, bounds.x, bounds.y - lineWidth * 8, colors.primary);
    }
  }

  /**
   * Draw a text cursor (I-beam) indicator
   */
  private static drawTextCursor(
    ctx: CanvasRenderingContext2D,
    point: AnnotationPoint,
    height: number,
    lineWidth: number,
    color: string
  ): void {
    const halfHeight = height / 2;
    const serifWidth = lineWidth * 3;

    // White outline
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = lineWidth + 2;

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(point.x, point.y - halfHeight);
    ctx.lineTo(point.x, point.y + halfHeight);
    ctx.stroke();

    // Top serif
    ctx.beginPath();
    ctx.moveTo(point.x - serifWidth, point.y - halfHeight);
    ctx.lineTo(point.x + serifWidth, point.y - halfHeight);
    ctx.stroke();

    // Bottom serif
    ctx.beginPath();
    ctx.moveTo(point.x - serifWidth, point.y + halfHeight);
    ctx.lineTo(point.x + serifWidth, point.y + halfHeight);
    ctx.stroke();

    // Colored cursor
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(point.x, point.y - halfHeight);
    ctx.lineTo(point.x, point.y + halfHeight);
    ctx.stroke();

    // Top serif
    ctx.beginPath();
    ctx.moveTo(point.x - serifWidth, point.y - halfHeight);
    ctx.lineTo(point.x + serifWidth, point.y - halfHeight);
    ctx.stroke();

    // Bottom serif
    ctx.beginPath();
    ctx.moveTo(point.x - serifWidth, point.y + halfHeight);
    ctx.lineTo(point.x + serifWidth, point.y + halfHeight);
    ctx.stroke();
  }

  /**
   * Draw a select/dropdown marker: orange highlight
   */
  private static drawSelectMarker(
    ctx: CanvasRenderingContext2D,
    point: AnnotationPoint,
    bounds: AnnotationBounds | undefined,
    lineWidth: number
  ): void {
    const colors = COLORS.select;

    if (bounds) {
      const padding = lineWidth;

      // White outline
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = lineWidth + 2;
      ctx.strokeRect(
        bounds.x - padding,
        bounds.y - padding,
        bounds.width + padding * 2,
        bounds.height + padding * 2
      );

      // Orange rectangle
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = lineWidth;
      ctx.strokeRect(
        bounds.x - padding,
        bounds.y - padding,
        bounds.width + padding * 2,
        bounds.height + padding * 2
      );

      // Very light highlight fill (keeps text visible)
      ctx.fillStyle = 'rgba(255, 153, 0, 0.08)';
      ctx.fillRect(
        bounds.x - padding,
        bounds.y - padding,
        bounds.width + padding * 2,
        bounds.height + padding * 2
      );

      // Draw arrow pointing to selection
      this.drawArrowToPoint(ctx, point, colors.primary, lineWidth);
    } else {
      // No bounds, draw circle with arrow
      const radius = lineWidth * 5;
      
      // Circle
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = lineWidth + 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = lineWidth;
      ctx.stroke();

      // No fill - keep element visible
    }
  }

  /**
   * Draw a scroll marker: green arrows
   */
  private static drawScrollMarker(
    ctx: CanvasRenderingContext2D,
    point: AnnotationPoint,
    lineWidth: number
  ): void {
    const colors = COLORS.scroll;
    const arrowSize = lineWidth * 8;

    // Draw up and down arrows
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = lineWidth + 2;

    // Up arrow
    ctx.beginPath();
    ctx.moveTo(point.x, point.y - arrowSize);
    ctx.lineTo(point.x - arrowSize / 2, point.y - arrowSize / 2);
    ctx.moveTo(point.x, point.y - arrowSize);
    ctx.lineTo(point.x + arrowSize / 2, point.y - arrowSize / 2);
    ctx.stroke();

    // Down arrow
    ctx.beginPath();
    ctx.moveTo(point.x, point.y + arrowSize);
    ctx.lineTo(point.x - arrowSize / 2, point.y + arrowSize / 2);
    ctx.moveTo(point.x, point.y + arrowSize);
    ctx.lineTo(point.x + arrowSize / 2, point.y + arrowSize / 2);
    ctx.stroke();

    // Vertical line connecting arrows
    ctx.beginPath();
    ctx.moveTo(point.x, point.y - arrowSize);
    ctx.lineTo(point.x, point.y + arrowSize);
    ctx.stroke();

    // Green version
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = lineWidth;

    // Up arrow
    ctx.beginPath();
    ctx.moveTo(point.x, point.y - arrowSize);
    ctx.lineTo(point.x - arrowSize / 2, point.y - arrowSize / 2);
    ctx.moveTo(point.x, point.y - arrowSize);
    ctx.lineTo(point.x + arrowSize / 2, point.y - arrowSize / 2);
    ctx.stroke();

    // Down arrow
    ctx.beginPath();
    ctx.moveTo(point.x, point.y + arrowSize);
    ctx.lineTo(point.x - arrowSize / 2, point.y + arrowSize / 2);
    ctx.moveTo(point.x, point.y + arrowSize);
    ctx.lineTo(point.x + arrowSize / 2, point.y + arrowSize / 2);
    ctx.stroke();

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(point.x, point.y - arrowSize);
    ctx.lineTo(point.x, point.y + arrowSize);
    ctx.stroke();
  }

  /**
   * Draw an arrow pointing to a specific point
   */
  private static drawArrowToPoint(
    ctx: CanvasRenderingContext2D,
    point: AnnotationPoint,
    color: string,
    lineWidth: number
  ): void {
    const arrowLength = lineWidth * 10;
    const arrowHead = lineWidth * 4;

    // Arrow comes from top-left
    const startX = point.x - arrowLength;
    const startY = point.y - arrowLength;

    // White outline
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = lineWidth + 2;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();

    // Arrow head
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x - arrowHead, point.y - arrowHead / 2);
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x - arrowHead / 2, point.y - arrowHead);
    ctx.stroke();

    // Colored arrow
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();

    // Arrow head
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x - arrowHead, point.y - arrowHead / 2);
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x - arrowHead / 2, point.y - arrowHead);
    ctx.stroke();
  }

  /**
   * Draw a bounding box around an element
   */
  private static drawBoundingBox(
    ctx: CanvasRenderingContext2D,
    bounds: AnnotationBounds,
    actionType: ActionType,
    lineWidth: number
  ): void {
    const colors = COLORS[actionType];
    const padding = lineWidth;

    // Dashed rectangle
    ctx.setLineDash([lineWidth * 3, lineWidth * 2]);

    // White outline
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = lineWidth + 1;
    ctx.strokeRect(
      bounds.x - padding,
      bounds.y - padding,
      bounds.width + padding * 2,
      bounds.height + padding * 2
    );

    // Colored rectangle
    ctx.strokeStyle = colors.secondary;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(
      bounds.x - padding,
      bounds.y - padding,
      bounds.width + padding * 2,
      bounds.height + padding * 2
    );

    // Reset line dash
    ctx.setLineDash([]);
  }

  /**
   * Draw a text label
   */
  private static drawLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color: string
  ): void {
    const dpr = window.devicePixelRatio || 1;
    const fontSize = 14 * dpr;
    const padding = 4 * dpr;

    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    const textWidth = ctx.measureText(text).width;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(x, y - fontSize - padding, textWidth + padding * 2, fontSize + padding * 2);

    // Text
    ctx.fillStyle = color;
    ctx.fillText(text, x + padding, y - padding);
  }

  /**
   * Draw annotation dynamically (for use during execution when recorded annotation isn't available)
   * This is useful when we need to annotate a fresh screenshot at execution time.
   * 
   * @param screenshot - Current screenshot
   * @param clickPoint - Where the user originally clicked
   * @param actionType - Type of action
   * @param elementBounds - Optional element bounds
   * @returns Annotated screenshot
   */
  static async annotateForAI(
    screenshot: string,
    clickPoint: AnnotationPoint,
    actionType: ActionType = 'click',
    elementBounds?: AnnotationBounds
  ): Promise<string> {
    const result = await this.annotate(screenshot, {
      actionType,
      clickPoint,
      elementBounds,
      drawBoundingBox: !!elementBounds,
      circleRadius: 25, // Larger for AI visibility
      lineWidth: 4,     // Thicker lines for AI
    });

    return result.annotated;
  }
}

