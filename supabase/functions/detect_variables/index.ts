/**
 * Supabase Edge Function: detect_variables
 * Analyzes workflow step snapshots using Gemini Vision API to determine
 * which fields should be parameterized as variables for workflow execution.
 * 
 * Focuses primarily on INPUT/TEXTAREA steps, with selective CLICK step analysis
 * for selectable options (dropdowns, radio buttons).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface StepMetadata {
  stepIndex: number;
  stepId: string;
  stepType: 'INPUT' | 'CLICK' | 'SELECT' | 'KEYBOARD';
  value?: string;
  label?: string;
  inputType?: string;
  elementRole?: string;
  elementTag?: string;
  placeholder?: string;
  isSelectableOption?: boolean; // True for dropdowns, radio buttons, etc.
  isDropdown?: boolean;         // Whether this is a dropdown/select
  dropdownOptions?: string[];   // Available options in dropdown (if known from DOM)
}

interface StepForAnalysis {
  metadata: StepMetadata;
  beforeSnapshot?: string; // Base64 image
  afterSnapshot?: string;  // Base64 image
}

interface DetectVariablesRequest {
  steps: StepForAnalysis[];
  pageContext?: {
    url: string;
    title: string;
    pageType?: string;
  };
}

interface VariableDefinition {
  stepIndex: number;
  stepId: string;
  fieldName: string;
  fieldLabel?: string;
  variableName: string;
  defaultValue: string;
  inputType?: string;
  isVariable: boolean;
  confidence: number;
  reasoning?: string;
  options?: string[];      // Available options for dropdown/select variables
  isDropdown?: boolean;    // Whether this is a dropdown/select variable
}

interface DetectVariablesResponse {
  variables: VariableDefinition[];
  analysisCount: number;
  error?: string;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  try {
    const payload: DetectVariablesRequest = await req.json();

    if (!GEMINI_API_KEY) {
      console.error('[detect_variables] GEMINI_API_KEY is not set in environment variables');
      throw new Error('GEMINI_API_KEY not configured');
    }
    
    // Log API key status (first 10 chars only for security)
    console.log(`[detect_variables] GEMINI_API_KEY is set: ${GEMINI_API_KEY.substring(0, 10)}...`);

    if (!payload.steps || payload.steps.length === 0) {
      return new Response(JSON.stringify({ variables: [], analysisCount: 0 }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Initialize Supabase client for caching
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check cache first
    const cacheKey = generateCacheKey(payload);
    const cached = await checkCache(supabase, cacheKey);
    
    if (cached) {
      console.log('Cache hit for detect_variables:', cacheKey);
      return new Response(JSON.stringify(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Analyze each step with snapshots
    const variables: VariableDefinition[] = [];
    let analysisCount = 0;

    for (const step of payload.steps) {
      // For INPUT steps, we can analyze even without snapshots (value is what matters)
      // For CLICK steps (dropdowns), we need at least a snapshot, value, or dropdown options
      const isInputStep = step.metadata.stepType === 'INPUT' || step.metadata.stepType === 'KEYBOARD';
      const isClickStep = step.metadata.stepType === 'CLICK';
      const isDropdown = step.metadata.isDropdown;
      const hasSnapshot = !!step.afterSnapshot || !!step.beforeSnapshot;
      const hasValue = !!step.metadata.value;
      const hasDropdownOptions = isDropdown && step.metadata.dropdownOptions && step.metadata.dropdownOptions.length > 0;
      
      console.log(`[detect_variables] Processing step ${step.metadata.stepIndex}:`, {
        stepType: step.metadata.stepType,
        isDropdown,
        hasSnapshot,
        hasValue,
        hasDropdownOptions,
        value: step.metadata.value,
        label: step.metadata.label,
        dropdownOptions: step.metadata.dropdownOptions,
      });
      
      // For INPUT steps, require at least a value
      if (isInputStep && !hasValue) {
        console.log(`[detect_variables] Skipping INPUT step ${step.metadata.stepIndex}: no value`);
        continue;
      }
      
      // For CLICK steps (dropdowns), require at least: snapshot, value, or dropdown options
      if (isClickStep) {
        // Check if this looks like a dropdown option (even if not explicitly marked)
        const selector = step.metadata.selector || '';
        const looksLikeDropdown = isDropdown || 
                                  step.metadata.elementRole === 'option' ||
                                  selector.includes('role="option"') || 
                                  selector.includes("role='option'") ||
                                  selector.includes('[role="option"]') ||
                                  selector.includes("[role='option']") ||
                                  selector.includes('listbox');
        
        console.log(`[detect_variables] CLICK step ${step.metadata.stepIndex} dropdown check:`, {
          isDropdown,
          elementRole: step.metadata.elementRole,
          selector: selector.substring(0, 100),
          looksLikeDropdown,
          hasSnapshot,
          hasValue,
          hasDropdownOptions,
          label: step.metadata.label,
        });
        
        if (looksLikeDropdown) {
          // It's a dropdown - analyze if we have ANY data (snapshot, value, options, or even just a label)
          if (hasSnapshot || hasValue || hasDropdownOptions || step.metadata.label) {
            console.log(`[detect_variables] ✅ Including dropdown CLICK step ${step.metadata.stepIndex}`);
          } else {
            console.log(`[detect_variables] ⚠️ Dropdown CLICK step ${step.metadata.stepIndex} has no data, but including anyway for AI analysis`);
          }
        } else {
          // Not a dropdown, skip (navigation clicks are filtered out client-side)
          console.log(`[detect_variables] ❌ Skipping non-dropdown CLICK step ${step.metadata.stepIndex}`);
          continue;
        }
      }
      
      // Skip if no snapshot AND no value AND not a dropdown with options
      if (!isInputStep && !isDropdown && !hasSnapshot && !hasValue) {
        console.log(`[detect_variables] Skipping step ${step.metadata.stepIndex}: no snapshot and no value`);
        continue;
      }

      analysisCount++;

      // Analyze this step
      const result = await analyzeStep(step, payload.pageContext);
      
      console.log(`[detect_variables] Step ${step.metadata.stepIndex} analysis result:`, {
        hasResult: !!result,
        isVariable: result?.isVariable,
        confidence: result?.confidence,
        fieldName: result?.fieldName,
        reasoning: result?.reasoning,
      });
      
      if (result && result.isVariable) {
        console.log(`[detect_variables] ✅ Adding variable for step ${step.metadata.stepIndex}: ${result.fieldName}`);
        variables.push(result);
      } else {
        console.log(`[detect_variables] ❌ Not adding step ${step.metadata.stepIndex} as variable:`, {
          hasResult: !!result,
          isVariable: result?.isVariable,
          confidence: result?.confidence,
        });
      }
    }

    const response: DetectVariablesResponse = {
      variables,
      analysisCount,
    };

    // Cache the result (30 minute TTL - variables don't change often)
    await saveToCache(supabase, cacheKey, response, 30 * 60);

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in detect_variables:', error);
    return new Response(
      JSON.stringify({
        variables: [],
        analysisCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});

/**
 * Analyze a single step to determine if it contains a variable
 */
async function analyzeStep(
  step: StepForAnalysis,
  pageContext?: { url: string; title: string; pageType?: string }
): Promise<VariableDefinition | null> {
  const { metadata, beforeSnapshot, afterSnapshot } = step;

  // Build the prompt based on step type (pass snapshots for context-aware prompts)
  const prompt = buildVariableDetectionPrompt(metadata, pageContext, beforeSnapshot, afterSnapshot);

  // Build Gemini API request with screenshots
  const parts: any[] = [{ text: prompt }];

  // Add before snapshot if available (helps see what changed)
  if (beforeSnapshot) {
    const beforeBase64 = extractBase64Data(beforeSnapshot);
    parts.push({
      text: '\n\nBEFORE Screenshot (state before user action):'
    });
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: beforeBase64
      }
    });
  }

  // Add after snapshot if available
  // For INPUT steps without snapshots, we can still analyze using the value and metadata
  if (afterSnapshot) {
    const afterBase64 = extractBase64Data(afterSnapshot);
    parts.push({
      text: beforeSnapshot ? '\n\nAFTER Screenshot (state after user action):' : '\n\nScreenshot of the element/action:'
    });
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: afterBase64
      }
    });
  } else if (metadata.stepType === 'INPUT' || metadata.stepType === 'KEYBOARD') {
    // For INPUT steps without snapshots, add a note in the prompt
    parts[0] = { 
      text: prompt + '\n\nNOTE: No screenshot available for this input field, but the value entered is: "' + (metadata.value || '') + '". Analyze based on the value, field label, and input type.'
    };
  } else if (metadata.stepType === 'CLICK' && metadata.isDropdown) {
    // For DROPDOWN CLICK steps without snapshots, add a note with available options
    const optionsNote = metadata.dropdownOptions && metadata.dropdownOptions.length > 0
      ? `\n\nNOTE: No screenshot available, but you have the dropdown options from the DOM: ${metadata.dropdownOptions.join(', ')}. The selected option is: "${metadata.value || 'unknown'}". Analyze based on the dropdown label, available options, and selected value.`
      : `\n\nNOTE: No screenshot available. Analyze based on the dropdown label "${metadata.label || 'dropdown'}" and selected value "${metadata.value || 'unknown'}".`;
    parts[0] = { 
      text: prompt + optionsNote
    };
  }

  const geminiRequest = {
    contents: [{
      parts
    }],
    generationConfig: {
      temperature: 0.2, // Low temperature for consistent classification
      maxOutputTokens: 1024,
    }
  };

  try {
    const geminiResponse = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': GEMINI_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiRequest),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error(`[detect_variables] Gemini API error for step ${metadata.stepIndex}:`, errorText);
      // Don't return null immediately - check fallback first
      const fallbackResult = checkFallbackHeuristic(metadata);
      if (fallbackResult) {
        console.log(`[detect_variables] ✅ Using fallback due to API error for step ${metadata.stepIndex}`);
        return fallbackResult;
      }
      return null;
    }

    const geminiData = await geminiResponse.json();
    const result = parseVariableResponse(geminiData, metadata);
    
    console.log(`[detect_variables] After parsing, result for step ${metadata.stepIndex}:`, {
      hasResult: !!result,
      isVariable: result?.isVariable,
      confidence: result?.confidence,
      value: metadata.value,
      label: metadata.label,
      stepType: metadata.stepType,
    });
    
    // Use fallback ONLY if AI completely failed (returned null or error)
    // If AI returned a result (even if isVariable: false), trust the AI
    if (!result) {
      // AI failed completely - use fallback as backup
      const fallbackResult = checkFallbackHeuristic(metadata);
      if (fallbackResult) {
        console.log(`[detect_variables] ✅ Using fallback (AI failed) for step ${metadata.stepIndex}: ${fallbackResult.fieldName}`);
        return fallbackResult;
      }
      return null;
    }
    
    // AI returned a result - trust it
    if (result.isVariable) {
      console.log(`[detect_variables] ✅ AI detected variable for step ${metadata.stepIndex}: ${result.fieldName} (confidence: ${result.confidence})`);
    } else {
      console.log(`[detect_variables] AI determined step ${metadata.stepIndex} is NOT a variable: ${result.reasoning || 'no reasoning provided'}`);
    }
    
    return result;
  } catch (error) {
    console.error(`[detect_variables] Exception analyzing step ${metadata.stepIndex}:`, error);
    // Only use fallback if there's an exception (AI completely failed)
    const fallbackResult = checkFallbackHeuristic(metadata);
    if (fallbackResult) {
      console.log(`[detect_variables] ✅ Using fallback due to exception for step ${metadata.stepIndex}: ${fallbackResult.fieldName}`);
      return fallbackResult;
    }
    return null;
  }
}

/**
 * Build prompt for variable detection based on step type
 */
function buildVariableDetectionPrompt(
  metadata: StepMetadata,
  pageContext?: { url: string; title: string; pageType?: string },
  beforeSnapshot?: string,
  afterSnapshot?: string
): string {
  let prompt = `PRODUCT CONTEXT:
You are analyzing steps from a browser automation tool called "GhostWriter" (also known as Autoflow). 
This tool allows users to record repetitive browser tasks (like filling forms, creating promotions, processing orders) 
and then execute them multiple times with different input values. 

The goal is to identify which values the user typed should be "variables" - meaning they can be changed 
each time the workflow runs. For example, if a user records filling a form with "Budget Amount: 1000", 
they should be able to run the workflow again with "Budget Amount: 2000" or any other amount.

VARIABLES = Values that users would want to change each execution (amounts, names, dates, selections)
STATIC = Values that should stay the same every time (system IDs, fixed configurations, navigation)

TASK: Analyze this workflow step to determine if the user-entered value should be a VARIABLE (parameterized, different each execution) or STATIC (same value each time).

`;

  if (pageContext) {
    prompt += `Page Context:
- URL: ${pageContext.url}
- Title: ${pageContext.title}
${pageContext.pageType ? `- Page Type: ${pageContext.pageType}` : ''}

`;
  }

  prompt += `Step Information:
- Step Type: ${metadata.stepType}
- Value Entered: "${metadata.value || ''}"
${metadata.label ? `- Field Label: "${metadata.label}"` : ''}
${metadata.inputType ? `- Input Type: ${metadata.inputType}` : ''}
${metadata.placeholder ? `- Placeholder: "${metadata.placeholder}"` : ''}
${metadata.elementRole ? `- Element Role: ${metadata.elementRole}` : ''}
${metadata.elementTag ? `- Element Tag: ${metadata.elementTag}` : ''}

`;

  if (metadata.stepType === 'INPUT' || metadata.stepType === 'KEYBOARD') {
    prompt += `ANALYZE THIS INPUT FIELD USING VISUAL CONTEXT:

${beforeSnapshot && afterSnapshot 
  ? 'You have BEFORE and AFTER screenshots. Compare them to see what changed visually.' 
  : afterSnapshot 
    ? 'You have a screenshot showing the field AFTER the user typed. Analyze the visual context.' 
    : beforeSnapshot
      ? 'You have a screenshot showing the field BEFORE the user typed. Use this for context.' 
      : 'No screenshot available - analyze based on metadata only.'}

CRITICAL: Use the SCREENSHOT to understand:
1. **What field is this?** Look for:
   - Field labels visible in the screenshot (text above, beside, or inside the field)
   - Placeholder text visible in the field
   - Surrounding context (form section, nearby fields, page layout)
   - Field position and visual styling

2. **What did the user type?** Look for:
   - The text/value visible in the input field in the screenshot
   - Compare before/after to see what changed
   - The visual appearance of the entered value

3. **Field context from screenshot:**
   - What form is this part of? (registration, payment, search, etc.)
   - What other fields are nearby? (helps understand the field's purpose)
   - Visual indicators (required field markers, icons, etc.)

METADATA (use as backup if not visible in screenshot):
VALUE ENTERED: "${metadata.value || ''}"
${metadata.label ? `FIELD LABEL: "${metadata.label}"` : ''}
${metadata.inputType ? `INPUT TYPE: ${metadata.inputType}` : ''}
${metadata.placeholder ? `PLACEHOLDER: "${metadata.placeholder}"` : ''}

A value is DEFINITELY a VARIABLE if:
- The field label contains ANY of these words: "Amount", "Budget", "Price", "Cost", "Quantity", "Number", "Percentage", "Rate", "Fee", "Total", "Value", "Count"
- The field label contains ANY of these words: "Name", "Email", "Phone", "Address", "City", "State", "Zip", "Country", "Company", "Title"
- The field label contains ANY of these words: "Date", "Time", "Start", "End", "Duration", "Period"
- The value is a NUMBER (like "1000", "100", "50", etc.) in ANY input field - numbers are almost always variables
- The screenshot shows the user typed a value that looks like personal/user data
- The screenshot context suggests this is a form field for user-entered data
- The field appears in a form where users would enter different values each time

EXAMPLES OF VARIABLES (mark as isVariable: true, confidence: 0.8+):
- "1000" in a field labeled "Budget Amount" → VARIABLE (confidence: 0.9)
- "100" in a field labeled "Restaurant Funding Percentage" → VARIABLE (confidence: 0.9)
- "50" in a field labeled "Quantity" → VARIABLE (confidence: 0.9)
- Any number in any amount/budget/price field → VARIABLE (confidence: 0.8+)
- Email addresses, names, addresses → VARIABLE (confidence: 0.9+)
- Dates, times → VARIABLE (confidence: 0.8+)

A value is STATIC (NOT a variable) ONLY if:
- The screenshot clearly shows it's a system-generated ID (like "ID: 12345" or "UUID: abc-123")
- The screenshot shows it's a fixed system configuration that never changes
- The field is clearly a read-only system field (not an input field)
- The value is clearly a system constant (like "Version: 2.0" or "Status: Active")

CRITICAL RULES:
1. **NUMBERS ARE ALMOST ALWAYS VARIABLES** - If you see a number in an input field, it's almost certainly a variable (confidence: 0.8+)
2. **When in doubt, mark it as a VARIABLE** - It's better to detect too many variables than too few
3. **Field labels with "Amount", "Budget", "Price", "Percentage" = VARIABLE** (confidence: 0.9+)
4. **User-typed values in form fields = VARIABLE** (confidence: 0.8+)

`;
  } else if (metadata.stepType === 'CLICK' && metadata.isSelectableOption) {
    if (metadata.isDropdown) {
      prompt += `ANALYZE THIS DROPDOWN SELECTION:

This is a click on a dropdown/select menu option where the user selected a choice from multiple available options.

${metadata.dropdownOptions && metadata.dropdownOptions.length > 0 
  ? `AVAILABLE OPTIONS IN THIS DROPDOWN: ${metadata.dropdownOptions.join(', ')}\n` 
  : ''}
${metadata.value ? `SELECTED OPTION: "${metadata.value}"\n` : ''}
${metadata.label ? `DROPDOWN LABEL/FIELD NAME: "${metadata.label}"\n` : ''}

${beforeSnapshot && afterSnapshot 
  ? 'You have BEFORE and AFTER screenshots. Compare them to see what option was selected and what changed visually.' 
  : afterSnapshot 
    ? 'You have a screenshot showing the dropdown AFTER selection. Analyze the visual context.' 
    : metadata.dropdownOptions && metadata.dropdownOptions.length > 0
      ? 'No screenshot available, but you have the list of available options from the DOM. Use this to understand the dropdown.'
      : 'No screenshot available. Analyze based on metadata only.'}

CRITICAL RULES FOR DROPDOWNS:
1. **DROPDOWNS ARE ALMOST ALWAYS VARIABLES** - Users select different options each time they run the workflow
2. **If the dropdown has 3+ options, it's DEFINITELY a VARIABLE** (confidence: 0.95+)
3. **If the dropdown label contains words like "Select", "Choose", "Type", "Category", "Plan", "Reason" = VARIABLE** (confidence: 0.9+)
4. **Only mark as STATIC if it's clearly a navigation button or system toggle**

EXAMPLES OF DROPDOWN VARIABLES (mark as isVariable: true, confidence: 0.9+):
- "BOGO" selected from "Select Promotion Type" dropdown with options [BOGO, FLAT, FREE DELIVERY, ...] → VARIABLE (confidence: 0.95)
- "UberEats Growth" selected from "Reason for Uber spend" dropdown → VARIABLE (confidence: 0.9)
- Any dropdown where user chooses from multiple options → VARIABLE (confidence: 0.9+)

A selection is STATIC (NOT a variable) ONLY if:
- The screenshot clearly shows it's a navigation button (Next, Submit, Continue)
- The screenshot shows it's a fixed system setting that never changes
- The dropdown has only 1-2 options and they're clearly system constants (like "Yes/No" for a system toggle)

${metadata.dropdownOptions && metadata.dropdownOptions.length > 0 
  ? `\nIMPORTANT: This dropdown has ${metadata.dropdownOptions.length} options. This is a clear indicator it's a VARIABLE.\n` 
  : ''}

`;
    } else {
      prompt += `ANALYZE THIS SELECTION:

This is a click on a selectable option (radio button, checkbox).
Compare the before/after screenshots to see what option was selected.

A selection is likely a VARIABLE if:
- It's a user preference that could change (e.g., "Select Plan: Pro")
- It's a category selection that varies per use case
- It's a filter or sort option
- The selection represents user choice rather than navigation

A selection is likely STATIC if:
- It's a navigation button (Next, Submit, Continue)
- It's a fixed system setting
- It's enabling/disabling a feature that's always the same

`;
    }
  }

  if (metadata.isDropdown) {
    prompt += `RESPOND WITH JSON:
{
  "isVariable": <true or false>,
  "confidence": <0.0 to 1.0>,
  "fieldName": "<human-readable field name from visual analysis>",
  "variableName": "<camelCase variable name suggestion>",
  "reasoning": "<brief explanation of why this is/isn't a variable>",
  "options": ["<option1>", "<option2>", ...]
}

CRITICAL INSTRUCTIONS:
- **NUMBERS IN INPUT FIELDS ARE ALMOST ALWAYS VARIABLES** - Use confidence 0.8+ for numbers
- **Field labels with "Amount", "Budget", "Price", "Percentage" = VARIABLE** - Use confidence 0.9+
- **DROPDOWNS WITH MULTIPLE OPTIONS ARE ALMOST ALWAYS VARIABLES** - Use confidence 0.9+ for dropdowns
- **When in doubt, mark as VARIABLE** - It's better to detect too many than too few
- Higher confidence (0.8-1.0) for: numbers, amounts, budgets, prices, percentages, emails, names, dates, dropdowns
- Medium confidence (0.6-0.8) for: other user-entered text fields
- **DO NOT be overly conservative** - If it's something a user typed or selected, it's likely a variable
- **Default to VARIABLE for any user-entered data or selections** unless clearly a system constant
- For dropdowns: Extract ALL visible options from the dropdown menu in the screenshot
- Include the currently selected option in the options array
`;
  } else {
    prompt += `RESPOND WITH JSON:
{
  "isVariable": <true or false>,
  "confidence": <0.0 to 1.0>,
  "fieldName": "<human-readable field name from visual analysis>",
  "variableName": "<camelCase variable name suggestion>",
  "reasoning": "<brief explanation of why this is/isn't a variable>"
}

IMPORTANT:
- Focus on what a human would recognize as "user data" vs "system data"
- Higher confidence (0.8+) for clear cases like email, password, name fields
- Medium confidence (0.5-0.8) for ambiguous cases
- Lower confidence (<0.5) if unsure - lean toward NOT marking as variable
`;
  }

  return prompt;
}

/**
 * Parse Gemini response into VariableDefinition
 */
function parseVariableResponse(
  geminiData: any,
  metadata: StepMetadata
): VariableDefinition | null {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Log raw response for debugging
    console.log(`[detect_variables] Raw Gemini response for step ${metadata.stepIndex} (first 500 chars):`, text.substring(0, 500));
    
    // Try to extract JSON from markdown code blocks first
    let jsonText = '';
    
    // First, try to find content between ``` markers (handles incomplete blocks too)
    const codeBlockStart = text.indexOf('```');
    if (codeBlockStart !== -1) {
      // Find the content after ```json or ```
      const afterStart = text.substring(codeBlockStart + 3);
      const jsonStart = afterStart.match(/^(?:json)?\s*\n?(\{)/);
      if (jsonStart) {
        // Extract everything from the opening { to the end
        const startIdx = jsonStart.index! + jsonStart[0].length - 1;
        let extracted = afterStart.substring(startIdx);
        
        // Try to find a complete JSON object first
        let braceCount = 0;
        let jsonEnd = -1;
        let inString = false;
        let escapeNext = false;
        
        for (let i = 0; i < extracted.length; i++) {
          const char = extracted[i];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') braceCount++;
            if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                jsonEnd = i + 1;
                break;
              }
            }
          }
        }
        
        if (jsonEnd > 0) {
          // Found complete JSON
          jsonText = extracted.substring(0, jsonEnd);
          console.log(`[detect_variables] Found complete JSON in code block for step ${metadata.stepIndex}`);
        } else {
          // JSON is incomplete - try to fix it
          console.log(`[detect_variables] JSON appears incomplete, attempting to fix for step ${metadata.stepIndex}`);
          
          // Find the last complete property (ending with , or })
          // Look for patterns like: "key": value, or "key": value}
          const lastCommaMatch = extracted.match(/,\s*"[^"]*":\s*"[^"]*$/);
          const lastCompletePropMatch = extracted.match(/,\s*"[^"]*":\s*[^,}]+$/);
          
          if (lastCommaMatch || lastCompletePropMatch) {
            // Find the position of the last comma before an incomplete property
            let lastCommaIdx = -1;
            inString = false;
            escapeNext = false;
            
            for (let i = extracted.length - 1; i >= 0; i--) {
              const char = extracted[i];
              
              if (escapeNext) {
                escapeNext = false;
                continue;
              }
              
              if (char === '\\') {
                escapeNext = true;
                continue;
              }
              
              if (char === '"' && !escapeNext) {
                inString = !inString;
                continue;
              }
              
              if (!inString && char === ',') {
                // Check if this comma is followed by an incomplete property
                const afterComma = extracted.substring(i + 1).trim();
                if (afterComma.match(/^"[^"]*":\s*"[^"]*$/)) {
                  // This is an incomplete property, use everything before this comma
                  lastCommaIdx = i;
                  break;
                }
              }
            }
            
            if (lastCommaIdx > 0) {
              jsonText = extracted.substring(0, lastCommaIdx) + '}';
              console.log(`[detect_variables] Fixed incomplete JSON by removing last property for step ${metadata.stepIndex}`);
            } else {
              // Try to find the last complete property by looking for the pattern "key": value,
              const completeMatch = extracted.match(/^(.+),\s*"[^"]*":\s*"[^"]*$/);
              if (completeMatch) {
                jsonText = completeMatch[1] + '}';
                console.log(`[detect_variables] Fixed incomplete JSON by removing incomplete property for step ${metadata.stepIndex}`);
              } else {
                // Last resort: just close the object
                jsonText = extracted.trim();
                // Remove any incomplete property at the end
                // Handle cases like: ", "} or ", "variableName": " or ", "variableName": "
                // First, handle the specific case of trailing ", "} (comma, space, quote, closing brace)
                if (jsonText.endsWith(', "}')) {
                  jsonText = jsonText.replace(/,\s*"\s*}$/, '}');
                } else if (jsonText.match(/,\s*"[^"]*":\s*"[^"]*"\s*}$/)) {
                  // Handle case like: ", "variableName": "value" }
                  jsonText = jsonText.replace(/,\s*"[^"]*":\s*"[^"]*"\s*}$/, '}');
                } else {
                  // Try to find and remove the last incomplete property
                  // The incomplete property is the one that extends to the end without a closing quote
                  // We need to find the LAST comma that's followed by an incomplete property
                  // Pattern: , "key": "value (no closing quote, extends to end)
                  
                  // First, try to find all commas and check which one starts an incomplete property
                  let lastIncompleteCommaIdx = -1;
                  let lastIncompletePropName = '';
                  
                  // Find all commas, then check backwards from the end
                  for (let i = jsonText.length - 1; i >= 0; i--) {
                    if (jsonText[i] === ',') {
                      // Check if this comma starts an incomplete property
                      const afterComma = jsonText.substring(i).trim();
                      const propMatch = afterComma.match(/^,\s*"([^"]+)":\s*"([\s\S]*)$/);
                      if (propMatch) {
                        lastIncompleteCommaIdx = i;
                        lastIncompletePropName = propMatch[1];
                        break;
                      }
                    }
                  }
                  
                  if (lastIncompleteCommaIdx >= 0) {
                    // Remove the incomplete property (everything from the comma to the end)
                    jsonText = jsonText.substring(0, lastIncompleteCommaIdx) + '}';
                    console.log(`[detect_variables] Removed incomplete property "${lastIncompletePropName}" for step ${metadata.stepIndex}`);
                  } else {
                    // Try other patterns
                    jsonText = jsonText.replace(/,\s*"[^"]*":\s*"[^"]*"\s*$/, ''); // Remove incomplete property with complete string but trailing
                    jsonText = jsonText.replace(/,\s*"[^"]*":\s*$/, ''); // Remove incomplete property key
                    jsonText = jsonText.replace(/,\s*"[^"]*"\s*$/, ''); // Remove incomplete string value
                    jsonText = jsonText.replace(/,\s*"[^"]*$/, ''); // Remove incomplete string
                    jsonText = jsonText.replace(/,\s*"$/, ''); // Remove trailing comma and quote
                    jsonText = jsonText.replace(/,\s*$/, ''); // Remove trailing comma
                    if (!jsonText.endsWith('}')) {
                      jsonText += '}';
                    }
                  }
                }
                console.log(`[detect_variables] Fixed incomplete JSON by closing object for step ${metadata.stepIndex}`);
              }
            }
          } else {
            // No clear pattern, try to close it
            jsonText = extracted.trim();
            // Remove trailing incomplete string or property
            // Handle cases like: ", "} or ", "variableName": " or ", "variableName": "
            // First, handle the specific case of trailing ", "} (comma, space, quote, closing brace)
            if (jsonText.endsWith(', "}')) {
              jsonText = jsonText.replace(/,\s*"\s*}$/, '}');
            } else if (jsonText.match(/,\s*"[^"]*":\s*"[^"]*"\s*}$/)) {
              // Handle case like: ", "variableName": "value" }
              jsonText = jsonText.replace(/,\s*"[^"]*":\s*"[^"]*"\s*}$/, '}');
            } else {
              // Try to find and remove the last incomplete property
              // The incomplete property is the one that extends to the end without a closing quote
              // We need to find the LAST comma that's followed by an incomplete property
              
              // Find all commas, then check backwards from the end
              let lastIncompleteCommaIdx = -1;
              let lastIncompletePropName = '';
              
              for (let i = jsonText.length - 1; i >= 0; i--) {
                if (jsonText[i] === ',') {
                  // Check if this comma starts an incomplete property
                  const afterComma = jsonText.substring(i).trim();
                  const propMatch = afterComma.match(/^,\s*"([^"]+)":\s*"([\s\S]*)$/);
                  if (propMatch) {
                    lastIncompleteCommaIdx = i;
                    lastIncompletePropName = propMatch[1];
                    break;
                  }
                }
              }
              
              if (lastIncompleteCommaIdx >= 0) {
                // Remove the incomplete property (everything from the comma to the end)
                jsonText = jsonText.substring(0, lastIncompleteCommaIdx) + '}';
                console.log(`[detect_variables] Removed incomplete property "${lastIncompletePropName}" (fallback) for step ${metadata.stepIndex}`);
              } else {
                // Try other patterns
                jsonText = jsonText.replace(/,\s*"[^"]*":\s*"[^"]*"\s*$/, ''); // Remove incomplete property with complete string but trailing
                jsonText = jsonText.replace(/,\s*"[^"]*":\s*$/, ''); // Remove incomplete property key
                jsonText = jsonText.replace(/,\s*"[^"]*"\s*$/, ''); // Remove incomplete string value
                jsonText = jsonText.replace(/,\s*"[^"]*$/, ''); // Remove incomplete string
                jsonText = jsonText.replace(/,\s*"$/, ''); // Remove trailing comma and quote
                jsonText = jsonText.replace(/,\s*$/, ''); // Remove trailing comma
                if (!jsonText.endsWith('}')) {
                  jsonText += '}';
                }
              }
            }
            console.log(`[detect_variables] Fixed incomplete JSON by closing object (fallback) for step ${metadata.stepIndex}`);
          }
        }
      }
    }
    
    // If no code block match, try to find JSON object directly in text
    if (!jsonText) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`[detect_variables] No JSON found in Gemini response for step ${metadata.stepIndex}`);
        console.error(`[detect_variables] Full response text (first 1000 chars):`, text.substring(0, 1000));
        return null;
      }
      jsonText = jsonMatch[0];
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseError) {
      console.error(`[detect_variables] Failed to parse JSON for step ${metadata.stepIndex}:`, parseError);
      console.error(`[detect_variables] JSON text (first 500 chars):`, jsonText.substring(0, 500));
      return null;
    }

    // Log the AI response for debugging
    console.log(`[detect_variables] Step ${metadata.stepIndex} AI response:`, {
      isVariable: parsed.isVariable,
      confidence: parsed.confidence,
      fieldName: parsed.fieldName,
      reasoning: parsed.reasoning,
      value: metadata.value,
      label: metadata.label,
    });

    // Parse the response
    const isVariable = parsed.isVariable === true;
    const confidence = parseFloat(parsed.confidence) || 0;

    console.log(`[detect_variables] Parsed AI response for step ${metadata.stepIndex}:`, {
      parsedIsVariable: parsed.isVariable,
      parsedConfidence: parsed.confidence,
      isVariable,
      confidence,
      fieldName: parsed.fieldName,
      reasoning: parsed.reasoning,
    });

    const result: VariableDefinition = {
      stepIndex: metadata.stepIndex,
      stepId: metadata.stepId,
      fieldName: parsed.fieldName || metadata.label || 'Unknown Field',
      fieldLabel: metadata.label,
      variableName: parsed.variableName || generateVariableName(parsed.fieldName || metadata.label),
      defaultValue: metadata.value || '',
      inputType: metadata.inputType,
      isVariable,
      confidence,
      reasoning: parsed.reasoning,
    };

    // Add dropdown-specific fields
    if (metadata.isDropdown) {
      result.isDropdown = true;
      // Use AI-extracted options if available, otherwise use DOM options
      if (parsed.options && Array.isArray(parsed.options) && parsed.options.length > 0) {
        result.options = parsed.options;
      } else if (metadata.dropdownOptions && metadata.dropdownOptions.length > 0) {
        result.options = metadata.dropdownOptions;
      }
    }

    return result;
  } catch (error) {
    console.error('Error parsing variable response:', error);
    return null;
  }
}

/**
 * Check fallback heuristic for variable detection
 * Returns a VariableDefinition if heuristic matches, null otherwise
 */
function checkFallbackHeuristic(metadata: StepMetadata): VariableDefinition | null {
  const isInputStep = metadata.stepType === 'INPUT' || metadata.stepType === 'KEYBOARD';
  const isClickStep = metadata.stepType === 'CLICK';
  const hasValue = !!metadata.value;
  
  // Handle INPUT steps
  if (isInputStep && hasValue) {
    const valueStr = String(metadata.value).trim();
    const isNumber = /^\d+(\.\d+)?$/.test(valueStr);
    const hasVariableKeyword = metadata.label && /(amount|budget|price|percentage|quantity|number|rate|fee|total|value|count|name|email|phone|address|date|time)/i.test(metadata.label);
    const shouldBeVariable = isNumber || hasVariableKeyword;
    
    console.log(`[detect_variables] Fallback check for INPUT step ${metadata.stepIndex}:`, {
      value: metadata.value,
      valueStr,
      isNumber,
      hasVariableKeyword,
      label: metadata.label,
      shouldBeVariable,
    });
    
    if (shouldBeVariable) {
      return {
        stepIndex: metadata.stepIndex,
        stepId: metadata.stepId,
        fieldName: metadata.label || 'Unknown Field',
        fieldLabel: metadata.label,
        variableName: generateVariableName(metadata.label || 'field'),
        defaultValue: metadata.value || '',
        inputType: metadata.inputType,
        isVariable: true,
        confidence: 0.85, // High confidence for fallback since it's a clear case
        reasoning: isNumber 
          ? `Detected via fallback heuristic: number "${metadata.value}" in input field "${metadata.label || 'field'}"`
          : `Detected via fallback heuristic: variable keyword in label "${metadata.label}"`,
      };
    }
  }
  
  // Handle CLICK steps (dropdowns)
  // Check both metadata.isDropdown AND selector for role="option" patterns
  const selector = metadata.selector || '';
  const looksLikeDropdown = metadata.isDropdown || 
                            selector.includes('role="option"') ||
                            selector.includes("role='option'") ||
                            selector.includes('[role="option"]') ||
                            selector.includes("[role='option']") ||
                            selector.includes('listbox');
  
  if (isClickStep && looksLikeDropdown) {
    const hasOptions = metadata.dropdownOptions && metadata.dropdownOptions.length > 0;
    const hasValue = !!metadata.value;
    
    console.log(`[detect_variables] Fallback check for DROPDOWN CLICK step ${metadata.stepIndex}:`, {
      isDropdown: metadata.isDropdown,
      looksLikeDropdown,
      selector: selector.substring(0, 100),
      hasOptions,
      hasValue,
      value: metadata.value,
      label: metadata.label,
      options: metadata.dropdownOptions,
    });
    
    // Dropdowns are almost always variables (user selects different options)
    // Even without value/options, if selector shows it's a dropdown option, mark as variable
    if (hasValue || hasOptions || looksLikeDropdown) {
      // Extract value from selector if available (e.g., "BOGO" from selector)
      let defaultValue = metadata.value;
      if (!defaultValue && selector) {
        // Try to extract the option text from the selector (e.g., 'BOGO' from contains(..., 'BOGO'))
        const valueMatch = selector.match(/contains\([^,]+,\s*['"]([^'"]+)['"]\)/);
        if (valueMatch && valueMatch[1]) {
          defaultValue = valueMatch[1];
        }
      }
      
      return {
        stepIndex: metadata.stepIndex,
        stepId: metadata.stepId,
        fieldName: metadata.label || 'Dropdown Selection',
        fieldLabel: metadata.label,
        variableName: generateVariableName(metadata.label || 'dropdown'),
        defaultValue: defaultValue || (hasOptions ? metadata.dropdownOptions![0] : ''),
        inputType: metadata.inputType,
        isVariable: true,
        isDropdown: true,
        options: metadata.dropdownOptions,
        confidence: 0.9, // Very high confidence - dropdowns are almost always variables
        reasoning: `Detected via fallback heuristic: dropdown selection (selector contains role="option")`,
      };
    }
  }
  
  return null;
}

/**
 * Generate a camelCase variable name from a field name
 */
function generateVariableName(fieldName: string): string {
  if (!fieldName) return 'field';
  
  return fieldName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .map((word, index) => 
      index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join('');
}

/**
 * Generate cache key for the request
 */
function generateCacheKey(payload: DetectVariablesRequest): string {
  // Create a hash based on step metadata and page context
  const keyData = {
    type: 'detect_variables',
    stepCount: payload.steps.length,
    stepIds: payload.steps.map(s => s.metadata.stepId).join(','),
    pageUrl: payload.pageContext?.url?.substring(0, 100),
  };
  
  const str = JSON.stringify(keyData);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `detect_variables_${Math.abs(hash).toString(36)}`;
}

/**
 * Check cache for existing result
 */
async function checkCache(
  supabase: any,
  cacheKey: string
): Promise<DetectVariablesResponse | null> {
  try {
    const { data, error } = await supabase
      .from('ai_cache')
      .select('response_data, expires_at')
      .eq('cache_key', cacheKey)
      .single();

    if (error || !data) {
      return null;
    }

    if (new Date(data.expires_at) < new Date()) {
      await supabase.from('ai_cache').delete().eq('cache_key', cacheKey);
      return null;
    }

    return data.response_data as DetectVariablesResponse;
  } catch (e) {
    console.error('Cache check error:', e);
    return null;
  }
}

/**
 * Save result to cache
 */
async function saveToCache(
  supabase: any,
  cacheKey: string,
  result: DetectVariablesResponse,
  ttlSeconds: number = 1800
): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + ttlSeconds);

    await supabase
      .from('ai_cache')
      .upsert({
        cache_key: cacheKey,
        response_data: result,
        expires_at: expiresAt.toISOString(),
      });
  } catch (e) {
    console.error('Cache save error:', e);
  }
}

/**
 * Extract base64 data from data URL
 */
function extractBase64Data(dataUrl: string): string {
  const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  return base64Match ? base64Match[1] : dataUrl;
}
