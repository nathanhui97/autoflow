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

