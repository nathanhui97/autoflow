# Visual Snapshot Testing Guide

## Overview
This guide explains how to verify that visual snapshots are working correctly in the GhostWriter extension.

## What Are Visual Snapshots?
Visual snapshots capture:
1. **Full viewport screenshot** - The entire visible page
2. **Element snippet** - A cropped image of the clicked/input element with 50px padding for context

These snapshots are captured on `mousedown` (before click) to prevent race conditions during navigation.

## Testing Steps

### 1. Manual Console Test
Open the browser console on any page and run:

```javascript
// Test snapshot on any element (finds first button/link/input)
await window.testSnapshot();

// Or test on a specific element
await window.testSnapshot('button.my-button');
await window.testSnapshot('#my-element');
```

**Expected Output:**
- ✅ Console logs showing snapshot capture
- ✅ Image element added to page for visual verification
- ✅ Viewport and snippet sizes logged

### 2. Recording Test
1. Start recording in the side panel
2. Click on any element
3. Check the browser console for logs:
   - `📸 GhostWriter: Starting snapshot capture on mousedown`
   - `📸 GhostWriter: Awaiting snapshot from mousedown...`
   - `📸 GhostWriter: Snapshot attached to click event`
   - `📸 GhostWriter: Step includes visualSnapshot with viewport size: X chars, snippet size: Y chars`

### 3. Verify in Exported JSON
1. Record a few steps
2. Export the workflow JSON
3. Check that each CLICK and INPUT step has a `visualSnapshot` field:
   ```json
   {
     "type": "CLICK",
     "payload": {
       "visualSnapshot": {
         "viewport": "data:image/png;base64,iVBORw0KG...",
         "elementSnippet": "data:image/jpeg;base64,/9j/4AAQ...",
         "timestamp": 1234567890,
         "viewportSize": { "width": 1920, "height": 1080 },
         "elementBounds": { "x": 100, "y": 200, "width": 50, "height": 30 }
       }
     }
   }
   ```

### 4. Verify in AI Payload
The AI payload should include `visualSnapshot` but exclude technical fields:
- ✅ `visualSnapshot.viewport` - Full viewport screenshot
- ✅ `visualSnapshot.elementSnippet` - Cropped element snippet
- ✂️ `elementBounds` - Excluded (coordinates meaningless to text models)
- ✂️ `timestamp` - Excluded (not needed for intent)
- ✂️ `viewportSize` - Excluded (not needed for intent)

## Troubleshooting

### Issue: "No snapshot received from service worker"
**Possible Causes:**
- Missing `tabs` permission in manifest.json
- Service worker not handling `CAPTURE_VIEWPORT` message
- Tab context not available

**Fix:**
1. Check `public/manifest.json` has `"tabs"` permission
2. Check service worker console for errors
3. Verify message type `CAPTURE_VIEWPORT` is defined in `src/types/messages.ts`

### Issue: "Element has zero dimensions"
**Possible Causes:**
- Element is hidden or not rendered
- Element is in an iframe (cross-origin)

**Fix:**
- Ensure element is visible before clicking
- For iframes, snapshots may not work due to cross-origin restrictions

### Issue: "Snapshot promise resolved but returned null"
**Possible Causes:**
- Canvas cropping failed
- Image load failed
- Chrome API returned empty data

**Fix:**
- Check browser console for detailed error messages
- Verify element is in viewport
- Check if page has canvas restrictions

### Issue: Snapshot missing in exported JSON
**Possible Causes:**
- `pendingSnapshot` not being awaited
- Snapshot capture failing silently
- Race condition (snapshot not ready before step is sent)

**Fix:**
- Check console logs for snapshot capture messages
- Verify `handleMousedown` is called before `handleClick`
- Check that `pendingSnapshot` is not null when awaiting

## Architecture

### Flow Diagram
```
User mousedown
  ↓
RecordingManager.handleMousedown()
  ↓
VisualSnapshotService.capture(element)
  ↓
chrome.runtime.sendMessage({ type: 'CAPTURE_VIEWPORT' })
  ↓
Service Worker: chrome.tabs.captureVisibleTab()
  ↓
Returns base64 PNG
  ↓
VisualSnapshotService.cropImage() (Canvas API)
  ↓
Returns { viewport, elementSnippet }
  ↓
Stored in RecordingManager.pendingSnapshot (Promise)
  ↓
User click/input
  ↓
RecordingManager.handleClick() / captureInputValue()
  ↓
await pendingSnapshot
  ↓
Attach to step.payload.visualSnapshot
  ↓
Send to side panel via RECORDED_STEP message
```

### Key Files
- `src/content/visual-snapshot.ts` - Snapshot capture service
- `src/content/recording-manager.ts` - Event handlers and snapshot attachment
- `src/background/service-worker.ts` - Chrome API handler
- `src/content/ai-data-builder.ts` - Includes visualSnapshot in AI payload

## Success Criteria
✅ Console test function works (`window.testSnapshot()`)
✅ Snapshots captured on mousedown
✅ Snapshots attached to click/input steps
✅ `visualSnapshot` present in exported JSON
✅ `visualSnapshot` included in AI payload (without technical fields)
✅ No console errors during recording


