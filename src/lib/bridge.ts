import type { ExtensionMessage, MessageResponse, PingMessage } from '../types/messages';

/**
 * RuntimeBridge - Handles all communication between Side Panel, Background, and Content Scripts
 * 
 * Critical: Do NOT use raw chrome.runtime.sendMessage calls in UI code.
 * Always use this bridge for all runtime communication.
 */
export class RuntimeBridge {
  private messageListeners: Map<string, (message: ExtensionMessage, sender: chrome.runtime.MessageSender) => void> = new Map();
  private retryDelay = 1000; // 1 second delay for retries

  constructor() {
    this.setupMessageListener();
  }

  /**
   * Setup the message listener for incoming messages
   */
  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
      const listener = this.messageListeners.get(message.type);
      if (listener) {
        try {
          const result = listener(message, sender);
          // Handle async listeners - check if result is a Promise
          if (result !== undefined && result !== null && typeof result === 'object' && 'then' in result && typeof (result as Promise<MessageResponse>).then === 'function') {
            (result as Promise<MessageResponse>).then((response) => {
              if (response !== undefined) {
                sendResponse(response);
              }
            }).catch((error) => {
              sendResponse({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
            });
            return true; // Indicate we will send response asynchronously
          }
          // Synchronous response
          if (result !== undefined) {
            sendResponse(result as MessageResponse);
          }
          return false;
        } catch (error) {
          sendResponse({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
      }
      return false;
    });
  }

  /**
   * Register a message listener
   */
  onMessage(
    messageType: ExtensionMessage['type'],
    handler: (message: ExtensionMessage, sender: chrome.runtime.MessageSender) => void | Promise<MessageResponse>
  ): void {
    this.messageListeners.set(messageType, handler);
  }

  /**
   * Remove a message listener
   */
  removeListener(messageType: ExtensionMessage['type']): void {
    this.messageListeners.delete(messageType);
  }

  /**
   * Send a message with retry logic
   * Automatically retries once if the first attempt fails
   */
  private async sendMessageWithRetry(
    message: ExtensionMessage,
    tabId?: number
  ): Promise<MessageResponse> {
    try {
      return await this.sendMessageInternal(message, tabId);
    } catch (error) {
      // Retry once after delay
      await this.delay(this.retryDelay);
      try {
        return await this.sendMessageInternal(message, tabId);
      } catch (retryError) {
        throw new Error(
          `Message failed after retry: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  }

  /**
   * Internal message sending implementation
   */
  private async sendMessageInternal(
    message: ExtensionMessage,
    tabId?: number
  ): Promise<MessageResponse> {
    return new Promise((resolve, reject) => {
      if (tabId) {
        // Send to content script in specific tab
        chrome.tabs.sendMessage(tabId, message, (response: MessageResponse) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response || { success: true });
        });
      } else {
        // Send to background/service worker
        chrome.runtime.sendMessage(message, (response: MessageResponse) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response || { success: true });
        });
      }
    });
  }

  /**
   * Send a message to the content script or background
   * @param message - The message to send
   * @param tabId - Optional tab ID to send to specific tab's content script
   * @returns Promise resolving to the response
   */
  async sendMessage(
    message: ExtensionMessage,
    tabId?: number
  ): Promise<MessageResponse> {
    return this.sendMessageWithRetry(message, tabId);
  }

  /**
   * Ping/Pong handshake to verify content script is loaded and ready
   * If content script is not ready, attempts to inject it
   * @param tabId - The tab ID to ping (defaults to active tab)
   * @returns Promise resolving to true if content script is ready
   */
  async ping(tabId?: number): Promise<boolean> {
    try {
      // Get active tab if no tabId provided
      if (!tabId) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          throw new Error('No active tab found');
        }
        tabId = tab.id;
      }

      // Check if we're on a restricted page first
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url?.startsWith('chrome://') || 
            tab.url?.startsWith('chrome-extension://') || 
            tab.url?.startsWith('about:') ||
            tab.url?.startsWith('edge://')) {
          console.warn('Content script cannot run on restricted page:', tab.url);
          return false;
        }
      } catch (tabError) {
        console.warn('Could not get tab info:', tabError);
      }

      // Try to ping the content script
      const pingMessage: PingMessage = {
        type: 'PING',
        payload: { timestamp: Date.now() },
      };

      // Try multiple times with increasing delays
      const maxRetries = 5;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const response = await this.sendMessage(pingMessage, tabId);
          if (response.success && response.data?.type === 'PONG') {
            console.log(`Ping successful on attempt ${attempt + 1}`);
            return true;
          }
          console.warn(`Ping attempt ${attempt + 1} - invalid response:`, response);
        } catch (error) {
          console.log(`Ping attempt ${attempt + 1} failed:`, error instanceof Error ? error.message : error);
          
          // If this is not the last attempt, wait before retrying
          if (attempt < maxRetries - 1) {
            // Exponential backoff: 200ms, 400ms, 800ms, 1600ms
            const delay = 200 * Math.pow(2, attempt);
            await this.delay(delay);
          }
        }
      }

      // If all pings failed, try to manually inject the script as a last resort
      console.log('All ping attempts failed, attempting manual injection...');
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
          // Get the content script file from manifest
          const manifest = chrome.runtime.getManifest();
          const contentScripts = manifest.content_scripts || [];
          
          if (contentScripts.length > 0 && contentScripts[0].js) {
            const scriptFiles = contentScripts[0].js;
            console.log('Attempting to inject content scripts:', scriptFiles);
            
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: scriptFiles,
              });
              console.log('Content script manually injected, waiting for initialization...');
              
              // Wait a bit for script to initialize
              await this.delay(1000);
              
              // Try one more ping
              const finalPing: PingMessage = {
                type: 'PING',
                payload: { timestamp: Date.now() },
              };
              const finalResponse = await this.sendMessage(finalPing, tabId);
              if (finalResponse.success && finalResponse.data?.type === 'PONG') {
                console.log('Ping successful after manual injection');
                return true;
              }
            } catch (injectError) {
              console.error('Failed to manually inject content script:', injectError);
            }
          }
        }
      } catch (injectError) {
        console.error('Error during manual injection attempt:', injectError);
      }

      console.warn('Content script still not available after all attempts');
      return false;
    } catch (error) {
      console.error('Ping failed:', error);
      return false;
    }
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const runtimeBridge = new RuntimeBridge();

