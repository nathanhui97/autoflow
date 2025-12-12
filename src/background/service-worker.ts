/**
 * Background Service Worker for GhostWriter Extension
 * Handles message routing between Side Panel and Content Scripts
 */

import type { ExtensionMessage, MessageResponse } from '../types/messages';

// Message routing: forward messages between sidepanel and content scripts
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ) => {
    // Handle CAPTURE_VIEWPORT request from content script
    if (message.type === 'CAPTURE_VIEWPORT') {
      if (!sender.tab) {
        console.error('📸 Service Worker: CAPTURE_VIEWPORT called without sender.tab');
        sendResponse({ 
          success: false, 
          error: 'No tab context available' 
        });
        return false;
      }
      
      console.log('📸 Service Worker: Capturing viewport for tab:', sender.tab.id);
      // windowId is optional - if not provided, captures active window
      chrome.tabs.captureVisibleTab({ format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.error('📸 Service Worker: Capture failed:', chrome.runtime.lastError.message);
          sendResponse({ 
            success: false, 
            error: chrome.runtime.lastError.message 
          });
        } else if (!dataUrl) {
          console.error('📸 Service Worker: Capture returned empty data');
          sendResponse({ 
            success: false, 
            error: 'Screenshot data is empty' 
          });
        } else {
          console.log('📸 Service Worker: Viewport captured successfully, size:', dataUrl.length, 'chars');
          sendResponse({ 
            success: true, 
            data: { snapshot: dataUrl } 
          });
        }
      });
      return true; // Keep channel open for async
    }

    // Handle GET_ZOOM request
    if (message.type === 'GET_ZOOM') {
      const targetTabId = (message.payload?.tabId) || sender.tab?.id;
      if (!targetTabId) {
        sendResponse({
          success: false,
          error: 'No tab ID available'
        });
        return false;
      }

      chrome.tabs.getZoom(targetTabId, (zoomFactor) => {
        if (chrome.runtime.lastError) {
          console.error('📸 Service Worker: Get zoom failed:', chrome.runtime.lastError.message);
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message
          });
        } else {
          console.log(`📸 Service Worker: Current zoom for tab ${targetTabId}:`, zoomFactor);
          sendResponse({
            success: true,
            data: { zoomFactor }
          });
        }
      });
      return true; // Keep channel open for async
    }

    // Handle SET_ZOOM request
    if (message.type === 'SET_ZOOM') {
      const targetTabId = (message.payload?.tabId) || sender.tab?.id;
      const zoomFactor = message.payload?.zoomFactor;
      
      if (!targetTabId) {
        sendResponse({
          success: false,
          error: 'No tab ID available'
        });
        return false;
      }

      if (typeof zoomFactor !== 'number' || zoomFactor < 0.25 || zoomFactor > 5.0) {
        sendResponse({
          success: false,
          error: 'Invalid zoom factor. Must be between 0.25 and 5.0'
        });
        return false;
      }

      chrome.tabs.setZoom(targetTabId, zoomFactor, () => {
        if (chrome.runtime.lastError) {
          console.error('📸 Service Worker: Set zoom failed:', chrome.runtime.lastError.message);
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message
          });
        } else {
          console.log(`📸 Service Worker: Zoom set to ${zoomFactor} for tab ${targetTabId}`);
          sendResponse({
            success: true,
            data: { zoomFactor }
          });
        }
      });
      return true; // Keep channel open for async
    }

    // If message comes from content script, forward to sidepanel
    if (sender.tab) {
      // Message from content script - could forward to sidepanel if needed
      // For now, just acknowledge
      sendResponse({ success: true, data: message });
      return false;
    }

    // If message comes from sidepanel, forward to active tab's content script
    if (sender.id === chrome.runtime.id && !sender.tab) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, message, (response: MessageResponse) => {
            if (chrome.runtime.lastError) {
              sendResponse({
                success: false,
                error: chrome.runtime.lastError.message,
              });
            } else {
              sendResponse(response || { success: true });
            }
          });
        } else {
          sendResponse({
            success: false,
            error: 'No active tab found',
          });
        }
      });
      return true; // Keep channel open for async response
    }

    return false;
  }
);

// Initialize on startup
async function initializeExtension() {
  try {
    // Explicitly disable popup to enable onClicked handler
    await chrome.action.setPopup({ popup: '' });
    console.log('Popup disabled, onClicked handler should work');
    
    // Set up side panel globally
    await chrome.sidePanel.setOptions({
      path: 'sidepanel.html',
      enabled: true,
    });
    console.log('Side panel configured');
  } catch (error) {
    console.error('Error initializing extension:', error);
  }
}

// Initialize immediately
initializeExtension();

// Extension installation/startup
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('GhostWriter extension installed');
  } else if (details.reason === 'update') {
    console.log('GhostWriter extension updated');
  }
  
  // Re-initialize on install/update
  initializeExtension();
});

// Open side panel directly when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  console.log('Extension icon clicked, opening side panel...');
  
  // Call open() synchronously to preserve user gesture context
  // Don't use async/await as it breaks the user gesture
  chrome.sidePanel.open({ windowId: tab.windowId }, () => {
    if (chrome.runtime.lastError) {
      console.error('Failed to open side panel:', chrome.runtime.lastError.message);
    } else {
      console.log('Side panel opened successfully');
    }
  });
});

// Listen for tab updates to ensure content script is ready
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Content script will be injected automatically via manifest
  // This is just for logging/debugging
  if (changeInfo.status === 'complete' && tab.url) {
    console.log(`Tab ${tabId} loaded: ${tab.url}`);
  }
});

