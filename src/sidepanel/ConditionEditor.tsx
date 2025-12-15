/**
 * ConditionEditor - UI for editing suggested success conditions
 * 
 * Shows auto-detected conditions with user confirmation/editing.
 * "I think success means: [menu becomes visible]. Is this correct?"
 */

import { useState } from 'react';
import type { 
  SuccessCondition, 
  SuggestedCondition
} from '../types/conditions';
import { 
  describeCondition, 
  conditionTemplates,
  elementVisible,
  elementGone,
  urlChanged,
  urlContains,
  textAppeared,
} from '../types/conditions';

interface ConditionEditorProps {
  /** Suggested condition from auto-detection */
  suggested: SuggestedCondition;
  /** Step description for context */
  stepDescription: string;
  /** Callback when user confirms a condition */
  onConfirm: (condition: SuccessCondition) => void;
  /** Callback when user skips verification */
  onSkip: () => void;
  /** Callback to close editor */
  onClose: () => void;
}

/**
 * Condition template for quick selection
 */
interface ConditionTemplate {
  id: string;
  label: string;
  description: string;
  condition: SuccessCondition;
}

/**
 * ConditionEditor component
 */
export function ConditionEditor({
  suggested,
  stepDescription,
  onConfirm,
  onSkip,
  onClose,
}: ConditionEditorProps) {
  const [selectedCondition, setSelectedCondition] = useState<SuccessCondition>(suggested.condition);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customSelector, setCustomSelector] = useState('');
  const [customTimeout, setCustomTimeout] = useState(5000);
  
  // Common templates for quick selection
  const templates: ConditionTemplate[] = [
    {
      id: 'suggested',
      label: 'Suggested',
      description: describeCondition(suggested.condition),
      condition: suggested.condition,
    },
    {
      id: 'menu-visible',
      label: 'Menu/Dropdown Visible',
      description: 'Wait for menu or dropdown to appear',
      condition: conditionTemplates.dropdownOpened(),
    },
    {
      id: 'modal-visible',
      label: 'Modal/Dialog Visible',
      description: 'Wait for modal or dialog to appear',
      condition: conditionTemplates.modalOpened(),
    },
    {
      id: 'modal-closed',
      label: 'Modal/Dialog Closed',
      description: 'Wait for modal or dialog to close',
      condition: conditionTemplates.modalClosed(),
    },
    {
      id: 'url-changed',
      label: 'URL Changed',
      description: 'Wait for page navigation',
      condition: urlChanged(10000),
    },
    {
      id: 'loading-complete',
      label: 'Loading Complete',
      description: 'Wait for loaders to disappear and DOM to stabilize',
      condition: conditionTemplates.loadingComplete(),
    },
  ];
  
  const handleConfirm = () => {
    onConfirm(selectedCondition);
  };
  
  const handleCustomCondition = (type: 'element_visible' | 'element_gone' | 'text_appeared' | 'url_contains') => {
    let condition: SuccessCondition;
    
    switch (type) {
      case 'element_visible':
        condition = elementVisible(customSelector, customTimeout);
        break;
      case 'element_gone':
        condition = elementGone(customSelector, customTimeout);
        break;
      case 'text_appeared':
        condition = textAppeared(customSelector, customTimeout);
        break;
      case 'url_contains':
        condition = urlContains(customSelector, customTimeout);
        break;
    }
    
    setSelectedCondition(condition);
  };
  
  const confidenceColor = {
    high: 'text-green-600',
    medium: 'text-yellow-600',
    low: 'text-red-600',
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card p-6 rounded-lg border border-border max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-card-foreground">
            Verify Step Success
          </h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Step context */}
        <div className="mb-4 p-3 bg-muted rounded-md">
          <p className="text-sm text-muted-foreground">Step:</p>
          <p className="text-sm font-medium text-foreground">{stepDescription}</p>
        </div>
        
        {/* Suggested condition */}
        <div className="mb-4">
          <p className="text-sm text-muted-foreground mb-2">
            I detected a success condition:
          </p>
          <div className="p-3 border border-primary/50 bg-primary/10 rounded-md">
            <p className="text-sm font-medium text-foreground">
              {describeCondition(suggested.condition)}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-xs ${confidenceColor[suggested.confidence]}`}>
                {suggested.confidence.toUpperCase()} confidence
              </span>
              <span className="text-xs text-muted-foreground">
                - {suggested.reason}
              </span>
            </div>
          </div>
        </div>
        
        {/* Template selection */}
        <div className="mb-4">
          <p className="text-sm text-muted-foreground mb-2">
            Or choose a common condition:
          </p>
          <div className="space-y-2">
            {templates.map((template) => (
              <label
                key={template.id}
                className={`flex items-start gap-3 p-3 border rounded-md cursor-pointer transition-colors ${
                  selectedCondition === template.condition
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <input
                  type="radio"
                  name="condition"
                  checked={selectedCondition === template.condition}
                  onChange={() => setSelectedCondition(template.condition)}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">{template.label}</p>
                  <p className="text-xs text-muted-foreground">{template.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
        
        {/* Advanced options */}
        <div className="mb-4">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-primary hover:text-primary/80 flex items-center gap-1"
          >
            <svg 
              className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Custom condition
          </button>
          
          {showAdvanced && (
            <div className="mt-3 p-3 border border-border rounded-md space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Selector or text
                </label>
                <input
                  type="text"
                  value={customSelector}
                  onChange={(e) => setCustomSelector(e.target.value)}
                  placeholder="e.g., [role='dialog'] or Success!"
                  className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground"
                />
              </div>
              
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Timeout (ms)
                </label>
                <input
                  type="number"
                  value={customTimeout}
                  onChange={(e) => setCustomTimeout(parseInt(e.target.value) || 5000)}
                  className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground"
                />
              </div>
              
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleCustomCondition('element_visible')}
                  disabled={!customSelector}
                  className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                >
                  Element Visible
                </button>
                <button
                  onClick={() => handleCustomCondition('element_gone')}
                  disabled={!customSelector}
                  className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                >
                  Element Gone
                </button>
                <button
                  onClick={() => handleCustomCondition('text_appeared')}
                  disabled={!customSelector}
                  className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                >
                  Text Appeared
                </button>
                <button
                  onClick={() => handleCustomCondition('url_contains')}
                  disabled={!customSelector}
                  className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                >
                  URL Contains
                </button>
              </div>
            </div>
          )}
        </div>
        
        {/* Selected condition preview */}
        {selectedCondition !== suggested.condition && (
          <div className="mb-4 p-3 bg-muted rounded-md">
            <p className="text-xs text-muted-foreground mb-1">Selected condition:</p>
            <p className="text-sm text-foreground">{describeCondition(selectedCondition)}</p>
          </div>
        )}
        
        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium"
          >
            Confirm
          </button>
          <button
            onClick={onSkip}
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md hover:bg-muted/80"
          >
            Skip Verification
          </button>
        </div>
        
        <p className="mt-3 text-xs text-muted-foreground text-center">
          Verification ensures the action succeeded before proceeding to the next step.
        </p>
      </div>
    </div>
  );
}

/**
 * Hook for managing condition editing state
 */
export function useConditionEditor() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentSuggestion, setCurrentSuggestion] = useState<SuggestedCondition | null>(null);
  const [stepDescription, setStepDescription] = useState('');
  const [resolveCallback, setResolveCallback] = useState<((condition: SuccessCondition | null) => void) | null>(null);
  
  const openEditor = (
    suggestion: SuggestedCondition,
    description: string
  ): Promise<SuccessCondition | null> => {
    return new Promise((resolve) => {
      setCurrentSuggestion(suggestion);
      setStepDescription(description);
      setResolveCallback(() => resolve);
      setIsOpen(true);
    });
  };
  
  const handleConfirm = (condition: SuccessCondition) => {
    resolveCallback?.(condition);
    setIsOpen(false);
  };
  
  const handleSkip = () => {
    resolveCallback?.(null);
    setIsOpen(false);
  };
  
  const handleClose = () => {
    resolveCallback?.(null);
    setIsOpen(false);
  };
  
  return {
    isOpen,
    currentSuggestion,
    stepDescription,
    openEditor,
    handleConfirm,
    handleSkip,
    handleClose,
  };
}

