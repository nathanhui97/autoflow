/**
 * Platform Detector
 * 
 * Detects which platform/SaaS application is running and provides
 * platform-specific optimizations for element finding and clicking.
 */

// ============================================================================
// Types
// ============================================================================

export type PlatformName = 'salesforce' | 'office365' | 'gmail' | 'notion' | 'airtable' | 'generic';

export interface PlatformInfo {
  name: PlatformName;
  hasLockerService: boolean;  // Blocks synthetic events (Salesforce)
  hasCanvas: boolean;         // Uses canvas for UI (Excel, Airtable grids)
  shadowDomHeavy: boolean;    // Heavily uses Shadow DOM (LWC)
}

// ============================================================================
// Region Selectors by Platform
// ============================================================================

export const REGION_SELECTORS: Record<PlatformName, Record<string, string[]>> = {
  generic: {
    header: ['header', '[role="banner"]', 'nav', '[role="navigation"]'],
    sidebar: ['aside', '[role="complementary"]', 'nav[class*="sidebar"]'],
    modal: ['[role="dialog"]', '[role="alertdialog"]', '.modal', '[class*="modal"]'],
    main: ['main', '[role="main"]', 'article', '[role="article"]'],
  },
  
  salesforce: {
    header: [
      '.slds-page-header',
      'lightning-page-header',
      'force-highlights-panel',
      '.slds-global-header',
      '.forcePageHeader',
    ],
    modal: [
      'lightning-modal',
      'section[role="dialog"]',
      '.slds-modal',
      'lightning-overlay',
      '.forceModal',
    ],
    sidebar: [
      'force-record-detail',
      '.slds-panel',
      'lightning-record-form',
    ],
    actionbar: [
      'runtime_platform_actions-actions-ribbon',
      '.slds-page-header__control',
      'lightning-button-menu',
      '.forceActionsContainer',
    ],
    listview: [
      'lightning-datatable',
      '.slds-table',
      '[role="grid"]',
    ],
  },
  
  office365: {
    ribbon: ['.ms-CommandBar', '[role="menubar"]', '.o365sx-appbar'],
    toolbar: ['[role="toolbar"]', '.ms-FocusZone', '.ToolbarContent'],
    modal: ['.ms-Dialog', '[role="dialog"]', '.ms-Modal'],
    grid: ['[role="grid"]', '.ms-DetailsRow', '.od-ItemContent'],
    header: ['.ms-CommandBar', '.o365cs-topnavBrandBar'],
  },
  
  gmail: {
    toolbar: ['[role="toolbar"]', '.aeH', '.G-atb'],
    compose: ['[role="dialog"][aria-label*="Compose"]', '.AD'],
    sidebar: ['[role="navigation"]', '.TK', '.bkK'],
    emailList: ['[role="main"]', '.AO', '[role="listbox"]'],
    header: ['.gb_Be', '.nH.bkK'],
  },
  
  notion: {
    sidebar: ['.notion-sidebar', '[class*="sidebar"]'],
    page: ['.notion-page-content', '[data-block-id]'],
    modal: ['[role="dialog"]', '.notion-overlay-container'],
    header: ['.notion-topbar'],
  },
  
  airtable: {
    toolbar: ['.HeaderBar', '[class*="toolbar"]'],
    modal: ['[role="dialog"]', '[class*="modal"]'],
    grid: ['.GridView', '.flex-table', '[role="grid"]'],
    header: ['.TopBar', '[class*="header"]'],
  },
};

// ============================================================================
// Platform Detector
// ============================================================================

export class PlatformDetector {
  private static cachedPlatform: PlatformInfo | null = null;

  /**
   * Detect the current platform
   */
  static detect(): PlatformInfo {
    // Return cached result if available
    if (this.cachedPlatform) {
      return this.cachedPlatform;
    }

    const hostname = window.location.hostname.toLowerCase();

    // Salesforce
    if (hostname.includes('lightning.force.com') ||
        hostname.includes('salesforce.com') ||
        hostname.includes('force.com') ||
        this.hasSalesforceIndicators()) {
      this.cachedPlatform = {
        name: 'salesforce',
        hasLockerService: true,
        hasCanvas: false,
        shadowDomHeavy: true,
      };
      return this.cachedPlatform;
    }

    // Office 365
    if (hostname.includes('office.com') ||
        hostname.includes('sharepoint.com') ||
        hostname.includes('onedrive.com') ||
        hostname.includes('excel.office.com') ||
        this.hasOffice365Indicators()) {
      this.cachedPlatform = {
        name: 'office365',
        hasLockerService: false,
        hasCanvas: true,  // Excel uses canvas
        shadowDomHeavy: false,
      };
      return this.cachedPlatform;
    }

    // Gmail
    if (hostname.includes('mail.google.com')) {
      this.cachedPlatform = {
        name: 'gmail',
        hasLockerService: false,
        hasCanvas: false,
        shadowDomHeavy: false,
      };
      return this.cachedPlatform;
    }

    // Notion
    if (hostname.includes('notion.so') ||
        hostname.includes('notion.site') ||
        this.hasNotionIndicators()) {
      this.cachedPlatform = {
        name: 'notion',
        hasLockerService: false,
        hasCanvas: false,
        shadowDomHeavy: false,
      };
      return this.cachedPlatform;
    }

    // Airtable
    if (hostname.includes('airtable.com') ||
        this.hasAirtableIndicators()) {
      this.cachedPlatform = {
        name: 'airtable',
        hasLockerService: false,
        hasCanvas: true,  // Grid uses canvas
        shadowDomHeavy: false,
      };
      return this.cachedPlatform;
    }

    // Generic
    this.cachedPlatform = {
      name: 'generic',
      hasLockerService: false,
      hasCanvas: false,
      shadowDomHeavy: false,
    };
    return this.cachedPlatform;
  }

  /**
   * Get region selectors for the current platform
   */
  static getRegionSelectors(region: string): string[] {
    const platform = this.detect();
    const platformSelectors = REGION_SELECTORS[platform.name];
    
    // Try platform-specific first
    if (platformSelectors && platformSelectors[region]) {
      return platformSelectors[region];
    }
    
    // Fallback to generic
    return REGION_SELECTORS.generic[region] || [];
  }

  /**
   * Check if element is in a specific region
   */
  static isInRegion(element: Element, region: string): boolean {
    const selectors = this.getRegionSelectors(region);
    
    for (const selector of selectors) {
      try {
        const container = element.closest(selector);
        if (container) {
          return true;
        }
      } catch {
        // Invalid selector, skip
      }
    }
    
    return false;
  }

  /**
   * Clear cached platform (for testing)
   */
  static clearCache(): void {
    this.cachedPlatform = null;
  }

  // ==========================================================================
  // Private: Platform Detection Helpers
  // ==========================================================================

  private static hasSalesforceIndicators(): boolean {
    return !!(
      document.querySelector('lightning-page') ||
      document.querySelector('[class*="slds-"]') ||
      document.querySelector('force-record-layout') ||
      (window as any).Aura ||
      (window as any).$A
    );
  }

  private static hasOffice365Indicators(): boolean {
    return !!(
      document.querySelector('.ms-CommandBar') ||
      document.querySelector('.o365sx-appbar') ||
      document.querySelector('[class*="ms-"]') ||
      (window as any).Office
    );
  }

  private static hasNotionIndicators(): boolean {
    return !!(
      document.querySelector('.notion-sidebar') ||
      document.querySelector('[data-block-id]') ||
      document.body.className.includes('notion')
    );
  }

  private static hasAirtableIndicators(): boolean {
    return !!(
      document.querySelector('.HeaderBar') ||
      document.querySelector('.GridView') ||
      document.body.className.includes('airtable')
    );
  }
}

